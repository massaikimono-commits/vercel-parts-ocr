/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { adaptiveColumns, detectPaperBox, getA19DynamicRows, makeCellCrop, orientedCanvas } from "../stage-a20/a19-table-crops";
import { FORMAL_A19_GT } from "../stage-a20/formal-gt";
import { getModelStats, recognizeOnnx, recognizeTess, type FieldKey } from "../stage-a20/recognition";
import { analyzeCellCrop } from "./crop-diagnostics";

const FIELDS: FieldKey[] = ["name", "qty", "retail", "cost"];
const ENGINES = ["CONTROL_TESS", "ONNX_JA_LIGHT", "ONNX_V5"] as const;
const FORMAL_IDS = Array.from({ length: 12 }, (_, i) => String(675 + i).padStart(4, "0"));
const TARGET_BASE_ID = "0684";
type EngineKey = typeof ENGINES[number];
type Row = { name: string; qty: string; retail: string; cost: string };

export function normalizeFormalBaseId(name: string): string | null {
  const normalized = name.normalize("NFKC").replace(/\\/g, "/").split("/").pop() || "";
  const m = normalized.match(/(?:^|[^0-9])(?:IMG[_\- ]*)?(067[5-9]|068[0-6])(?=[^0-9]|$)/i);
  return m ? m[1] : null;
}

export function resolveTarget0684(files: File[]): { target: File | null; reason: string; mappedIds: string[] } {
  if (files.length !== 12) return { target: null, reason: `formal-count:${files.length}`, mappedIds: [] };
  const mapped = files.map((file) => ({ file, id: normalizeFormalBaseId(file.name) }));
  const ids = mapped.map((x) => x.id).filter((x): x is string => !!x);
  const unique = new Set(ids);
  const formalCoverageOk = FORMAL_IDS.every((id) => unique.has(id));
  const targetMatches = mapped.filter((x) => x.id === TARGET_BASE_ID);
  if (!formalCoverageOk || unique.size !== 12) return { target: null, reason: "formal-mapping-incomplete-or-ambiguous", mappedIds: ids };
  if (targetMatches.length !== 1) return { target: null, reason: `target-match-count:${targetMatches.length}`, mappedIds: ids };
  return { target: targetMatches[0].file, reason: "ok", mappedIds: ids };
}

function canonicalFromBaseId(id: string) { return `IMG_${id}(1)`; }
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

function buildManagementSummary(result: any): string {
  const cells = result.cells || [];
  const totalCells = cells.length || 1;
  const trunc = cells.filter((c: any) => c.crop?.truncationLikely).length;
  const tableLine = cells.filter((c: any) => c.crop?.tableLineLikely).length;
  const lowOccupancy = cells.filter((c: any) => Number(c.crop?.darkOccupancy || 0) < 0.01).length;
  const edgeTouch = cells.filter((c: any) => c.crop?.edgeTouch === true || c.crop?.inkTouchesEdge === true).length;
  const rawBlank: Record<string, number> = {};
  const normDestroyed: Record<string, number> = {};
  const normChanged: Record<string, number> = {};
  for (const e of ENGINES) {
    rawBlank[e] = 0; normDestroyed[e] = 0; normChanged[e] = 0;
    for (const c of cells) {
      const rr = c.recognition?.[e] || {};
      const raw = String(rr.raw || "").trim();
      const normalized = String(rr.normalized || "").trim();
      if (!raw) rawBlank[e]++;
      if (raw && !normalized) normDestroyed[e]++;
      if (raw && normalized && norm(raw) !== norm(normalized)) normChanged[e]++;
    }
  }
  const cropIssueRatio = (trunc + tableLine) / totalCells;
  const jaBlankRatio = rawBlank.ONNX_JA_LIGHT / totalCells;
  const anyNormalizationDestruction = Object.values(normDestroyed).some((n) => n > 0);
  let primaryCause = "MIXED / cell cropと実画像recognitionの双方を継続分離";
  if (cropIssueRatio >= 0.35) primaryCause = "CELL_CROP_QUALITY PRIMARY：文字切れ/罫線混入が高率";
  else if (jaBlankRatio >= 0.5) primaryCause = "RECOGNIZER_REAL_IMAGE INTERFACE PRIMARY：signal cropでもraw blankが高率";
  else if (anyNormalizationDestruction) primaryCause = "NORMALIZATION CONTRIBUTOR：raw非空→normalized空の破壊あり";

  const methodLine = (e: EngineKey) => {
    const m = result.methods?.[e] || {};
    const f = m.byField || {};
    return `${e}: ${m.correct ?? 0}/${m.total ?? 0}, complete ${m.complete ?? 0}/${m.gtRows ?? 0}, blank ${m.blank ?? 0}, misread ${m.misread ?? 0}; name ${f.name?.correct ?? 0}/${f.name?.total ?? 0}, qty ${f.qty?.correct ?? 0}/${f.qty?.total ?? 0}, retail ${f.retail?.correct ?? 0}/${f.retail?.total ?? 0}, cost ${f.cost?.correct ?? 0}/${f.cost?.total ?? 0}; raw blank ${rawBlank[e]}/${totalCells}; raw→normalized破壊 ${normDestroyed[e]}, normalized変更 ${normChanged[e]}`;
  };

  return [
    "【Stage A21 targeted root-cause short summary】",
    `対象画像: IMG_${result.targetBaseId || TARGET_BASE_ID}（formal12から自動識別）`,
    `evalHead: ${result.deployedHead}`,
    `GT: scoring-only / runtime use=${String(result.gtRuntimeUse)} / recognition parameters changed=${String(result.recognitionParametersChanged)}`,
    `rows: GT ${result.gtRows}, dynamic ${result.dynamicRows}, cells ${cells.length}`,
    "",
    "【row/cell crop診断】",
    `文字切れ疑い: ${trunc}/${totalCells}`,
    `罫線混入疑い: ${tableLine}/${totalCells}`,
    `低occupancy(<1%): ${lowOccupancy}/${totalCells}`,
    `edge-touch指標: ${edgeTouch}/${totalCells}`,
    `paper: ${result.paper?.width ?? "?"} x ${result.paper?.height ?? "?"}; vertical rules=${Array.isArray(result.verticalRules) ? result.verticalRules.length : 0}`,
    "A20のcropHasSignal=trueは文字正位置の証明ではないため、A21ではtruncation/table-line/occupancy等を分離して判定。blank row slotは維持し、A20 row-compaction confoundを除外。",
    "",
    "【recognizer主要結果】",
    methodLine("CONTROL_TESS"),
    methodLine("ONNX_JA_LIGHT"),
    methodLine("ONNX_V5"),
    "",
    "【raw→normalized監査】",
    `raw非空→normalized空の破壊: TESS ${normDestroyed.CONTROL_TESS}, JA_LIGHT ${normDestroyed.ONNX_JA_LIGHT}, V5 ${normDestroyed.ONNX_V5}`,
    `判定: ${anyNormalizationDestruction ? "破壊あり。該当cellをnormalization contributorとして分離。" : "明確なraw非空→normalized空の破壊なし。normalization単独主因ではない。"}`,
    "",
    "【主原因判定】",
    primaryCause,
    "model/dictionary/CTC contractは事前CI sanityで整合確認済み。したがって本runでは、cell crop correctnessと実画像上のrecognizer raw behaviorを主要観測対象とする。GTは位置補正・crop選択・recognition制御へ使用していない。",
    "",
    "【保護】",
    "diagnostic-only / browser-only。画像・crop・GTをGitHub/Supabaseへ保存しない。Frozen/Production/Stage B/Guided Liveは変更なし。"
  ].join("\n").slice(0, 4000);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const el = document.createElement("textarea");
  el.value = text; el.style.position = "fixed"; el.style.opacity = "0";
  document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
}

export default function RealImageAudit({ deployedHead }: { deployedHead: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正式12枚を一括選択してください。対象画像はUI側で自動識別します。");
  const [result, setResult] = useState<any>(null);
  const [copyStatus, setCopyStatus] = useState("");

  async function run(selected: FileList | null) {
    if (!selected) return;
    const files = Array.from(selected);
    const resolved = resolveTarget0684(files);
    if (!resolved.target) {
      setStatus(`STOP：正式12枚mappingから対象を一意に自動識別できませんでした（${resolved.reason}）。ユーザー手動判別は要求しません。`);
      if (input.current) input.current.value = "";
      return;
    }
    const file = resolved.target;
    const fileName = canonicalFromBaseId(TARGET_BASE_ID);
    const gt = FORMAL_A19_GT[fileName] as Row[] | undefined;
    if (!gt) {
      setStatus("STOP：既存formal mapping上のGT参照を解決できませんでした。ユーザー手動判別は要求しません。");
      if (input.current) input.current.value = "";
      return;
    }

    setBusy(true); setResult(null); setCopyStatus("");
    setStatus("対象画像を自動識別しました。targeted diagnosticを実行中…");
    let worker: any = null;
    try {
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      const modelStats = {
        ONNX_JA_LIGHT: await getModelStats("ONNX_JA_LIGHT"),
        ONNX_V5: await getModelStats("ONNX_V5"),
      };
      const color = await orientedCanvas(file);
      const paper = detectPaperBox(color.canvas);
      const dynamic = await getA19DynamicRows(worker, tesseract, file, color, paper);
      const columns = adaptiveColumns(color.canvas, paper);
      const rowsByEngine: Record<EngineKey, Row[]> = { CONTROL_TESS: [], ONNX_JA_LIGHT: [], ONNX_V5: [] };
      const cells: any[] = [];

      for (let r = 0; r < dynamic.rows.length; r++) {
        const out: Record<EngineKey, Row> = {
          CONTROL_TESS: { name: "", qty: "", retail: "", cost: "" },
          ONNX_JA_LIGHT: { name: "", qty: "", retail: "", cost: "" },
          ONNX_V5: { name: "", qty: "", retail: "", cost: "" },
        };
        const row = dynamic.rows[r];
        for (const field of FIELDS) {
          setStatus(`対象画像を自動識別済み。row ${r + 1}/${dynamic.rows.length} ${field}を診断中…`);
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
          cells.push({ rowIndex: r, field,
            rowGeometry: { source: row.source, topNorm: (row.top - paper.y) / paper.h, bottomNorm: (row.bottom - paper.y) / paper.h, centerNorm: (row.center - paper.y) / paper.h },
            columnGeometry: { x1Norm: col.x1, x2Norm: col.x2 },
            crop: { preview: cell.preview, padding: cell.padding, upscale: cell.upscale, contrast: cell.contrast, sharpness: cell.sharpness, cropHasSignalA20: cell.cropHasSignal, ...cropDiagnostic },
            recognition: rec, gtScoringOnly: gt[r]?.[field] ?? null });
        }
        for (const e of ENGINES) rowsByEngine[e].push(out[e]);
      }

      const summary = {
        schema: "icb.parts-ocr.stage-a21-targeted-cell-root-cause.v3", deployedHead,
        targetBaseId: TARGET_BASE_ID, targetResolution: "automatic-from-formal12-filename-normalization",
        selectedFileCount: files.length, mappedFormalIds: resolved.mappedIds.slice().sort(), userTargetSelectionCount: 0,
        diagnosticOnly: true, gtRuntimeUse: false, gtScoringOnly: true, recognitionParametersChanged: false,
        a20RowCompactionDisabledForDiagnosticAlignmentOnly: true, gtRows: gt.length, dynamicRows: dynamic.rows.length,
        paper: { width: paper.w, height: paper.h }, verticalRules: columns.rules, modelStats,
        methods: Object.fromEntries(ENGINES.map((e) => [e, score(gt, rowsByEngine[e])])), cells,
      };
      setResult(summary);
      setStatus("対象画像を自動識別しました。targeted diagnostic完了。総合管理用短縮summaryを1ボタンでコピーできます。");
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
    <p>正式黄色12枚を一括選択してください。UIが既存formal mappingに従って対象を自動識別し、対象1枚だけを診断します。</p>
    <input ref={input} hidden multiple type="file" accept="image/*" onChange={(e) => run(e.target.files)} />
    <button disabled={busy} onClick={() => input.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 12, background: busy ? "#aeb8c7" : "#7a4e00", color: "#fff", fontWeight: 800 }}>
      {busy ? "診断中…" : "正式12枚を選択してください"}
    </button>
    <div style={{ marginTop: 8, fontSize: 13 }}>{status}</div>
    {result && <>
      <button onClick={async () => { await copyText(buildManagementSummary(result)); setCopyStatus("総合管理用短縮summaryをコピーしました。"); }} style={{ width: "100%", marginTop: 12, border: 0, borderRadius: 12, padding: 13, background: "#176b2c", color: "#fff", fontWeight: 900 }}>
        総合管理用短縮summaryをコピー
      </button>
      <button onClick={async () => { await copyText(JSON.stringify(result, null, 2)); setCopyStatus("詳細JSONをコピーしました。"); }} style={{ width: "100%", marginTop: 8, border: "1px solid #64748b", borderRadius: 12, padding: 11, background: "#fff", color: "#334155", fontWeight: 800 }}>
        詳細JSONをコピー
      </button>
      {copyStatus && <div style={{ marginTop: 7, fontSize: 13, fontWeight: 700 }}>{copyStatus}</div>}
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
      <details style={{ marginTop: 12 }}><summary style={{ fontWeight: 800 }}>詳細JSONを画面表示</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 720, overflow: "auto", background: "#f7f9fc", padding: 10, borderRadius: 8, fontSize: 10 }}>{JSON.stringify(result, null, 2)}</pre></details>
    </>}
  </section>;
}
