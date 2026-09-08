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
  tsvWordGroupRows,
} from "../stage-a4/runtime-tsv";
import { GT_MAP, EXPECTED_FILES, type GtImage } from "../stage-a4/gt";
import {
  buildLevel4LineProposals,
  combineRulesAndRescue,
  consolidateLineCandidates,
  filterToRulesUncoveredVerticalGaps,
  type StageA5SelectiveRow,
} from "../stage-a5/selective-tsv";
import { traceWordFallbackEligibility } from "../stage-a8/structure-trace";
import {
  buildSparseTextWordRows,
  detectAutoStructuralAbnormality,
  filterNovelRowsAgainstExisting,
} from "../stage-a9/targeted-split-alt";
import {
  decorateAltTopology,
  inferHorizontalColumnLanes,
} from "../stage-a11/anchored-lattice";
import { runPhaseLockedLattice } from "../stage-a12/phase-lattice";
import { selectLatePhaseReconsideration } from "../stage-a14/late-reconsideration";
import {
  decomposeLateCandidatePrecision,
  summarizeLateCandidatePrecision,
} from "./precision-decomposition";

type CandidateRow = {
  top: number;
  bottom: number;
  center: number;
  source: string;
};

type MappedCandidate = {
  candidateIndex: number;
  source: string;
  y1Norm: number;
  y2Norm: number;
  centerYNorm: number;
  matchedGtRowIndex: number | null;
};

const FROZEN_SOURCE_HEAD = "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";
const A14_SOURCE_HEAD = "b872da64487651b797251eb9eb9b43794be5cad4";
const EVAL_BRANCH = "eval/parts-ocr-stage-a15-late-candidate-precision-decomposition";
const EVAL_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || "unknown-preview-head";
const REVISION = "stage-a15-late-candidate-precision-decomposition-v1";

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto", padding: "16px 12px 60px", background: "#f5f7fb", minHeight: "100vh", color: "#172033" },
  card: { background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14, marginBottom: 12 },
  title: { margin: 0, fontSize: 24, fontWeight: 900 },
  text: { color: "#5b6678", lineHeight: 1.65, fontSize: 14 },
  primary: { width: "100%", border: 0, borderRadius: 13, padding: "14px 12px", background: "#2468df", color: "#fff", fontWeight: 800, fontSize: 17 },
  secondary: { width: "100%", border: 0, borderRadius: 13, padding: "12px", background: "#667085", color: "#fff", fontWeight: 800, fontSize: 15, marginTop: 8 },
  pre: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f7f9fc", border: "1px solid #e2e7ef", borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, maxHeight: 720, overflow: "auto" },
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
  return { canvas, rotate, rawWidth: img.naturalWidth, rawHeight: img.naturalHeight };
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
    if (count && hit / count > 0.2) xs.push(x);
  }
  const left = xs.length ? Math.max(0, xs[0] - step * 2) : 0;
  const right = xs.length ? Math.min(w - 1, xs[xs.length - 1] + step * 2) : w - 1;
  const width = right - left + 1;
  let boxHeight = roughBottom - top + 1;
  const expectedHeight = Math.round(width / 1.74);
  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) boxHeight = Math.min(expectedHeight, h - top);
  if (width < w * 0.55 || boxHeight < h * 0.25) return { x: 0, y: 0, w, h };
  return { x: left, y: top, w: width, h: boxHeight };
}

async function canvasBlob(canvas: HTMLCanvasElement, quality = 0.96) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像変換失敗")), "image/jpeg", quality),
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

function candidateToRawPoint(x: number, y: number, meta: any) {
  const sourceWidth = meta.autoRotate90CCW ? meta.rawHeight : meta.rawWidth;
  const sourceHeight = meta.autoRotate90CCW ? meta.rawWidth : meta.rawHeight;
  const sx = meta.geometryWidth / sourceWidth;
  const sy = meta.geometryHeight / sourceHeight;
  return meta.autoRotate90CCW ? { x: (meta.geometryHeight - y) / sy, y: x / sx } : { x: x / sx, y: y / sy };
}

function mapCandidate(row: CandidateRow, candidateIndex: number, paper: CropBox, meta: any, gt: GtImage): MappedCandidate {
  const corners = [
    [paper.x, row.top], [paper.x + paper.w, row.top], [paper.x, row.bottom + 1], [paper.x + paper.w, row.bottom + 1],
  ].map(([x, y]) => {
    const raw = candidateToRawPoint(x, y, meta);
    return rawToGtPoint(raw.x, raw.y, meta.rawWidth, meta.rawHeight, gt.rotationDeg);
  });
  const rawCenter = candidateToRawPoint(paper.x + paper.w / 2, row.center, meta);
  const center = rawToGtPoint(rawCenter.x, rawCenter.y, meta.rawWidth, meta.rawHeight, gt.rotationDeg);
  const centerYNorm = center.y / center.height;
  const y1Norm = Math.min(...corners.map((point) => point.y / point.height));
  const y2Norm = Math.max(...corners.map((point) => point.y / point.height));
  const containing = gt.rows.filter((g) => centerYNorm >= g.y1Norm && centerYNorm <= g.y2Norm);
  let match: any = null;
  if (containing.length) {
    match = [...containing].sort((a, b) => Math.abs(centerYNorm - (a.y1Norm + a.y2Norm) / 2) - Math.abs(centerYNorm - (b.y1Norm + b.y2Norm) / 2))[0];
  }
  return { candidateIndex, source: row.source, y1Norm, y2Norm, centerYNorm, matchedGtRowIndex: match?.rowIndex ?? null };
}

function coveredRows(rows: CandidateRow[], paper: CropBox, meta: any, gt: GtImage) {
  return Array.from(new Set(rows.map((row, index) => mapCandidate(row, index + 1, paper, meta, gt).matchedGtRowIndex).filter((v): v is number => v != null))).sort((a, b) => a - b);
}

function rulesRows(rgba: Uint8ClampedArray, width: number, height: number, paper: CropBox): StageA5SelectiveRow[] {
  const rules = detectHorizontalRuleBands(rgba, width, height, paper);
  return rowBandsFromRules(rules, paper).map((row) => ({ top: row.top, bottom: row.bottom, center: row.center, source: "rules" as const }));
}

function asRows(rows: Array<{ top: number; bottom: number; center: number; source: string }>): CandidateRow[] {
  return rows.map((row) => ({ ...row }));
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
}

export default function StageA15Page() {
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
    if (missing.length) { setStatus(`正式12枚が揃っていません。missing: ${missing.join(", ")}`); return; }

    setBusy(true); setResult(null); setCopyState("");
    let worker: any = null;
    try {
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      const images: any[] = [];

      for (let i = 0; i < EXPECTED_FILES.length; i += 1) {
        const fileName = EXPECTED_FILES[i];
        const file = byCanonical.get(fileName)!;
        const gt = GT_MAP.get(fileName)!;
        setStatus(`${i + 1}/12 ${fileName} Stage A15診断中…`);

        const color = await orientedColorCanvas(file);
        const paper = detectPaperBox(color.canvas);
        const colorCtx = color.canvas.getContext("2d", { willReadFrequently: true });
        if (!colorCtx) throw new Error("色保持geometryを取得できません。");
        const rgba = colorCtx.getImageData(0, 0, color.canvas.width, color.canvas.height).data;

        const prepared = await prepareOCRInputFile(file);
        const ocrSource = await fileCanvas(prepared);
        if (ocrSource.width !== color.canvas.width || ocrSource.height !== color.canvas.height) throw new Error(`${fileName}: TSV/OCR座標系とgeometryが不一致`);

        await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3", user_defined_dpi: "300", tessedit_char_whitelist: "" });
        const auto = await worker.recognize(await canvasBlob(ocrSource, 0.96), {}, { blocks: false, text: false, layoutBlocks: false, hocr: false, tsv: true, box: false, unlv: false, osd: false, pdf: false, imageColor: false, imageGrey: false, imageBinary: false, debug: false });
        const autoParsed = parseHeaderlessRuntimeTsv(String(auto.data.tsv || ""));
        const wordGroups = tsvWordGroupRows(autoParsed.records, paper);
        const ruleRows = rulesRows(rgba, color.canvas.width, color.canvas.height, paper);
        const lineBuild = buildLevel4LineProposals(autoParsed.records, paper);
        const consolidated = consolidateLineCandidates(lineBuild.lines);
        const gapSelective = filterToRulesUncoveredVerticalGaps(ruleRows, consolidated.rows);
        const dRows = combineRulesAndRescue(ruleRows, gapSelective.rows);
        const autoWordHeights = autoParsed.records.filter((record) => record.level === 5 && record.height > 0).map((record) => record.height);
        const maxAutoWordHeight = autoWordHeights.length ? Math.max(...autoWordHeights) : 0;
        const pathological = lineBuild.trace.level5WordCountInsidePaper <= 1 && maxAutoWordHeight > paper.h * 0.5;
        const autoFallbackTrace = traceWordFallbackEligibility({ records: autoParsed.records, paper, level4LineCount: lineBuild.trace.level4LineCountInsidePaper, pathological });
        const autoAbnormal = detectAutoStructuralAbnormality({ pathological, autoWordCount: autoFallbackTrace.wordCount, autoRowClusterCount: autoFallbackTrace.clustering.rowClusterCount, autoLevel4LineCount: lineBuild.trace.level4LineCountInsidePaper });

        await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11", user_defined_dpi: "300", tessedit_char_whitelist: "" });
        const alt = await worker.recognize(await canvasBlob(ocrSource, 0.96), {}, { blocks: false, text: false, layoutBlocks: false, hocr: false, tsv: true, box: false, unlv: false, osd: false, pdf: false, imageColor: false, imageGrey: false, imageBinary: false, debug: false });
        const altParsed = parseHeaderlessRuntimeTsv(String(alt.data.tsv || ""));
        const altProposals = buildSparseTextWordRows({ records: altParsed.records, paper });
        const altNovel = autoAbnormal.eligible ? filterNovelRowsAgainstExisting({ existing: dRows, proposed: altProposals.rows }) : { rows: [], trace: { inputCount: altProposals.rows.length, existingCount: dRows.length, outputCount: 0, altOnlyCandidateCount: 0, rejectedNearExisting: 0, medianReferenceHeight: 0, adaptiveMargin: 0 } };
        const laneInfo = inferHorizontalColumnLanes({ records: altParsed.records, paper });
        const topology = decorateAltTopology({ altRows: altNovel.rows, altRecords: altParsed.records, paper, lanes: laneInfo.lanes, laneTolerance: laneInfo.trace.laneTolerance, dRows, rawLines: lineBuild.lines, wordGroups: wordGroups.rows, ruleRows });
        const phaseP = runPhaseLockedLattice({ dRows, altRows: topology.rows, rawLines: lineBuild.lines, wordGroups: wordGroups.rows, ruleRows, selfSeeded: false });
        const lateSelection = selectLatePhaseReconsideration({ topologyRows: topology.rows, phaseResult: phaseP });

        const pAltRows = phaseP.acceptedCandidateIndexes.map((index) => altNovel.rows[index - 1]);
        const pRows: CandidateRow[] = [...asRows(dRows), ...pAltRows.map((row: any) => ({ top: row.top, bottom: row.bottom, center: row.center, source: "alt-phase-locked" }))].sort((a, b) => a.center - b.center);
        const lateRows = lateSelection.acceptedCandidateIndexes.map((index) => altNovel.rows[index - 1]);
        const a14Rows: CandidateRow[] = [...pRows, ...lateRows.map((row: any) => ({ top: row.top, bottom: row.bottom, center: row.center, source: "alt-late-phase-reconsideration" }))].sort((a, b) => a.center - b.center);
        const meta = { rawWidth: color.rawWidth, rawHeight: color.rawHeight, geometryWidth: color.canvas.width, geometryHeight: color.canvas.height, autoRotate90CCW: color.rotate };
        const pCoveredGtRows = coveredRows(pRows, paper, meta, gt);
        const a14CoveredGtRows = coveredRows(a14Rows, paper, meta, gt);

        const mappedTopology = topology.rows.map((candidate) => mapCandidate({ top: candidate.top, bottom: candidate.bottom, center: candidate.center, source: "alt-topology" }, candidate.candidateIndex, paper, meta, gt));
        const decompositionRows = decomposeLateCandidatePrecision({ topologyRows: topology.rows, phaseResult: phaseP, lateSelection, mappedCandidates: mappedTopology.map((row) => ({ candidateIndex: row.candidateIndex, matchedGtRowIndex: row.matchedGtRowIndex })), pCoveredGtRows });
        const precision = summarizeLateCandidatePrecision(decompositionRows);

        images.push({
          fileName,
          gtRowCount: gt.rowCount,
          pCoverage: pCoveredGtRows.length,
          a14Coverage: a14CoveredGtRows.length,
          pCoveredGtRows,
          a14CoveredGtRows,
          selectedPitch: phaseP.selectedPitch,
          phaseConsensusSupport: phaseP.phaseConsensusSupport,
          rowLikeCandidateCount: topology.trace.rowLikeCandidateCount,
          lateCandidateConsidered: lateSelection.lateCandidateConsidered,
          lateCandidateAccepted: lateSelection.lateCandidateAccepted,
          precisionCounts: precision.counts,
          candidates: precision.rows,
        });
      }

      const allCandidates = images.flatMap((image) => image.candidates.map((candidate: any) => ({ fileName: image.fileName, ...candidate })));
      const counts = {
        considered: allCandidates.length,
        accepted: allCandidates.filter((row) => row.accepted).length,
        correctAccepted: allCandidates.filter((row) => row.outcome === "CORRECT_ACCEPTED").length,
        falseAccepted: allCandidates.filter((row) => row.outcome === "FALSE_ACCEPTED").length,
        correctRejected: allCandidates.filter((row) => row.outcome === "CORRECT_REJECTED").length,
        falseRejected: allCandidates.filter((row) => row.outcome === "FALSE_REJECTED").length,
        newGtRecovery: allCandidates.filter((row) => row.postHocClass === "NEW_GT_RECOVERY").length,
        alreadyCoveredGtDuplicate: allCandidates.filter((row) => row.postHocClass === "ALREADY_COVERED_GT_DUPLICATE").length,
        other: allCandidates.filter((row) => row.postHocClass === "OTHER").length,
      };
      const imageMap = new Map(images.map((image) => [image.fileName, image]));
      const protection = {
        IMG_0678_row5_recovered: imageMap.get("IMG_0678(1)")?.a14CoveredGtRows.includes(5) || false,
        IMG_0685_row1_recovered: imageMap.get("IMG_0685(1)")?.a14CoveredGtRows.includes(1) || false,
        IMG_0677_coverage: imageMap.get("IMG_0677(1)")?.a14Coverage ?? null,
        IMG_0677_expected: 5,
        IMG_0684_coverage: imageMap.get("IMG_0684(1)")?.a14Coverage ?? null,
        IMG_0684_expected: 8,
      };
      const payload = {
        schema: "icb.parts-ocr.stage-a15-late-candidate-precision-decomposition.v1",
        revision: REVISION,
        evaluationBranch: EVAL_BRANCH,
        evaluationHead: EVAL_HEAD,
        frozenSourceHead: FROZEN_SOURCE_HEAD,
        a14SourceHead: A14_SOURCE_HEAD,
        evaluationSet: "formal-yellow-12",
        gtTotalRows: 54,
        diagnosticOnly: true,
        acceptanceChanged: false,
        gtUsage: "post-hoc candidate classification only; no GT OCR/proposal/rowLike/pitch/phase/assignment/acceptance/dedupe/control",
        counts,
        protection,
        candidates: allCandidates,
        images: images.map((image) => ({ fileName: image.fileName, pCoverage: image.pCoverage, a14Coverage: image.a14Coverage, selectedPitch: image.selectedPitch, phaseConsensusSupport: image.phaseConsensusSupport, rowLikeCandidateCount: image.rowLikeCandidateCount, lateCandidateConsidered: image.lateCandidateConsidered, lateCandidateAccepted: image.lateCandidateAccepted, precisionCounts: image.precisionCounts })),
        productionChanged: false,
        frozenChanged: false,
        adoptedHead: null,
        stageB: "HOLD",
      };
      setResult(payload);
      setStatus("Stage A15正式12枚診断完了。短縮summaryをコピーしてください。");
    } catch (error: any) {
      setStatus(`Stage A15診断失敗: ${error?.message || String(error)}`);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  const shortSummary = result ? JSON.stringify({
    schema: result.schema,
    revision: result.revision,
    evaluationBranch: result.evaluationBranch,
    evaluationHead: result.evaluationHead,
    frozenSourceHead: result.frozenSourceHead,
    a14SourceHead: result.a14SourceHead,
    evaluationSet: result.evaluationSet,
    gtTotalRows: result.gtTotalRows,
    diagnosticOnly: true,
    acceptanceChanged: false,
    counts: result.counts,
    protection: result.protection,
    candidates: result.candidates,
    productionChanged: false,
    frozenChanged: false,
    adoptedHead: null,
    stageB: "HOLD",
  }, null, 2) : "";

  return <main style={styles.page}>
    <section style={styles.card}>
      <h1 style={styles.title}>Parts OCR Stage A15</h1>
      <p style={styles.text}>Late Candidate Precision Decomposition。A14 acceptanceは変更せず、正式12枚のconsidered candidateをpost-hocで正解／false／rejectedに分解します。</p>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(event) => void run(event.target.files)} />
      <button style={styles.primary} disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "診断中…" : "黄色正式12枚を選択してStage A15診断"}</button>
      <p style={styles.text}>{status}</p>
    </section>

    {result && <>
      <section style={styles.card}>
        <button style={styles.primary} onClick={async () => { await copyText(shortSummary); setCopyState("総合管理用短縮summaryをコピーしました。"); }}>総合管理用短縮summaryをコピー</button>
        <button style={styles.secondary} onClick={async () => { await copyText(JSON.stringify(result, null, 2)); setCopyState("詳細診断JSONをコピーしました。"); }}>詳細診断JSONをコピー</button>
        {copyState && <p style={styles.text}>{copyState}</p>}
      </section>

      <section style={styles.card}>
        <strong>Aggregate</strong>
        <pre style={styles.pre}>{JSON.stringify({ counts: result.counts, protection: result.protection }, null, 2)}</pre>
      </section>

      <section style={styles.card}>
        <strong>Candidate comparison</strong>
        <pre style={styles.pre}>{JSON.stringify(result.candidates, null, 2)}</pre>
      </section>
    </>}
  </main>;
}
