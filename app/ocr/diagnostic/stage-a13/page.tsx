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
  traceWordFallbackEligibility,
} from "../stage-a8/structure-trace";
import {
  buildSparseTextWordRows,
  detectAutoStructuralAbnormality,
  filterNovelRowsAgainstExisting,
} from "../stage-a9/targeted-split-alt";
import {
  buildAltPruningContext,
  selectGapOnly,
} from "../stage-a10/alt-pruning";
import {
  decorateAltTopology,
  growAnchoredAltLattices,
  inferHorizontalColumnLanes,
} from "../stage-a11/anchored-lattice";
import {
  runPhaseLockedLattice,
} from "../stage-a12/phase-lattice";
import {
  diagnosePhaseLosses,
  summarizePhaseSuccess,
} from "./loss-decomposition";

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
const EVAL_BRANCH =
  "eval/parts-ocr-stage-a13-phase-loss-diagnostic";
const EVAL_HEAD =
  process.env.NEXT_PUBLIC_EVAL_HEAD || "unknown-preview-head";
const REVISION =
  "stage-a13-phase-lock-loss-decomposition-v1";

const EXPECTED_D = {
  candidateCount: 79,
  gtCoverage: 33,
  falseCount: 45,
  duplicateCount: 1,
};

const EXPECTED_A9_ALT = {
  gtCoverage: 44,
  falseCount: 98,
  duplicateCount: 15,
  newRescueVsD: 11,
};

const EXPECTED_A10_G = {
  candidateCount: 93,
  gtCoverage: 36,
  falseCount: 54,
  duplicateCount: 3,
  newRescueVsD: 3,
};

const EXPECTED_A11_L = {
  gtCoverage: 38,
  falseCount: 57,
  duplicateCount: 5,
  newRescueVsD: 5,
};

const EXPECTED_A12_P = {
  gtCoverage: 40,
  falseCount: 65,
  duplicateCount: 2,
  newRescueVsD: 7,
  retainedA9AltRescue: 7,
  correctRowRegressionVsD: 0,
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "16px 12px 60px",
    color: "#172033",
    background: "#f5f7fb",
    minHeight: "100vh",
  },
  card: {
    background: "#fff",
    border: "1px solid #dbe2ec",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 900,
  },
  text: {
    color: "#5b6678",
    lineHeight: 1.65,
    fontSize: 14,
  },
  primary: {
    width: "100%",
    border: 0,
    borderRadius: 13,
    padding: "14px 12px",
    background: "#2468df",
    color: "#fff",
    fontWeight: 800,
    fontSize: 17,
  },
  secondary: {
    width: "100%",
    border: 0,
    borderRadius: 13,
    padding: "12px",
    background: "#667085",
    color: "#fff",
    fontWeight: 800,
    fontSize: 15,
  },
  pre: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    background: "#f7f9fc",
    border: "1px solid #e2e7ef",
    borderRadius: 10,
    padding: 10,
    fontSize: 11,
    lineHeight: 1.45,
    maxHeight: 650,
    overflow: "auto",
  },
};

function canonicalFromName(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  return m ? `IMG_${m[1]}(1)` : "";
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を開けませんでした。"));
    };
    img.src = url;
  });
}

async function orientedColorCanvas(file: File) {
  const img = await loadImage(file);
  const rotate = img.naturalHeight > img.naturalWidth * 1.08;
  const sourceWidth = rotate ? img.naturalHeight : img.naturalWidth;
  const sourceHeight = rotate ? img.naturalWidth : img.naturalHeight;
  const scale = Math.min(
    1,
    1800 / Math.max(sourceWidth, sourceHeight),
  );

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
    let hit = 0;
    let count = 0;

    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) {
        hit += 1;
      }
      count += 1;
    }

    if (count && hit / count > 0.18) ys.push(y);
  }

  if (ys.length < 4) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 2);
  const roughBottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);

  const xs: number[] = [];

  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let count = 0;

    for (let y = top; y <= roughBottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) {
        hit += 1;
      }
      count += 1;
    }

    if (count && hit / count > 0.2) xs.push(x);
  }

  const left = xs.length ? Math.max(0, xs[0] - step * 2) : 0;
  const right = xs.length
    ? Math.min(w - 1, xs[xs.length - 1] + step * 2)
    : w - 1;

  const width = right - left + 1;
  let boxHeight = roughBottom - top + 1;
  const expectedHeight = Math.round(width / 1.74);

  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) {
    boxHeight = Math.min(expectedHeight, h - top);
  }

  if (width < w * 0.55 || boxHeight < h * 0.25) {
    return { x: 0, y: 0, w, h };
  }

  return { x: left, y: top, w: width, h: boxHeight };
}

async function canvasBlob(canvas: HTMLCanvasElement, quality = 0.96) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像変換失敗"))),
      "image/jpeg",
      quality,
    ),
  );
}

function rawToGtPoint(
  rawX: number,
  rawY: number,
  rawWidth: number,
  rawHeight: number,
  rotationDeg: number,
) {
  const r = ((rotationDeg % 360) + 360) % 360;

  if (r === 0) {
    return { x: rawX, y: rawY, width: rawWidth, height: rawHeight };
  }
  if (r === 90) {
    return { x: rawHeight - rawY, y: rawX, width: rawHeight, height: rawWidth };
  }
  if (r === 180) {
    return {
      x: rawWidth - rawX,
      y: rawHeight - rawY,
      width: rawWidth,
      height: rawHeight,
    };
  }
  if (r === 270) {
    return { x: rawY, y: rawWidth - rawX, width: rawHeight, height: rawWidth };
  }

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

function mapCandidate(
  row: CandidateRow,
  candidateIndex: number,
  paper: CropBox,
  meta: any,
  gt: GtImage,
): MappedCandidate {
  const corners = [
    [paper.x, row.top],
    [paper.x + paper.w, row.top],
    [paper.x, row.bottom + 1],
    [paper.x + paper.w, row.bottom + 1],
  ].map(([x, y]) => {
    const raw = candidateToRawPoint(x, y, meta);
    return rawToGtPoint(
      raw.x,
      raw.y,
      meta.rawWidth,
      meta.rawHeight,
      gt.rotationDeg,
    );
  });

  const rawCenter = candidateToRawPoint(
    paper.x + paper.w / 2,
    row.center,
    meta,
  );
  const center = rawToGtPoint(
    rawCenter.x,
    rawCenter.y,
    meta.rawWidth,
    meta.rawHeight,
    gt.rotationDeg,
  );

  const centerYNorm = center.y / center.height;
  const y1Norm = Math.min(...corners.map((point) => point.y / point.height));
  const y2Norm = Math.max(...corners.map((point) => point.y / point.height));

  const containing = gt.rows.filter(
    (g) => centerYNorm >= g.y1Norm && centerYNorm <= g.y2Norm,
  );

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

function scoreRows(
  rows: CandidateRow[],
  paper: CropBox,
  meta: any,
  gt: GtImage,
) {
  const mapped = rows.map((row, index) =>
    mapCandidate(row, index + 1, paper, meta, gt),
  );

  const assigned = new Map(gt.rows.map((row) => [row.rowIndex, 0]));

  for (const candidate of mapped) {
    if (candidate.matchedGtRowIndex != null) {
      assigned.set(
        candidate.matchedGtRowIndex,
        (assigned.get(candidate.matchedGtRowIndex) || 0) + 1,
      );
    }
  }

  const coveredGtRows = gt.rows
    .filter((row) => (assigned.get(row.rowIndex) || 0) > 0)
    .map((row) => row.rowIndex);

  const falseCount = mapped.filter(
    (candidate) => candidate.matchedGtRowIndex == null,
  ).length;

  const duplicateCount = gt.rows.reduce(
    (sum, row) =>
      sum + Math.max(0, (assigned.get(row.rowIndex) || 0) - 1),
    0,
  );

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

function mapPhasePositionsForGt(
  phaseResult: any,
  paper: CropBox,
  meta: any,
  gt: GtImage,
) {
  const assignment = phaseResult?.traces?.[0]?.assignment || [];

  return assignment.map((trace: any, index: number) => {
    const mapped = mapCandidate(
      {
        top: trace.phaseCenter,
        bottom: trace.phaseCenter,
        center: trace.phaseCenter,
        source: "phase-position",
      },
      index + 1,
      paper,
      meta,
      gt,
    );

    return {
      ...trace,
      centerYNorm: mapped.centerYNorm,
    };
  });
}

function rulesRows(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  paper: CropBox,
): StageA5SelectiveRow[] {
  const rules = detectHorizontalRuleBands(rgba, width, height, paper);

  return rowBandsFromRules(rules, paper).map((row) => ({
    top: row.top,
    bottom: row.bottom,
    center: row.center,
    source: "rules" as const,
  }));
}

function asRows(
  rows: Array<{
    top: number;
    bottom: number;
    center: number;
    source: string;
  }>,
): CandidateRow[] {
  return rows.map((row) => ({ ...row }));
}

function setDiff(a: number[], b: number[]) {
  const bs = new Set(b);
  return a.filter((value) => !bs.has(value));
}

function intersection(a: number[], b: number[]) {
  const bs = new Set(b);
  return a.filter((value) => bs.has(value));
}

function stageHasCenterHit(stage: any, rowIndex: number) {
  return stage.coveredGtRows.includes(rowIndex);
}

function stageHasBandOverlap(stage: any, gtRow: any) {
  return stage.mapped.some((candidate: MappedCandidate) => {
    const overlap =
      Math.min(candidate.y2Norm, gtRow.y2Norm) -
      Math.max(candidate.y1Norm, gtRow.y1Norm);
    return overlap > 0;
  });
}

function classifyBaselineMiss(args: {
  gtRow: any;
  rules: any;
  rawLine: any;
  consolidated: any;
  gapSelective: any;
  pathological: boolean;
}) {
  const {
    gtRow,
    rules,
    rawLine,
    consolidated,
    gapSelective,
    pathological,
  } = args;

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

function mechanismRescue(newRows: number[], baselineMissRows: any[]) {
  const out = { A: 0, B: 0, D: 0, other: 0 };

  for (const rowIndex of newRows) {
    const miss = baselineMissRows.find(
      (row) => row.gtRowIndex === rowIndex,
    );
    const mechanism = miss?.nonPathologicalMechanism;

    if (mechanism === "A" || mechanism === "B" || mechanism === "D") {
      out[mechanism as "A" | "B" | "D"] += 1;
    } else {
      out.other += 1;
    }
  }

  return out;
}

function summarizeVariant(images: any[], name: string) {
  const out = {
    candidateCount: 0,
    gtCoverage: 0,
    falseCount: 0,
    duplicateCount: 0,
    newRescueVsD: 0,
    retainedA9AltRescue: 0,
    lostA9AltRescue: 0,
    newRescueBeyondA9: 0,
    correctRowRegressionVsD: 0,
    altCandidateGenerated: 0,
    altCandidateAccepted: 0,
    altCandidateRejected: 0,
    falseReductionVsA9ALT: 0,
    duplicateReductionVsA9ALT: 0,
    latticeCount: 0,
    anchoredLatticeCount: 0,
    latticeCandidateCount: 0,
    columnLaneCount: 0,
    rowLikeCandidateCount: 0,
    pitchHypothesisCount: 0,
    selectedPitch: 0,
    phaseConsensusSupport: 0,
    selfSeededLatticeCount: 0,
    DAnchoredLatticeCount: 0,
    phasePositionCount: 0,
    phaseMatchedPositionCount: 0,
    phaseUnmatchedPositionCount: 0,
    mechanismRescue: { A: 0, B: 0, D: 0, other: 0 },
  };

  for (const image of images) {
    const v = image.variants[name];

    out.candidateCount += v.candidateCount;
    out.gtCoverage += v.gtCoverage;
    out.falseCount += v.falseCount;
    out.duplicateCount += v.duplicateCount;
    out.newRescueVsD += v.newRescueVsD;
    out.retainedA9AltRescue += v.retainedA9AltRescue;
    out.lostA9AltRescue += v.lostA9AltRescue;
    out.newRescueBeyondA9 += v.newRescueBeyondA9;
    out.correctRowRegressionVsD += v.correctRowRegressionVsD;
    out.altCandidateGenerated += v.altCandidateGenerated;
    out.altCandidateAccepted += v.altCandidateAccepted;
    out.altCandidateRejected += v.altCandidateRejected;
    out.latticeCount += v.latticeCount;
    out.anchoredLatticeCount += v.anchoredLatticeCount;
    out.latticeCandidateCount += v.latticeCandidateCount;
    out.columnLaneCount += v.columnLaneCount;
    out.rowLikeCandidateCount += v.rowLikeCandidateCount;
    out.pitchHypothesisCount += v.pitchHypothesisCount || 0;
    out.selectedPitch += v.selectedPitch || 0;
    out.phaseConsensusSupport += v.phaseConsensusSupport || 0;
    out.selfSeededLatticeCount += v.selfSeededLatticeCount || 0;
    out.DAnchoredLatticeCount += v.DAnchoredLatticeCount || 0;
    out.phasePositionCount += v.phasePositionCount || 0;
    out.phaseMatchedPositionCount += v.phaseMatchedPositionCount || 0;
    out.phaseUnmatchedPositionCount += v.phaseUnmatchedPositionCount || 0;

    for (const key of ["A", "B", "D", "other"] as const) {
      out.mechanismRescue[key] += v.mechanismRescue[key];
    }
  }

  const a9False = images.reduce(
    (sum, image) => sum + image.variants.A9_ALT_reference.falseCount,
    0,
  );
  const a9Duplicate = images.reduce(
    (sum, image) => sum + image.variants.A9_ALT_reference.duplicateCount,
    0,
  );

  out.falseReductionVsA9ALT = a9False - out.falseCount;
  out.duplicateReductionVsA9ALT = a9Duplicate - out.duplicateCount;

  return {
    ...out,
    recall: out.gtCoverage / 54,
    bothMiss: 54 - out.gtCoverage,
  };
}

function buildManagementShortSummary(source: any) {
  const importantNames = new Set([
    "IMG_0677(1)",
    "IMG_0682(1)",
    "IMG_0684(1)",
    "IMG_0685(1)",
    "IMG_0686(1)",
  ]);

  const importantImages = (source?.images || [])
    .filter((image: any) => importantNames.has(image.fileName))
    .map((image: any) => ({
      fileName: image.fileName,
      A9_ALT: image.variants?.A9_ALT_reference?.gtCoverage,
      A11_L: image.variants?.A11_L_reference?.gtCoverage,
      P: image.variants?.P_phaseLocked?.gtCoverage,
      rowLikeCandidateCount: image.rowLikeCandidateCount,
      acceptedALTCount:
        image.variants?.P_phaseLocked?.altCandidateAccepted,
      selectedPitch: image.phaseTrace?.selectedPitch,
      phaseConsensusSupport:
        image.phaseTrace?.phaseConsensusSupport,
      lostCorrectRowsByReason:
        image.lossDiagnostic?.reasonCounts,
      lostCorrectRows:
        (image.lossDiagnostic?.rows || []).map((row: any) => ({
          rowIndex: row.rowIndex,
          reason: row.reason,
        })),
      pNewRescueRows:
        image.pSuccessDiagnostic?.map((row: any) => row.rowIndex) || [],
    }));

  const p = source?.pReference || source?.aggregate?.P_phaseLocked;

  const summary = {
    schema: source?.schema,
    revision: source?.revision,
    evaluationBranch: source?.evaluationBranch,
    evaluationHead: source?.evaluationHead,
    frozenSourceHead: source?.sourceHead,
    referenceValidity: {
      A5D: source?.baseline?.matchesExpectedA5D,
      A9ALT: source?.a9AltReference?.matchesExpectedA9Alt,
      A10G: source?.a10GReference?.matchesExpectedA10G,
      A11L: source?.a11LReference?.matchesExpectedA11L,
      A12P: source?.pReference?.matchesExpectedA12P,
    },
    P_phaseLocked: p
      ? {
          candidateCount: p.candidateCount,
          gtCoverage: p.gtCoverage,
          recall: p.recall,
          falseCount: p.falseCount,
          duplicateCount: p.duplicateCount,
          newRescueVsD: p.newRescueVsD,
          retainedA9AltRescue: p.retainedA9AltRescue,
          lostA9AltRescue: p.lostA9AltRescue,
          correctRowRegressionVsD: p.correctRowRegressionVsD,
          mechanismRescue: p.mechanismRescue,
        }
      : null,
    lostCorrectRowCount: source?.lostCorrectRowCount,
    lossReasonAggregate: source?.lossReasonAggregate,
    importantImages,
    pathologicalTsvImages: source?.pathologicalTsvImages,
    productionChanged: false,
    frozenChanged: false,
    adoptedHead: null,
    stageB: "HOLD",
  };

  const pretty = JSON.stringify(summary, null, 2);
  if (pretty.length <= 6000) return pretty;

  return JSON.stringify(summary);
}

function parsePastedJson(text: string) {
  const trimmed = String(text || "").trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first < 0 || last <= first) {
    throw new Error("Full Diagnostic JSONを見つけられませんでした。");
  }

  return JSON.parse(trimmed.slice(first, last + 1));
}

async function copyText(text: string) {
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
}

export default function StageA13Page() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("黄色正式12枚を選択してください。");
  const [result, setResult] = useState<any>(null);
  const [copyState, setCopyState] = useState("");
  const [pastedFull, setPastedFull] = useState("");
  const [convertedShort, setConvertedShort] = useState("");

  async function run(files: FileList | null) {
    if (!files?.length) return;

    const byCanonical = new Map<string, File>();

    for (const file of Array.from(files)) {
      const id = canonicalFromName(file.name);
      if (id && !byCanonical.has(id)) byCanonical.set(id, file);
    }

    const missing = EXPECTED_FILES.filter((id) => !byCanonical.has(id));

    if (missing.length) {
      setStatus(
        `正式12枚が揃っていません。missing: ${missing.join(", ")}`,
      );
      return;
    }

    setBusy(true);
    setResult(null);
    setCopyState("");

    let worker: any = null;

    try {
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);

      const images: any[] = [];

      for (let i = 0; i < EXPECTED_FILES.length; i += 1) {
        const fileName = EXPECTED_FILES[i];
        const file = byCanonical.get(fileName)!;
        const gt = GT_MAP.get(fileName)!;

        setStatus(`${i + 1}/12 ${fileName} Stage A13診断中…`);

        const color = await orientedColorCanvas(file);
        const paper = detectPaperBox(color.canvas);

        const colorCtx = color.canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!colorCtx) {
          throw new Error("色保持geometryを取得できません。");
        }

        const rgba = colorCtx.getImageData(
          0,
          0,
          color.canvas.width,
          color.canvas.height,
        ).data;

        const prepared = await prepareOCRInputFile(file);
        const ocrSource = await fileCanvas(prepared);

        if (
          ocrSource.width !== color.canvas.width ||
          ocrSource.height !== color.canvas.height
        ) {
          throw new Error(
            `${fileName}: TSV/OCR座標系とgeometryが不一致`,
          );
        }

        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3",
          user_defined_dpi: "300",
          tessedit_char_whitelist: "",
        });

        const auto = await worker.recognize(
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

        const autoParsed = parseHeaderlessRuntimeTsv(
          String(auto.data.tsv || ""),
        );

        const wordGroups = tsvWordGroupRows(autoParsed.records, paper);
        const rawLineRows = tsvLineRows(autoParsed.records, paper);
        const ruleRows = rulesRows(
          rgba,
          color.canvas.width,
          color.canvas.height,
          paper,
        );

        const lineBuild = buildLevel4LineProposals(
          autoParsed.records,
          paper,
        );
        const consolidated = consolidateLineCandidates(lineBuild.lines);
        const gapSelective = filterToRulesUncoveredVerticalGaps(
          ruleRows,
          consolidated.rows,
        );
        const dRows = combineRulesAndRescue(ruleRows, gapSelective.rows);

        const autoWordHeights = autoParsed.records
          .filter((record) => record.level === 5 && record.height > 0)
          .map((record) => record.height);

        const maxAutoWordHeight = autoWordHeights.length
          ? Math.max(...autoWordHeights)
          : 0;

        const pathological =
          lineBuild.trace.level5WordCountInsidePaper <= 1 &&
          maxAutoWordHeight > paper.h * 0.5;

        const autoFallbackTrace = traceWordFallbackEligibility({
          records: autoParsed.records,
          paper,
          level4LineCount: lineBuild.trace.level4LineCountInsidePaper,
          pathological,
        });

        const autoAbnormal = detectAutoStructuralAbnormality({
          pathological,
          autoWordCount: autoFallbackTrace.wordCount,
          autoRowClusterCount: autoFallbackTrace.clustering.rowClusterCount,
          autoLevel4LineCount: lineBuild.trace.level4LineCountInsidePaper,
        });

        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
          user_defined_dpi: "300",
          tessedit_char_whitelist: "",
        });

        const alt = await worker.recognize(
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

        const altParsed = parseHeaderlessRuntimeTsv(
          String(alt.data.tsv || ""),
        );

        const altProposals = buildSparseTextWordRows({
          records: altParsed.records,
          paper,
        });

        const altNovel = autoAbnormal.eligible
          ? filterNovelRowsAgainstExisting({
              existing: dRows,
              proposed: altProposals.rows,
            })
          : {
              rows: [],
              trace: {
                inputCount: altProposals.rows.length,
                existingCount: dRows.length,
                outputCount: 0,
                altOnlyCandidateCount: 0,
                rejectedNearExisting: 0,
                medianReferenceHeight: 0,
                adaptiveMargin: 0,
              },
            };

        const a9AltRows: CandidateRow[] = [
          ...asRows(dRows),
          ...altNovel.rows.map((row: any) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: row.source,
          })),
        ].sort((a, b) => a.center - b.center);

        const a10Context = buildAltPruningContext({
          dRows,
          altRows: altNovel.rows,
          altRecords: altParsed.records,
          paper,
          rawLines: lineBuild.lines,
          wordGroups: wordGroups.rows,
          ruleRows,
        });

        const a10Selection = autoAbnormal.eligible
          ? selectGapOnly(a10Context)
          : {
              acceptedCandidateIndexes: [] as number[],
              slotAssignments: [] as any[],
            };

        const a10AltRows = a10Selection.acceptedCandidateIndexes.map(
          (index) => altNovel.rows[index - 1],
        );

        const a10Rows: CandidateRow[] = [
          ...asRows(dRows),
          ...a10AltRows.map((row: any) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: "a10-gap",
          })),
        ].sort((a, b) => a.center - b.center);

        const laneInfo = inferHorizontalColumnLanes({
          records: altParsed.records,
          paper,
        });

        const topology = decorateAltTopology({
          altRows: altNovel.rows,
          altRecords: altParsed.records,
          paper,
          lanes: laneInfo.lanes,
          laneTolerance: laneInfo.trace.laneTolerance,
          dRows,
          rawLines: lineBuild.lines,
          wordGroups: wordGroups.rows,
          ruleRows,
        });

        const latticeL = autoAbnormal.eligible
          ? growAnchoredAltLattices({
              dRows,
              altRows: topology.rows,
              rawLines: lineBuild.lines,
              wordGroups: wordGroups.rows,
              ruleRows,
              paper,
              useTopologyAcceptance: false,
            })
          : {
              selection: {
                acceptedCandidateIndexes: [] as number[],
                latticeCount: 0,
                anchoredLatticeCount: 0,
                latticeCandidateCount: 0,
                traces: [],
              },
              trace: {
                anchorCount: 0,
                rowLikeCandidateCount: topology.trace.rowLikeCandidateCount,
                pitch: 0,
                envelope: null,
                topologyAcceptanceFloor: null,
              },
            };

        const lAltRows = latticeL.selection.acceptedCandidateIndexes.map(
          (index) => altNovel.rows[index - 1],
        );

        const lRows: CandidateRow[] = [
          ...asRows(dRows),
          ...lAltRows.map((row: any) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: "alt-lattice",
          })),
        ].sort((a, b) => a.center - b.center);

        const phaseP = runPhaseLockedLattice({
          dRows,
          altRows: topology.rows,
          rawLines: lineBuild.lines,
          wordGroups: wordGroups.rows,
          ruleRows,
          selfSeeded: false,
        });

        const phasePSelf = runPhaseLockedLattice({
          dRows,
          altRows: topology.rows,
          rawLines: lineBuild.lines,
          wordGroups: wordGroups.rows,
          ruleRows,
          selfSeeded: true,
        });

        const pAltRows = phaseP.acceptedCandidateIndexes.map(
          (index) => altNovel.rows[index - 1],
        );
        const pSelfAltRows = phasePSelf.acceptedCandidateIndexes.map(
          (index) => altNovel.rows[index - 1],
        );

        const pRows: CandidateRow[] = [
          ...asRows(dRows),
          ...pAltRows.map((row: any) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: "alt-phase-locked",
          })),
        ].sort((a, b) => a.center - b.center);

        const pSelfRows: CandidateRow[] = [
          ...asRows(dRows),
          ...pSelfAltRows.map((row: any) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: "alt-phase-self-seeded",
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
          rawLine: scoreRows(asRows(rawLineRows), paper, meta, gt),
          consolidated: scoreRows(asRows(consolidated.rows), paper, meta, gt),
          gapSelective: scoreRows(asRows(gapSelective.rows), paper, meta, gt),
        };

        const dScore = scoreRows(asRows(dRows), paper, meta, gt);
        const a9AltScore = scoreRows(a9AltRows, paper, meta, gt);
        const a10Score = scoreRows(a10Rows, paper, meta, gt);
        const lScore = scoreRows(lRows, paper, meta, gt);
        const pScore = scoreRows(pRows, paper, meta, gt);
        const pSelfScore = scoreRows(pSelfRows, paper, meta, gt);
        const altNovelScore = scoreRows(
          altNovel.rows.map((row: any) => ({
            top: row.top,
            bottom: row.bottom,
            center: row.center,
            source: row.source,
          })),
          paper,
          meta,
          gt,
        );

        const phasePositions = mapPhasePositionsForGt(
          phaseP,
          paper,
          meta,
          gt,
        );

        const referenceCorrectRows = Array.from(
          new Set<number>([
            ...a9AltScore.coveredGtRows,
            ...lScore.coveredGtRows,
          ]),
        );

        const lostCorrectRows = setDiff(
          referenceCorrectRows,
          pScore.coveredGtRows,
        );

        const lossDiagnostic = diagnosePhaseLosses({
          lostRowIndices: lostCorrectRows,
          gtRows: gt.rows,
          altMapped: altNovelScore.mapped,
          topologyRows: topology.rows,
          phasePositions,
          selectedPitch: phaseP.selectedPitch,
          acceptedCandidateIndexes:
            phaseP.acceptedCandidateIndexes,
        });

        const pNewRescueRows = setDiff(
          pScore.coveredGtRows,
          dScore.coveredGtRows,
        );

        const pSuccessDiagnostic = summarizePhaseSuccess({
          rescuedRowIndices: pNewRescueRows,
          altMapped: altNovelScore.mapped,
          acceptedCandidateIndexes:
            phaseP.acceptedCandidateIndexes,
          phasePositions,
        });

        const baselineMissRows = gt.rows
          .filter((row) => !dScore.coveredGtRows.includes(row.rowIndex))
          .map((gtRow) => ({
            gtRowIndex: gtRow.rowIndex,
            ...classifyBaselineMiss({
              gtRow,
              rules: stages.rules,
              rawLine: stages.rawLine,
              consolidated: stages.consolidated,
              gapSelective: stages.gapSelective,
              pathological,
            }),
          }));

        const a9RescueRows = setDiff(
          a9AltScore.coveredGtRows,
          dScore.coveredGtRows,
        );

        function variantStats(
          score: any,
          acceptedAltCount: number,
          latticeInfo: any,
          phaseInfo: any = null,
        ) {
          const newRows = setDiff(
            score.coveredGtRows,
            dScore.coveredGtRows,
          );
          const regressionRows = setDiff(
            dScore.coveredGtRows,
            score.coveredGtRows,
          );

          return {
            candidateCount: score.candidateCount,
            gtCoverage: score.gtCoverage,
            recall: score.recall,
            falseCount: score.falseCount,
            duplicateCount: score.duplicateCount,
            coveredGtRows: score.coveredGtRows,
            newRescueVsD: newRows.length,
            newRescueRowsVsD: newRows,
            retainedA9AltRescue: intersection(
              newRows,
              a9RescueRows,
            ).length,
            lostA9AltRescue: setDiff(
              a9RescueRows,
              newRows,
            ).length,
            newRescueBeyondA9: setDiff(
              newRows,
              a9RescueRows,
            ).length,
            correctRowRegressionVsD: regressionRows.length,
            correctRowRegressionRowsVsD: regressionRows,
            bothMiss: gt.rowCount - score.gtCoverage,
            altCandidateGenerated: altProposals.rows.length,
            altCandidateAccepted: acceptedAltCount,
            altCandidateRejected: Math.max(
              0,
              altNovel.rows.length - acceptedAltCount,
            ),
            latticeCount: latticeInfo?.latticeCount || 0,
            anchoredLatticeCount:
              latticeInfo?.anchoredLatticeCount || 0,
            latticeCandidateCount:
              latticeInfo?.latticeCandidateCount || 0,
            columnLaneCount: laneInfo.lanes.length,
            rowLikeCandidateCount: topology.trace.rowLikeCandidateCount,
            pitchHypothesisCount: phaseInfo?.pitchHypothesisCount || 0,
            selectedPitch: phaseInfo?.selectedPitch || 0,
            phaseConsensusSupport: phaseInfo?.phaseConsensusSupport || 0,
            selfSeededLatticeCount:
              phaseInfo?.selfSeededLatticeCount || 0,
            DAnchoredLatticeCount:
              phaseInfo?.DAnchoredLatticeCount || 0,
            phasePositionCount: phaseInfo?.phasePositionCount || 0,
            phaseMatchedPositionCount:
              phaseInfo?.phaseMatchedPositionCount || 0,
            phaseUnmatchedPositionCount:
              phaseInfo?.phaseUnmatchedPositionCount || 0,
            mechanismRescue: mechanismRescue(
              newRows,
              baselineMissRows,
            ),
          };
        }

        const variants = {
          dBaseline: variantStats(dScore, 0, null, null),
          A9_ALT_reference: variantStats(
            a9AltScore,
            altNovel.rows.length,
            null,
            null,
          ),
          A10_G_reference: variantStats(
            a10Score,
            a10AltRows.length,
            null,
            null,
          ),
          A11_L_reference: variantStats(
            lScore,
            lAltRows.length,
            latticeL.selection,
            null,
          ),
          P_phaseLocked: variantStats(
            pScore,
            pAltRows.length,
            null,
            phaseP,
          ),
          P_SELF_phaseLockedSelfSeed: variantStats(
            pSelfScore,
            pSelfAltRows.length,
            null,
            phasePSelf,
          ),
        };

        images.push({
          fileName,
          gtRowCount: gt.rowCount,
          pathologicalTsvSegmentation: pathological,
          autoStructuralAbnormality: autoAbnormal,
          columnLaneCount: laneInfo.lanes.length,
          rowLikeCandidateCount: topology.trace.rowLikeCandidateCount,
          laneTrace: laneInfo.trace,
          topologyTrace: topology.trace,
          a11AnchorTrace: latticeL.trace,
          a11LatticeTrace: latticeL.selection,
          phaseTrace: phaseP,
          phaseSelfTrace: phasePSelf,
          lostCorrectRows,
          lossDiagnostic,
          pSuccessDiagnostic,
          variants,
        });
      }

      const baseline = summarizeVariant(images, "dBaseline");
      const a9AltReference = summarizeVariant(
        images,
        "A9_ALT_reference",
      );
      const a10GReference = summarizeVariant(
        images,
        "A10_G_reference",
      );
      const a11LReference = summarizeVariant(
        images,
        "A11_L_reference",
      );
      const pReference = summarizeVariant(
        images,
        "P_phaseLocked",
      );

      const lossReasonAggregate = {
        NO_ALT_CANDIDATE: 0,
        NOT_ROW_LIKE: 0,
        PITCH_HYPOTHESIS_MISS: 0,
        PHASE_RESIDUAL_REJECT: 0,
        ASSIGNMENT_LOSS: 0,
        DEDUPE_CONFLICT: 0,
        OTHER_GEOMETRY: 0,
      };

      let lostCorrectRowCount = 0;

      for (const image of images) {
        lostCorrectRowCount += image.lossDiagnostic?.lostRowCount || 0;

        for (const key of Object.keys(lossReasonAggregate)) {
          lossReasonAggregate[
            key as keyof typeof lossReasonAggregate
          ] += image.lossDiagnostic?.reasonCounts?.[key] || 0;
        }
      }

      const payload = {
        schema:
          "icb.parts-ocr.stage-a13-phase-lock-loss-decomposition.v1",
        revision: REVISION,
        evaluationBranch: EVAL_BRANCH,
        evaluationHead: EVAL_HEAD,
        sourceHead: SOURCE_HEAD,
        evaluationSet: "formal-yellow-12",
        gtTotalRows: 54,
        experimentOnly: true,
        diagnosticOnly: true,
        gtUsage:
          "post-hoc lost-row attribution/scoring only; no GT pitch, phase, rowLike, assignment, ranking, acceptance, OCR, preprocessing, stop, or control",
        baseline: {
          ...baseline,
          expectedA5D: EXPECTED_D,
          matchesExpectedA5D:
            baseline.candidateCount === EXPECTED_D.candidateCount &&
            baseline.gtCoverage === EXPECTED_D.gtCoverage &&
            baseline.falseCount === EXPECTED_D.falseCount &&
            baseline.duplicateCount === EXPECTED_D.duplicateCount,
        },
        a9AltReference: {
          ...a9AltReference,
          expectedA9Alt: EXPECTED_A9_ALT,
          matchesExpectedA9Alt:
            a9AltReference.gtCoverage === EXPECTED_A9_ALT.gtCoverage &&
            a9AltReference.falseCount === EXPECTED_A9_ALT.falseCount &&
            a9AltReference.duplicateCount === EXPECTED_A9_ALT.duplicateCount &&
            a9AltReference.newRescueVsD === EXPECTED_A9_ALT.newRescueVsD,
        },
        a10GReference: {
          ...a10GReference,
          expectedA10G: EXPECTED_A10_G,
          matchesExpectedA10G:
            a10GReference.candidateCount === EXPECTED_A10_G.candidateCount &&
            a10GReference.gtCoverage === EXPECTED_A10_G.gtCoverage &&
            a10GReference.falseCount === EXPECTED_A10_G.falseCount &&
            a10GReference.duplicateCount === EXPECTED_A10_G.duplicateCount &&
            a10GReference.newRescueVsD === EXPECTED_A10_G.newRescueVsD,
        },
        a11LReference: {
          ...a11LReference,
          expectedA11L: EXPECTED_A11_L,
          matchesExpectedA11L:
            a11LReference.gtCoverage === EXPECTED_A11_L.gtCoverage &&
            a11LReference.falseCount === EXPECTED_A11_L.falseCount &&
            a11LReference.duplicateCount === EXPECTED_A11_L.duplicateCount &&
            a11LReference.newRescueVsD === EXPECTED_A11_L.newRescueVsD,
        },
        pReference: {
          ...pReference,
          expectedA12P: EXPECTED_A12_P,
          matchesExpectedA12P:
            pReference.gtCoverage === EXPECTED_A12_P.gtCoverage &&
            pReference.falseCount === EXPECTED_A12_P.falseCount &&
            pReference.duplicateCount === EXPECTED_A12_P.duplicateCount &&
            pReference.newRescueVsD === EXPECTED_A12_P.newRescueVsD &&
            pReference.retainedA9AltRescue ===
              EXPECTED_A12_P.retainedA9AltRescue &&
            pReference.correctRowRegressionVsD ===
              EXPECTED_A12_P.correctRowRegressionVsD,
        },
        lostCorrectRowDefinition:
          "GT rows covered by A9 ALT or A11 L but not covered by P_phaseLocked",
        lostCorrectRowCount,
        lossReasonAggregate,
        images,
        pathologicalTsvImages: images
          .filter((image) => image.pathologicalTsvSegmentation)
          .map((image) => image.fileName),
        productionChanged: false,
        frozenChanged: false,
        adoptedHead: null,
        stageB: "HOLD",
      };
      setResult(payload);
      setStatus(
        "12/12 Stage A13診断完了。総合管理用短縮summaryをコピーできます。",
      );
    } catch (error) {
      setStatus(
        `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (worker) {
        await worker.terminate().catch(() => {});
      }
      setBusy(false);
    }
  }

  async function copyShort() {
    if (!result) return;

    const text = buildManagementShortSummary(result);
    await copyText(text);
    setCopyState(
      `総合管理用短縮summaryをコピーしました（${text.length}文字）。`,
    );
  }

  async function copyFull() {
    if (!result) return;

    await copyText(JSON.stringify(result, null, 2));
    setCopyState("詳細診断JSONをコピーしました。");
  }

  function convertPasted() {
    try {
      const parsed = parsePastedJson(pastedFull);
      setConvertedShort(buildManagementShortSummary(parsed));
    } catch (error) {
      setConvertedShort(
        `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function copyConverted() {
    if (!convertedShort || convertedShort.startsWith("ERROR:")) return;

    await copyText(convertedShort);
    setCopyState(
      `変換済み短縮summaryをコピーしました（${convertedShort.length}文字）。`,
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>
          Stage A13 Phase-Lock Loss Decomposition
        </h1>
        <p style={styles.text}>
          A12 P_phaseLockedを変更せず再現し、
          A9またはA11で正しく、Pで失われたrowを
          NO_ALT_CANDIDATE / NOT_ROW_LIKE / PITCH_HYPOTHESIS_MISS /
          PHASE_RESIDUAL_REJECT / ASSIGNMENT_LOSS / DEDUPE_CONFLICT /
          OTHER_GEOMETRYへpost-hoc分類します。
          新しいacceptance ruleやrow rescueは追加しません。
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
          {busy
            ? "Stage A13診断中…"
            : "黄色正式12枚を選択してStage A13診断"}
        </button>

        <div style={{ marginTop: 10, fontWeight: 800 }}>
          {status}
        </div>
      </section>

      {result && (
        <>
          <section style={styles.card}>
            <button style={styles.primary} onClick={copyShort}>
              総合管理用短縮summaryをコピー
            </button>

            <button
              style={{ ...styles.secondary, marginTop: 8 }}
              onClick={copyFull}
            >
              詳細診断JSONをコピー
            </button>

            {copyState && (
              <div
                style={{
                  marginTop: 8,
                  color: "#1d6b32",
                  fontWeight: 800,
                }}
              >
                {copyState}
              </div>
            )}
          </section>

          <section style={styles.card}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>
              Management Short Summary
            </h2>

            <pre style={styles.pre}>
              {buildManagementShortSummary(result)}
            </pre>
          </section>
        </>
      )}

      <section style={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>
          既存Full Diagnostic JSONから短縮summary生成
        </h2>

        <p style={styles.text}>
          summary短縮だけが目的の場合、黄色12枚の再テストは不要です。
        </p>

        <textarea
          value={pastedFull}
          onChange={(event) => setPastedFull(event.target.value)}
          placeholder="Full Diagnostic JSONを貼り付け"
          style={{
            width: "100%",
            minHeight: 160,
            boxSizing: "border-box",
            border: "1px solid #cfd8e6",
            borderRadius: 10,
            padding: 10,
            fontFamily: "monospace",
            fontSize: 12,
          }}
        />

        <button
          style={{ ...styles.secondary, marginTop: 8 }}
          onClick={convertPasted}
        >
          短縮summaryへ変換
        </button>

        {convertedShort && (
          <>
            <button
              style={{ ...styles.primary, marginTop: 8 }}
              onClick={copyConverted}
            >
              変換済み短縮summaryをコピー
            </button>

            <pre style={styles.pre}>
              {convertedShort}
            </pre>
          </>
        )}
      </section>
    </main>
  );
}
