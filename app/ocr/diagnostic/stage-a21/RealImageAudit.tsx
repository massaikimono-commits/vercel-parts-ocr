/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { adaptiveColumns, detectPaperBox, getA19DynamicRows, makeCellCrop, orientedCanvas } from "../stage-a20/a19-table-crops";
import { FORMAL_A19_GT } from "../stage-a20/formal-gt";
import { getModelStats, recognizeOnnx, recognizeTess, type FieldKey } from "../stage-a20/recognition";
import { analyzeCellCrop } from "./crop-diagnostics";

const FIELDS: FieldKey[] = ["name", "qty", "retail", "cost"];
const ENGINES = ["CONTROL_TESS", "ONNX_JA_LIGHT", "ONNX_V5"] as const;
type EngineKey = typeof ENGINES[number];
type Row = { name: string; qty: string; retail: string; cost: string };

function canonical(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  return m ? `IMG_${m[1]}(1)` : "";
}
function norm(v: string) { return v.normalize("NFKC").replace(/[￥¥,\s]/g, "").toUpperCase(); }
function score(gt: Row[], pred: Row[]) {
  const byField: any = Object.fromEntries(FIELDS.map((f) => [f, { correct: 0, total: gt.length }]));
  let correct = 0, blank = 0, misread = 0, complete = 0;
  for (let i = 0; i < gt.length; i++) {
    const p = pred[i] || { name: "", qty: "", retail: "", cost: "" };
    let rowOk = true;
    for (const f of FIELDS) {
      const a = norm(gt[i]?.[f] || ""), b = norm(p[f] || "");
      if (a && a === b) { correct++; byField[f].correct++; }
      else { rowOk = false; if (!b) blank++; else misread++; }
    }
    if (rowOk) complete++;
  }
  return { correct, total: gt.length * 4, complete, gtRows: gt.length, blank, misread, byField };
}

export default function RealImageAudit({ deployedHead }: { deployedHead: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("対象1枚だけをbrowser内で診断します。画像/GT/cropはuploadしません。");
  const [result, setResult] = useState<any>(null);

  async function run(file: File | undefined) {
    if (!file) return;
    const fileName = canonical(file.name);
    if (!fileName || !FORMAL_A19_GT[fileName]) { setStatus("正式黄色12枚の対象ファイル名を選択してください。"); return; }
    setBusy(true); setResult(null);
    let worker: any = null;
    try {
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      const modelStats = {
        ONNX_JA_LIGHT: await getModelStats("ONNX_JA_LIGHT"),
        ONNX_V5: await getModelStats("ONNX_V5"),
      };
      setStatus(`${fileName} A19_TABLE geometry…`);
      const color = await orientedCanvas(file);
      const paper = detectPaperBox(color.canvas);
      const dynamic = await getA19DynamicRows(worker, tesseract, file, color, paper);
      const columns = adaptiveColumns(color.canvas, paper);
      const gt = FORMAL_A19_GT[fileName] as Row[];
      const rowsByEngine: Record<EngineKey, Row[]> = {
        CONTROL_TESS: [], ONNX_JA_LIGHT: [], ONNX_V5: [],
      };
      const cells: any[] = [];

      for (let r = 0; r < dynamic.rows.length; r++) {
        const out: Record<EngineKey, Row> = {
          CONTROL_TESS: { name: "", qty: "", retail: "", cost: "" },
          ONNX_JA_LIGHT: { name: "", qty: "", retail: "", cost: "" },
          ONNX_V5: { name: "", qty: "", retail: "", cost: "" },
        };
        const row = dynamic.rows[r];
        for (const field of FIELDS) {
          setStatus(`${fileName} row ${r + 1}/${dynamic.rows.length} ${field}…`);
          const col = columns.boxes[field];
          const cell = await makeCellCrop(dynamic.ocrCanvas, paper, row, col, field, r, field === "name" ? 1600 : 900);
          const cropDiagnostic = analyzeCellCrop(cell.canvas);
          const rec: any = {};
          const tess = await recognizeTess(worker, tesseract, cell.blob, field);
          rec.CONTROL_TESS = tess; out.CONTROL_TESS[field] = tess.normalized;
          for (const engine of ["ONNX_JA_LIGHT", "ONNX_V5"] as const) {
            try {
              const rr = await recognizeOnnx(engine, cell.canvas, field);
              rec[engine] = rr; out[engine][field] = rr.normalized;
            } catch (e: any) {
              rec[engine] = { raw: "", normalized: "", confidence: null, latencyMs: 0, error: String(e?.message || e) };
            }
          }
          cells.push({
            rowIndex: r,
            field,
            rowGeometry: {
              source: row.source,
              topNorm: (row.top - paper.y) / paper.h,
              bottomNorm: (row.bottom - paper.y) / paper.h,
              centerNorm: (row.center - paper.y) / paper.h,
            },
            columnGeometry: { x1Norm: col.x1, x2Norm: col.x2 },
            crop: {
              preview: cell.preview,
              width: cell.width,
              height: cell.height,
              padding: cell.padding,
              upscale: cell.upscale,
              contrast: cell.contrast,
              sharpness: cell.sharpness,
              cropHasSignalA20: cell.cropHasSignal,
              ...cropDiagnostic,
            },
            recognition: rec,
            gtScoringOnly: gt[r]?.[field] ?? null,
          });
        }
        // IMPORTANT diagnostic difference from A20 scoring harness: preserve every dynamic row slot,
        // even when all four recognizers are blank. This prevents blank-row compaction from shifting GT alignment.
        for (const e of ENGINES) rowsByEngine[e].push(out[e]);
      }

      const summary = {
        schema: "icb.parts-ocr.stage-a21-targeted-cell-root-cause.v1",
        deployedHead,
        fileName,
        diagnosticOnly: true,
        gtRuntimeUse: false,
        gtScoringOnly: true,
        recognitionParametersChanged: false,
        a20RowCompactionDisabledForDiagnosticAlignmentOnly: true,
        gtRows: gt.length,
        dynamicRows: dynamic.rows.length,
        paper: { width: paper.w, height: paper.h },
        verticalRules: columns.rules,
        modelStats,
        methods: Object.fromEntries(ENGINES.map((e) => [e, score(gt, rowsByEngine[e])])),
        cells,
      };
      setResult(summary);
      setStatus(`${fileName} targeted root-cause diagnostic完了。画像/cropはbrowser memory内のみ。`);
    } catch (e: any) {
      setStatus(`ERROR: ${String(e?.message || e)}`);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return <section style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14, marginBottom: 12 }}>
    <h2>Targeted real-cell diagnostic</h2>
    <p>管理GO時だけ使用。12枚再runではなく、原因分離に適した1枚を選んでcell cropとraw outputを確認します。</p>
    <input ref={input} hidden type="file" accept="image/*" onChange={(e) => run(e.target.files?.[0])} />
    <button disabled={busy} onClick={() => input.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 12, background: busy ? "#aeb8c7" : "#7a4e00", color: "#fff", fontWeight: 800 }}>
      {busy ? "診断中…" : "対象1枚を選択してbrowser-only診断"}
    </button>
    <div style={{ marginTop: 8, fontSize: 13 }}>{status}</div>
    {result && <>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
        {result.cells.map((c: any, i: number) => <div key={i} style={{ border: "1px solid #dde3ec", borderRadius: 8, padding: 7, fontSize: 11 }}>
          <strong>row {c.rowIndex + 1} / {c.field}</strong>
          <img src={c.crop.preview} alt="browser-only cell crop" style={{ display: "block", width: "100%", height: 90, objectFit: "contain", background: "#f8fafc", margin: "5px 0" }} />
          <div>occupancy {(c.crop.darkOccupancy * 100).toFixed(2)}% / trunc {String(c.crop.truncationLikely)} / tableLine {String(c.crop.tableLineLikely)}</div>
          <div>TESS raw: {c.recognition.CONTROL_TESS.raw || "∅"}</div>
          <div>JA raw: {c.recognition.ONNX_JA_LIGHT.raw || "∅"}</div>
          <div>V5 raw: {c.recognition.ONNX_V5.raw || "∅"}</div>
        </div>)}
      </div>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 720, overflow: "auto", background: "#f7f9fc", padding: 10, borderRadius: 8, fontSize: 10 }}>{JSON.stringify(result, null, 2)}</pre>
    </>}
  </section>;
}
