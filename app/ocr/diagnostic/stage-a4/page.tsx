/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { prepareOCRInputFile } from "../../transfer";
import {
  detectHorizontalRuleBands,
  rowBandsFromRules,
  type CropBox,
} from "../../dynamic-rows";
import {
  parseHeaderlessRuntimeTsv,
  tsvLineRows,
  tsvWordGroupRows,
  type GeometryRow,
} from "./runtime-tsv";
import { GT_MAP, EXPECTED_FILES, type GtImage } from "./gt";

type CandidateRow = {
  top: number;
  bottom: number;
  center: number;
  source: "rules" | "tsv-word-group" | "tsv-line";
};

const SOURCE_HEAD = "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto", padding: "16px 12px 60px", color: "#172033", background: "#f5f7fb", minHeight: "100vh" },
  card: { background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14, marginBottom: 12 },
  title: { margin: 0, fontSize: 24, fontWeight: 900 },
  text: { color: "#5b6678", lineHeight: 1.65, fontSize: 14 },
  primary: { width: "100%", border: 0, borderRadius: 13, padding: "14px 12px", background: "#2468df", color: "#fff", fontWeight: 800, fontSize: 17 },
  pre: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f7f9fc", border: "1px solid #e2e7ef", borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, maxHeight: 580, overflow: "auto" },
};

function canonicalFromName(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  return m ? `IMG_${m[1]}(1)` : "";
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を開けませんでした。")); };
    img.src = url;
  });
}

async function orientedColorCanvas(file: File) {
  const img = await loadImage(file);
  const rotate = img.naturalHeight > img.naturalWidth * 1.08;
  const sourceWidth = rotate ? img.naturalHeight : img.naturalWidth;
  const sourceHeight = rotate ? img.naturalWidth : img.naturalHeight;
  const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (rotate) {
    ctx.save();
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, canvas.height, canvas.width);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return {
    canvas,
    rotate,
    rawWidth: img.naturalWidth,
    rawHeight: img.naturalHeight,
  };
}

async function fileCanvas(file: File) {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function detectPaperBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 800));
  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const yellow = r > 100 && g > 95 && r + g > b * 1.75;
    return bright > 150 || yellow;
  };

  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0; let count = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.18) ys.push(y);
  }
  if (ys.length < 4) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 2);
  const roughBottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0; let count = 0;
    for (let y = top; y <= roughBottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.20) xs.push(x);
  }

  const left = xs.length ? Math.max(0, xs[0] - step * 2) : 0;
  const right = xs.length ? Math.min(w - 1, xs[xs.length - 1] + step * 2) : w - 1;
  const width = right - left + 1;
  let boxHeight = roughBottom - top + 1;
  const expectedHeight = Math.round(width / 1.74);
  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) {
    boxHeight = Math.min(expectedHeight, h - top);
  }
  if (width < w * 0.55 || boxHeight < h * 0.25) return { x: 0, y: 0, w, h };
  return { x: left, y: top, w: width, h: boxHeight };
}

async function canvasBlob(canvas: HTMLCanvasElement, quality = 0.96) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error("画像変換失敗")),
      "image/jpeg",
      quality,
    ),
  );
}

function rawToGtPoint(rawX: number, rawY: number, rawWidth: number, rawHeight: number, rotationDeg: number) {
  const r = ((rotationDeg % 360) + 360) % 360;
  if (r === 0) return { x: rawX, y: rawY, width: rawWidth, height: rawHeight };
  if (r === 90) return { x: rawHeight - rawY, y: rawX, width: rawHeight, height: rawWidth };
  if (r === 180) return { x: rawWidth - rawX, y: rawHeight - rawY, width: rawWidth, height: rawHeight };
  if (r === 270) return { x: rawY, y: rawWidth - rawX, width: rawHeight, height: rawWidth };
  throw new Error("rotationDeg must be 0/90/180/270");
}

function candidateToRawPoint(
  x: number,
  y: number,
  meta: {
    rawWidth: number;
    rawHeight: number;
    geometryWidth: number;
    geometryHeight: number;
    autoRotate90CCW: boolean;
  },
) {
  const sourceWidth = meta.autoRotate90CCW ? meta.rawHeight : meta.rawWidth;
  const sourceHeight = meta.autoRotate90CCW ? meta.rawWidth : meta.rawHeight;
  const sx = meta.geometryWidth / sourceWidth;
  const sy = meta.geometryHeight / sourceHeight;
  return meta.autoRotate90CCW
    ? { x: (meta.geometryHeight - y) / sy, y: x / sx }
    : { x: x / sx, y: y / sy };
}

function scoreRows(
  rows: CandidateRow[],
  paper: CropBox,
  meta: {
    rawWidth: number;
    rawHeight: number;
    geometryWidth: number;
    geometryHeight: number;
    autoRotate90CCW: boolean;
  },
  gt: GtImage,
) {
  const assigned = new Map(gt.rows.map((r) => [r.rowIndex, 0]));
  let falseCount = 0;

  const mapped = rows.map((row, i) => {
    const cr = candidateToRawPoint(
      paper.x + paper.w / 2,
      row.center,
      meta,
    );
    const center = rawToGtPoint(
      cr.x,
      cr.y,
      meta.rawWidth,
      meta.rawHeight,
      gt.rotationDeg,
    );
    const centerYNorm = center.y / center.height;

    const containing = gt.rows.filter(
      (g) => centerYNorm >= g.y1Norm && centerYNorm <= g.y2Norm,
    );
    let match = null as null | typeof gt.rows[number];
    if (containing.length) {
      match = [...containing].sort(
        (a, b) =>
          Math.abs(centerYNorm - (a.y1Norm + a.y2Norm) / 2) -
          Math.abs(centerYNorm - (b.y1Norm + b.y2Norm) / 2),
      )[0];
      assigned.set(match.rowIndex, (assigned.get(match.rowIndex) || 0) + 1);
    } else {
      falseCount += 1;
    }

    return {
      candidateIndex: i + 1,
      source: row.source,
      centerYNorm: +centerYNorm.toFixed(6),
      matchedGtRowIndex: match?.rowIndex ?? null,
    };
  });

  const covered = gt.rows.filter((r) => (assigned.get(r.rowIndex) || 0) > 0).map((r) => r.rowIndex);
  const duplicateCount = gt.rows.reduce(
    (sum, r) => sum + Math.max(0, (assigned.get(r.rowIndex) || 0) - 1),
    0,
  );

  return {
    candidateCount: rows.length,
    gtCoverage: covered.length,
    recall: gt.rowCount ? covered.length / gt.rowCount : 0,
    falseCount,
    duplicateCount,
    coveredGtRows: covered,
    mapped,
  };
}

function asCandidateRows(rows: GeometryRow[]): CandidateRow[] {
  return rows.map((r) => ({ ...r }));
}

function rulesRows(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  paper: CropBox,
): CandidateRow[] {
  const rules = detectHorizontalRuleBands(rgba, width, height, paper);
  return rowBandsFromRules(rules, paper).map((r) => ({
    top: r.top,
    bottom: r.bottom,
    center: r.center,
    source: "rules" as const,
  }));
}

function summarizeVariant(rows: any[]) {
  return rows.reduce(
    (acc, x) => ({
      candidateCount: acc.candidateCount + x.candidateCount,
      gtCoverage: acc.gtCoverage + x.gtCoverage,
      falseCount: acc.falseCount + x.falseCount,
      duplicateCount: acc.duplicateCount + x.duplicateCount,
    }),
    { candidateCount: 0, gtCoverage: 0, falseCount: 0, duplicateCount: 0 },
  );
}

function summarizeComplementarity(images: any[], tsvVariantName: string) {
  const aggregate = {
    rulesCoveredRows: 0,
    tsvCoveredRows: 0,
    bothCoveredRows: 0,
    rulesOnlyCoveredRows: 0,
    tsvOnlyNewRescueRows: 0,
    bothMissRows: 0,
    unionCoveredRows: 0,
  };

  const perImage = images.map((img) => {
    const rules = new Set<number>(img.variants.rulesOnly.coveredGtRows || []);
    const tsv = new Set<number>(img.variants[tsvVariantName].coveredGtRows || []);

    const counts = {
      rulesCoveredRows: 0,
      tsvCoveredRows: 0,
      bothCoveredRows: 0,
      rulesOnlyCoveredRows: 0,
      tsvOnlyNewRescueRows: 0,
      bothMissRows: 0,
      unionCoveredRows: 0,
    };

    for (let rowIndex = 1; rowIndex <= img.gtRowCount; rowIndex += 1) {
      const byRules = rules.has(rowIndex);
      const byTsv = tsv.has(rowIndex);

      if (byRules) counts.rulesCoveredRows += 1;
      if (byTsv) counts.tsvCoveredRows += 1;

      if (byRules && byTsv) {
        counts.bothCoveredRows += 1;
        counts.unionCoveredRows += 1;
      } else if (byRules) {
        counts.rulesOnlyCoveredRows += 1;
        counts.unionCoveredRows += 1;
      } else if (byTsv) {
        counts.tsvOnlyNewRescueRows += 1;
        counts.unionCoveredRows += 1;
      } else {
        counts.bothMissRows += 1;
      }
    }

    for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) {
      aggregate[key] += counts[key];
    }

    return {
      fileName: img.fileName,
      gtRowCount: img.gtRowCount,
      ...counts,
    };
  });

  return {
    ...aggregate,
    perImage,
  };
}

export default function StageA4Page() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("黄色正式12枚を選択してください。");
  const [result, setResult] = useState<any>(null);
  const [copyState, setCopyState] = useState("");

  async function run(files: FileList | null) {
    if (!files?.length) return;

    const byCanonical = new Map<string, File>();
    for (const file of Array.from(files)) {
      const id = canonicalFromName(file.name);
      if (id && !byCanonical.has(id)) byCanonical.set(id, file);
    }

    const missing = EXPECTED_FILES.filter((id) => !byCanonical.has(id));
    if (missing.length) {
      setStatus(`正式12枚が揃っていません。missing: ${missing.join(", ")}`);
      return;
    }

    setBusy(true);
    setResult(null);
    setCopyState("");
    let worker: any = null;

    try {
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3",
        user_defined_dpi: "300",
        tessedit_char_whitelist: "",
      });

      const images: any[] = [];

      for (let i = 0; i < EXPECTED_FILES.length; i += 1) {
        const fileName = EXPECTED_FILES[i];
        const file = byCanonical.get(fileName)!;
        const gt = GT_MAP.get(fileName)!;
        setStatus(`${i + 1}/12 ${fileName} Stage A4解析中…`);

        const color = await orientedColorCanvas(file);
        const paper = detectPaperBox(color.canvas);
        const colorCtx = color.canvas.getContext("2d", { willReadFrequently: true });
        if (!colorCtx) throw new Error("色保持geometryを取得できません。");
        const rgba = colorCtx.getImageData(0, 0, color.canvas.width, color.canvas.height).data;

        const prepared = await prepareOCRInputFile(file);
        const ocrSource = await fileCanvas(prepared);
        if (
          ocrSource.width !== color.canvas.width ||
          ocrSource.height !== color.canvas.height
        ) {
          throw new Error(
            `${fileName}: TSV/OCR座標系 ${ocrSource.width}x${ocrSource.height} と geometry ${color.canvas.width}x${color.canvas.height} が不一致`,
          );
        }

        const full = await worker.recognize(
          await canvasBlob(ocrSource, 0.96),
          {},
          {
            blocks: false,
            text: false,
            layoutBlocks: false,
            hocr: false,
            tsv: true,
            box: false,
            unlv: false,
            osd: false,
            pdf: false,
            imageColor: false,
            imageGrey: false,
            imageBinary: false,
            debug: false,
          },
        );

        const tsv = String(full.data.tsv || "");
        const parsed = parseHeaderlessRuntimeTsv(tsv);
        if (parsed.contract.headerPresent) {
          throw new Error(`${fileName}: runtime TSV unexpectedly contains a named header`);
        }
        if (parsed.contract.firstNonEmptyColumnCount < 11) {
          throw new Error(`${fileName}: runtime TSV column count is too small`);
        }

        const wordGroup = tsvWordGroupRows(parsed.records, paper);
        const lineRows = tsvLineRows(parsed.records, paper);
        const ruleRows = rulesRows(rgba, color.canvas.width, color.canvas.height, paper);

        const meta = {
          rawWidth: color.rawWidth,
          rawHeight: color.rawHeight,
          geometryWidth: color.canvas.width,
          geometryHeight: color.canvas.height,
          autoRotate90CCW: color.rotate,
        };

        const rulesOnly = scoreRows(ruleRows, paper, meta, gt);
        const tsvWordOnly = scoreRows(asCandidateRows(wordGroup.rows), paper, meta, gt);
        const tsvLineOnly = scoreRows(asCandidateRows(lineRows), paper, meta, gt);
        const ruleWordUnion = scoreRows(
          [...ruleRows, ...asCandidateRows(wordGroup.rows)],
          paper,
          meta,
          gt,
        );
        const ruleLineUnion = scoreRows(
          [...ruleRows, ...asCandidateRows(lineRows)],
          paper,
          meta,
          gt,
        );

        images.push({
          fileName,
          gtRowCount: gt.rowCount,
          runtimeTsvContract: parsed.contract,
          paperBBoxNormalized: {
            x: +(paper.x / color.canvas.width).toFixed(6),
            y: +(paper.y / color.canvas.height).toFixed(6),
            w: +(paper.w / color.canvas.width).toFixed(6),
            h: +(paper.h / color.canvas.height).toFixed(6),
          },
          tsvWordGroupTrace: wordGroup.trace,
          variants: {
            rulesOnly,
            tsvWordGroupOnly: tsvWordOnly,
            tsvLineOnly,
            rulesPlusTsvWordUnion: ruleWordUnion,
            rulesPlusTsvLineUnion: ruleLineUnion,
          },
        });
      }

      const variantNames = [
        "rulesOnly",
        "tsvWordGroupOnly",
        "tsvLineOnly",
        "rulesPlusTsvWordUnion",
        "rulesPlusTsvLineUnion",
      ];

      const aggregate: Record<string, any> = {};
      for (const name of variantNames) {
        const x = summarizeVariant(images.map((img) => img.variants[name]));
        aggregate[name] = {
          ...x,
          recall: x.gtCoverage / 54,
        };
      }

      const complementarity = {
        tsvWordGroup: summarizeComplementarity(images, "tsvWordGroupOnly"),
        tsvLevel4Line: summarizeComplementarity(images, "tsvLineOnly"),
      };

      const contractAggregate = {
        allHeaderless:
          images.every((img) => img.runtimeTsvContract.headerPresent === false),
        firstNonEmptyColumnCounts: Array.from(
          new Set(images.map((img) => img.runtimeTsvContract.firstNonEmptyColumnCount)),
        ),
        totalRecords: images.reduce(
          (s, img) => s + img.runtimeTsvContract.recordCount,
          0,
        ),
        totalValidRecords: images.reduce(
          (s, img) => s + img.runtimeTsvContract.validRecordCount,
          0,
        ),
        totalInvalidRecords: images.reduce(
          (s, img) => s + img.runtimeTsvContract.invalidRecordCount,
          0,
        ),
      };

      const payload = {
        schema: "icb.parts-ocr.stage-a4-row-redesign.v1",
        sourceHead: SOURCE_HEAD,
        evaluationSet: "formal-yellow-12",
        gtTotalRows: 54,
        experimentOnly: true,
        runtimeTsvContract: {
          expected:
            "headerless 12-column TessBaseAPI.GetTSVText rows: level,page_num,block_num,par_num,line_num,word_num,left,top,width,height,conf,text",
          aggregate: contractAggregate,
        },
        images,
        aggregate,
        complementarity,
      };

      setResult(payload);
      setStatus("12/12 Stage A4解析完了。summaryをコピーできます。");
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  function shortSummary() {
    if (!result) return null;
    return {
      schema: result.schema,
      sourceHead: result.sourceHead,
      evaluationSet: result.evaluationSet,
      gtTotalRows: result.gtTotalRows,
      experimentOnly: true,
      runtimeTsvContract: result.runtimeTsvContract,
      images: result.images.map((img: any) => ({
        fileName: img.fileName,
        gtRowCount: img.gtRowCount,
        runtimeTsvContract: img.runtimeTsvContract,
        tsvWordGroupTrace: img.tsvWordGroupTrace,
        variants: Object.fromEntries(
          Object.entries(img.variants).map(([k, v]: any) => [
            k,
            {
              candidateCount: v.candidateCount,
              gtCoverage: v.gtCoverage,
              recall: v.recall,
              falseCount: v.falseCount,
              duplicateCount: v.duplicateCount,
              coveredGtRows: v.coveredGtRows,
            },
          ]),
        ),
      })),
      aggregate: result.aggregate,
      complementarity: result.complementarity,
    };
  }

  async function copySummary() {
    const summary = shortSummary();
    if (!summary) return;
    const text = JSON.stringify(summary, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopyState("コピーしました。総合管理チャットへそのまま貼り付けてください。");
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>Stage A4 Row Detector Redesign Experiment</h1>
        <p style={styles.text}>
          Frozen OCR本体は変更せず、actual runtime TSVのheaderless geometry contractを解析し、
          rules-only / TSV-only / rules+TSV unionを同じmanual GTで比較します。
          OCR文字列・部品名・価格は出力せず、GTはcandidate生成完了後のpost-hoc scoringだけに使用します。
        </p>
      </section>

      <section style={styles.card}>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => run(e.target.files)}
        />
        <button
          style={styles.primary}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Stage A4解析中…" : "黄色正式12枚を選択してStage A4実行"}
        </button>
        <div style={{ marginTop: 10, fontWeight: 800, fontSize: 14 }}>{status}</div>
      </section>

      {result && (
        <>
          <section style={styles.card}>
            <button style={styles.primary} onClick={copySummary}>
              総合管理用Stage A4 summaryをコピー
            </button>
            {copyState && (
              <div style={{ marginTop: 8, color: "#1d6b32", fontWeight: 800 }}>
                {copyState}
              </div>
            )}
          </section>
          <section style={styles.card}>
            <pre style={styles.pre}>{JSON.stringify(shortSummary(), null, 2)}</pre>
          </section>
        </>
      )}
    </main>
  );
}
