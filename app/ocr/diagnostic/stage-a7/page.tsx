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
} from "../stage-a4/runtime-tsv";
import {
  GT_MAP,
  EXPECTED_FILES,
  type GtImage,
} from "../stage-a4/gt";
import {
  buildLevel4LineProposals,
  combineRulesAndRescue,
  consolidateLineCandidates,
  filterToRulesUncoveredVerticalGaps,
  type StageA5SelectiveRow,
} from "../stage-a5/selective-tsv";
import {
  buildWordGeometryFallback,
  filterNovelFallbackAgainstExisting,
  localizeRowsFromMutualGeometry,
  preserveDistinctRowsWithinConsolidation,
} from "./targeted-row-rescue";

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

const SOURCE_HEAD =
  "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";

const EXPECTED_A5_D = {
  candidateCount: 79,
  gtCoverage: 33,
  falseCount: 45,
  duplicateCount: 1,
};

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 920, margin: "0 auto", padding: "16px 12px 60px", color: "#172033", background: "#f5f7fb", minHeight: "100vh" },
  card: { background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14, marginBottom: 12 },
  title: { margin: 0, fontSize: 24, fontWeight: 900 },
  text: { color: "#5b6678", lineHeight: 1.65, fontSize: 14 },
  primary: { width: "100%", border: 0, borderRadius: 13, padding: "14px 12px", background: "#2468df", color: "#fff", fontWeight: 800, fontSize: 17 },
  pre: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f7f9fc", border: "1px solid #e2e7ef", borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, maxHeight: 700, overflow: "auto" },
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
    let hit = 0, count = 0;
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
    let hit = 0, count = 0;
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
  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) {
    boxHeight = Math.min(expectedHeight, h - top);
  }
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
  return meta.autoRotate90CCW
    ? { x: (meta.geometryHeight - y) / sy, y: x / sx }
    : { x: x / sx, y: y / sy };
}

function mapCandidate(row: CandidateRow, candidateIndex: number, paper: CropBox, meta: any, gt: GtImage): MappedCandidate {
  const corners = [
    [paper.x, row.top],
    [paper.x + paper.w, row.top],
    [paper.x, row.bottom + 1],
    [paper.x + paper.w, row.bottom + 1],
  ].map(([x, y]) => {
    const raw = candidateToRawPoint(x, y, meta);
    return rawToGtPoint(raw.x, raw.y, meta.rawWidth, meta.rawHeight, gt.rotationDeg);
  });
  const rawCenter = candidateToRawPoint(paper.x + paper.w / 2, row.center, meta);
  const center = rawToGtPoint(rawCenter.x, rawCenter.y, meta.rawWidth, meta.rawHeight, gt.rotationDeg);
  const centerYNorm = center.y / center.height;
  const y1Norm = Math.min(...corners.map((p) => p.y / p.height));
  const y2Norm = Math.max(...corners.map((p) => p.y / p.height));
  const containing = gt.rows.filter((g) => centerYNorm >= g.y1Norm && centerYNorm <= g.y2Norm);
  let match: any = null;
  if (containing.length) {
    match = [...containing].sort(
      (a, b) =>
        Math.abs(centerYNorm - (a.y1Norm + a.y2Norm) / 2) -
        Math.abs(centerYNorm - (b.y1Norm + b.y2Norm) / 2),
    )[0];
  }
  return {
    candidateIndex,
    source: row.source,
    y1Norm,
    y2Norm,
    centerYNorm,
    matchedGtRowIndex: match?.rowIndex ?? null,
  };
}

function scoreRows(rows: CandidateRow[], paper: CropBox, meta: any, gt: GtImage) {
  const mapped = rows.map((row, index) => mapCandidate(row, index + 1, paper, meta, gt));
  const assigned = new Map(gt.rows.map((row) => [row.rowIndex, 0]));
  for (const c of mapped) {
    if (c.matchedGtRowIndex != null) {
      assigned.set(c.matchedGtRowIndex, (assigned.get(c.matchedGtRowIndex) || 0) + 1);
    }
  }
  const coveredGtRows = gt.rows.filter((r) => (assigned.get(r.rowIndex) || 0) > 0).map((r) => r.rowIndex);
  const falseCount = mapped.filter((c) => c.matchedGtRowIndex == null).length;
  const duplicateCount = gt.rows.reduce((sum, r) => sum + Math.max(0, (assigned.get(r.rowIndex) || 0) - 1), 0);
  return {
    candidateCount: rows.length,
    gtCoverage: coveredGtRows.length,
    recall: gt.rowCount ? coveredGtRows.length / gt.rowCount : 0,
    falseCount,
    duplicateCount,
    coveredGtRows,
    mapped,
  };
}

function rulesRows(rgba: Uint8ClampedArray, width: number, height: number, paper: CropBox): StageA5SelectiveRow[] {
  const rules = detectHorizontalRuleBands(rgba, width, height, paper);
  return rowBandsFromRules(rules, paper).map((row) => ({
    top: row.top,
    bottom: row.bottom,
    center: row.center,
    source: "rules" as const,
  }));
}

function asRows(rows: Array<{ top: number; bottom: number; center: number; source: string }>): CandidateRow[] {
  return rows.map((row) => ({ ...row }));
}

function setDiff(a: number[], b: number[]) {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
}

function intersection(a: number[], b: number[]) {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

function stageHasCenterHit(stage: any, rowIndex: number) {
  return stage.coveredGtRows.includes(rowIndex);
}

function stageHasBandOverlap(stage: any, gtRow: any) {
  return stage.mapped.some((candidate: MappedCandidate) =>
    Math.min(candidate.y2Norm, gtRow.y2Norm) -
      Math.max(candidate.y1Norm, gtRow.y1Norm) >
    0,
  );
}

function classifyBaselineMiss(args: {
  gtRow: any;
  rules: any;
  rawLine: any;
  consolidated: any;
  gapSelective: any;
  pathological: boolean;
}) {
  const { gtRow, rules, rawLine, consolidated, gapSelective, pathological } = args;
  const ruleHit = stageHasCenterHit(rules, gtRow.rowIndex);
  const rawHit = stageHasCenterHit(rawLine, gtRow.rowIndex);
  const consolidatedHit = stageHasCenterHit(consolidated, gtRow.rowIndex);
  const gapHit = stageHasCenterHit(gapSelective, gtRow.rowIndex);
  const overlap =
    stageHasBandOverlap(rules, gtRow) ||
    stageHasBandOverlap(rawLine, gtRow) ||
    stageHasBandOverlap(consolidated, gtRow) ||
    stageHasBandOverlap(gapSelective, gtRow);

  let mechanism = "F";
  if (rawHit && !consolidatedHit) mechanism = "B";
  else if (consolidatedHit && !gapHit) mechanism = "C";
  else if (!ruleHit && !rawHit && overlap) mechanism = "D";
  else if (!ruleHit && !rawHit && !overlap) mechanism = "A";

  return {
    classification: pathological ? "E" : mechanism,
    nonPathologicalMechanism: mechanism,
  };
}

function summarizeVariant(images: any[], variantName: string) {
  const out = {
    candidateCount: 0,
    gtCoverage: 0,
    falseCount: 0,
    duplicateCount: 0,
    dBaselineNewRescue: 0,
    dBaselineCorrectRowRegression: 0,
    bothMiss: 0,
    mechanismRescueCounts: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
    lostA4RescueRecovered: 0,
  };

  for (const image of images) {
    const v = image.variants[variantName];
    out.candidateCount += v.candidateCount;
    out.gtCoverage += v.gtCoverage;
    out.falseCount += v.falseCount;
    out.duplicateCount += v.duplicateCount;

    const rescued = setDiff(v.coveredGtRows, image.variants.dBaseline.coveredGtRows);
    const regressed = setDiff(image.variants.dBaseline.coveredGtRows, v.coveredGtRows);

    out.dBaselineNewRescue += rescued.length;
    out.dBaselineCorrectRowRegression += regressed.length;

    for (const rowIndex of rescued) {
      const miss = image.baselineMissRows.find((x: any) => x.gtRowIndex === rowIndex);
      const key = (miss?.classification || "F") as keyof typeof out.mechanismRescueCounts;
      out.mechanismRescueCounts[key] += 1;
    }

    out.lostA4RescueRecovered += intersection(
      rescued,
      image.lostA4RescueRows,
    ).length;
  }

  out.bothMiss = 54 - out.gtCoverage;

  return {
    ...out,
    recall: out.gtCoverage / 54,
  };
}

export default function StageA7Page() {
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
        setStatus(`${i + 1}/12 ${fileName} Stage A7解析中…`);

        const color = await orientedColorCanvas(file);
        const paper = detectPaperBox(color.canvas);
        const colorCtx = color.canvas.getContext("2d", { willReadFrequently: true });
        if (!colorCtx) throw new Error("色保持geometryを取得できません。");

        const rgba = colorCtx.getImageData(0, 0, color.canvas.width, color.canvas.height).data;
        const prepared = await prepareOCRInputFile(file);
        const ocrSource = await fileCanvas(prepared);

        if (ocrSource.width !== color.canvas.width || ocrSource.height !== color.canvas.height) {
          throw new Error(`${fileName}: TSV/OCR座標系とgeometryが不一致`);
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

        const parsed = parseHeaderlessRuntimeTsv(String(full.data.tsv || ""));
        const wordGroups = tsvWordGroupRows(parsed.records, paper);
        const rawLineRows = tsvLineRows(parsed.records, paper);
        const ruleRows = rulesRows(rgba, color.canvas.width, color.canvas.height, paper);

        const lineBuild = buildLevel4LineProposals(parsed.records, paper);
        const consolidated = consolidateLineCandidates(lineBuild.lines);
        const baseGap = filterToRulesUncoveredVerticalGaps(ruleRows, consolidated.rows);
        const dRows = combineRulesAndRescue(ruleRows, baseGap.rows);

        const preserved = preserveDistinctRowsWithinConsolidation({
          rawLines: lineBuild.lines,
          consolidated: consolidated.rows,
          wordGroups: wordGroups.rows,
        });
        const pGap = filterToRulesUncoveredVerticalGaps(ruleRows, preserved.rows);
        const pRows = combineRulesAndRescue(ruleRows, pGap.rows);

        const localized = localizeRowsFromMutualGeometry({
          rows: consolidated.rows,
          rawLines: lineBuild.lines,
          wordGroups: wordGroups.rows,
        });
        const lGap = filterToRulesUncoveredVerticalGaps(ruleRows, localized.rows);
        const lRows = combineRulesAndRescue(ruleRows, lGap.rows);

        const localizedPreserved = localizeRowsFromMutualGeometry({
          rows: preserved.rows,
          rawLines: lineBuild.lines,
          wordGroups: wordGroups.rows,
        });
        const plGap = filterToRulesUncoveredVerticalGaps(ruleRows, localizedPreserved.rows);
        const plRows = combineRulesAndRescue(ruleRows, plGap.rows);

        const wordHeights = parsed.records
          .filter((record) => record.level === 5 && record.height > 0)
          .map((record) => record.height);
        const maxWordHeight = wordHeights.length ? Math.max(...wordHeights) : 0;
        const pathological =
          lineBuild.trace.level5WordCountInsidePaper <= 1 &&
          maxWordHeight > paper.h * 0.5;

        const fallback = buildWordGeometryFallback({
          records: parsed.records,
          paper,
          level4LineCount: lineBuild.trace.level4LineCountInsidePaper,
          pathological,
        });

        const novelFallback = filterNovelFallbackAgainstExisting({
          existing: plRows,
          fallback: fallback.rows,
        });

        const fRows: CandidateRow[] = [
          ...asRows(plRows),
          ...novelFallback.rows.map((row) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: "word-geometry-fallback",
          })),
        ].sort((a, b) => a.center - b.center);

        const meta = {
          rawWidth: color.rawWidth,
          rawHeight: color.rawHeight,
          geometryWidth: color.canvas.width,
          geometryHeight: color.canvas.height,
          autoRotate90CCW: color.rotate,
        };

        const stages = {
          rules: scoreRows(asRows(ruleRows), paper, meta, gt),
          rawTsvLine: scoreRows(asRows(rawLineRows), paper, meta, gt),
          consolidated: scoreRows(asRows(consolidated.rows), paper, meta, gt),
          gapSelective: scoreRows(asRows(baseGap.rows), paper, meta, gt),
        };

        const variants: Record<string, any> = {
          dBaseline: scoreRows(asRows(dRows), paper, meta, gt),
          P_consolidationPreservation: scoreRows(asRows(pRows), paper, meta, gt),
          L_localizationCorrection: scoreRows(asRows(lRows), paper, meta, gt),
          PL_preservationPlusLocalization: scoreRows(asRows(plRows), paper, meta, gt),
          F_PLPlusConditionalWordFallback: scoreRows(fRows, paper, meta, gt),
        };

        const baselineMissRows = gt.rows
          .filter((row) => !variants.dBaseline.coveredGtRows.includes(row.rowIndex))
          .map((gtRow) => ({
            gtRowIndex: gtRow.rowIndex,
            ...classifyBaselineMiss({
              gtRow,
              rules: stages.rules,
              rawLine: stages.rawTsvLine,
              consolidated: stages.consolidated,
              gapSelective: stages.gapSelective,
              pathological,
            }),
          }));

        const a4LineNewRescueRows = setDiff(
          stages.rawTsvLine.coveredGtRows,
          stages.rules.coveredGtRows,
        );

        const lostA4RescueRows = a4LineNewRescueRows.filter(
          (rowIndex: number) => !variants.dBaseline.coveredGtRows.includes(rowIndex),
        );

        const perVariant = Object.fromEntries(
          Object.entries(variants).map(([name, value]: any) => {
            const newRescueRows = setDiff(value.coveredGtRows, variants.dBaseline.coveredGtRows);
            const regressionRows = setDiff(variants.dBaseline.coveredGtRows, value.coveredGtRows);
            return [
              name,
              {
                candidateCount: value.candidateCount,
                gtCoverage: value.gtCoverage,
                recall: value.recall,
                falseCount: value.falseCount,
                duplicateCount: value.duplicateCount,
                coveredGtRows: value.coveredGtRows,
                dBaselineNewRescueRows: newRescueRows,
                dBaselineCorrectRowRegressionRows: regressionRows,
                bothMiss: gt.rowCount - value.gtCoverage,
              },
            ];
          }),
        );

        images.push({
          fileName,
          gtRowCount: gt.rowCount,
          pathologicalTsvSegmentation: pathological,
          pipelineTrace: {
            rawTsvLineCount: rawLineRows.length,
            consolidatedCount: consolidated.rows.length,
            preservedCount: preserved.rows.length,
            localizedCount: localized.rows.length,
            localizedPreservedCount: localizedPreserved.rows.length,
            baselineGapRescueCount: baseGap.rows.length,
            pGapRescueCount: pGap.rows.length,
            lGapRescueCount: lGap.rows.length,
            plGapRescueCount: plGap.rows.length,
            fallbackEligible: fallback.eligible,
            fallbackCandidateCount: fallback.rows.length,
            novelFallbackCount: novelFallback.rows.length,
          },
          preservationTrace: preserved.trace,
          localizationTrace: localized.trace,
          plLocalizationTrace: localizedPreserved.trace,
          fallbackTrace: fallback.trace,
          novelFallbackTrace: novelFallback.trace,
          baselineMissRows,
          a4LineNewRescueRows,
          lostA4RescueRows,
          variants: perVariant,
        });
      }

      const names = [
        "P_consolidationPreservation",
        "L_localizationCorrection",
        "PL_preservationPlusLocalization",
        "F_PLPlusConditionalWordFallback",
      ];

      const aggregate = Object.fromEntries(
        names.map((name) => [name, summarizeVariant(images, name)]),
      );

      const baseline = summarizeVariant(images, "dBaseline");

      const payload = {
        schema: "icb.parts-ocr.stage-a7-targeted-row-rescue.v1",
        sourceHead: SOURCE_HEAD,
        evaluationSet: "formal-yellow-12",
        gtTotalRows: 54,
        experimentOnly: true,
        gtUsage:
          "post-hoc scoring and rescue/regression attribution only; no GT candidate generation, selection, filtering, thresholding, or control",
        baseline: {
          ...baseline,
          expectedA5D: EXPECTED_A5_D,
          matchesExpectedA5D:
            baseline.candidateCount === EXPECTED_A5_D.candidateCount &&
            baseline.gtCoverage === EXPECTED_A5_D.gtCoverage &&
            baseline.falseCount === EXPECTED_A5_D.falseCount &&
            baseline.duplicateCount === EXPECTED_A5_D.duplicateCount,
        },
        aggregate,
        images,
      };

      setResult(payload);
      setStatus("12/12 Stage A7解析完了。summaryをコピーできます。");
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
      baseline: result.baseline,
      aggregate: result.aggregate,
      images: result.images.map((image: any) => ({
        fileName: image.fileName,
        gtRowCount: image.gtRowCount,
        pathologicalTsvSegmentation: image.pathologicalTsvSegmentation,
        pipelineTrace: image.pipelineTrace,
        preservationTrace: image.preservationTrace,
        localizationTrace: image.localizationTrace,
        plLocalizationTrace: image.plLocalizationTrace,
        fallbackTrace: image.fallbackTrace,
        novelFallbackTrace: image.novelFallbackTrace,
        baselineMissRows: image.baselineMissRows,
        a4LineNewRescueRows: image.a4LineNewRescueRows,
        lostA4RescueRows: image.lostA4RescueRows,
        variants: image.variants,
      })),
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
        <h1 style={styles.title}>Stage A7 Targeted Row Rescue</h1>
        <p style={styles.text}>
          A5-Dを固定baselineとして、P / L / PL / Fの最小追加variantだけを比較します。
          GTは全candidate生成後のpost-hoc scoring・rescue attributionだけに使用します。
        </p>
        <p style={styles.text}>
          P: consolidation preservation
          <br />
          L: localization / band correction
          <br />
          PL: preservation + localization
          <br />
          F: PL + pathological/upstream時のみsingle word-geometry fallback
        </p>
      </section>

      <section style={styles.card}>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => run(event.target.files)}
        />
        <button
          style={styles.primary}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Stage A7解析中…" : "黄色正式12枚を選択してStage A7実行"}
        </button>
        <div style={{ marginTop: 10, fontWeight: 800, fontSize: 14 }}>
          {status}
        </div>
      </section>

      {result && (
        <>
          <section style={styles.card}>
            <button style={styles.primary} onClick={copySummary}>
              総合管理用Stage A7 summaryをコピー
            </button>
            {copyState && (
              <div style={{ marginTop: 8, color: "#1d6b32", fontWeight: 800 }}>
                {copyState}
              </div>
            )}
          </section>
          <section style={styles.card}>
            <pre style={styles.pre}>
              {JSON.stringify(shortSummary(), null, 2)}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
