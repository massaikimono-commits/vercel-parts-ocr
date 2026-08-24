import type { DocumentVariantName, ImageQuality, PreparedDocument } from "./document-image-pipeline";

export type RecognitionSource =
  | "qr"
  | "barcode"
  | "cell"
  | "global"
  | "derived"
  | "history"
  | "manual";

export type RecognitionCandidate = {
  value: string;
  source: RecognitionSource;
  variant?: DocumentVariantName;
  confidence?: number;
  region?: string;
  raw?: string;
};

export type RecognitionDecision = {
  value: string;
  confidence: number;
  score: number;
  sources: RecognitionSource[];
  candidates: RecognitionCandidate[];
  reason: string;
};

export type RecognitionFieldRule = {
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
  normalize?: (value: string) => string;
  validate?: (value: string) => boolean;
  score?: (value: string, candidate: RecognitionCandidate) => number;
  minScore?: number;
  requireAgreement?: boolean;
};

export type RecognitionBudget = {
  startedAt: number;
  deadlineAt: number;
  maxPasses: number;
  passes: number;
  stopped: boolean;
};

export type TextBand = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

export type DeskewResult = {
  canvas: HTMLCanvasElement;
  angle: number;
  applied: boolean;
  confidence: number;
};

export type RecognitionPlan = {
  variantOrder: DocumentVariantName[];
  cellFirst: boolean;
  useDeskew: boolean;
  useTextBands: boolean;
  allowHeavyFallback: boolean;
  maxGlobalPasses: number;
  warnings: string[];
};

const SOURCE_WEIGHT: Record<RecognitionSource, number> = {
  qr: 100,
  barcode: 90,
  manual: 100,
  derived: 62,
  cell: 30,
  history: 24,
  global: 15,
};

function createCanvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function normalizeSpace(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeConfusableText(
  value: string,
  mode: "text" | "numeric" | "alnum" | "date" = "text",
) {
  let out = normalizeSpace(value);
  if (mode === "numeric") {
    return out
      .replace(/[OoＯｏ]/g, "0")
      .replace(/[Il|ｌＩ]/g, "1")
      .replace(/[^0-9.,+\-]/g, "")
      .replace(/,/g, "");
  }
  if (mode === "alnum") {
    out = out.toUpperCase().replace(/\s+/g, "");
    return out.replace(/[‐‑‒–—―ー]/g, "-");
  }
  if (mode === "date") {
    return out
      .replace(/[OoＯｏ](?=\d)|(?<=\d)[OoＯｏ]/g, "0")
      .replace(/[Il|](?=\d)|(?<=\d)[Il|]/g, "1");
  }
  return out;
}

function regexTest(pattern: RegExp, value: string) {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function candidateKey(value: string) {
  return normalizeSpace(value).replace(/\s+/g, " ");
}

/**
 * Weighted consensus selector used by every document type.
 * QR/barcode/manual sources dominate, while OCR needs either a strong rule score
 * or agreement across passes before it is automatically accepted.
 */
export function decideRecognitionField(
  input: RecognitionCandidate[],
  rule: RecognitionFieldRule = {},
): RecognitionDecision {
  const normalized: RecognitionCandidate[] = [];
  for (const candidate of input) {
    let value = normalizeSpace(candidate.value || "");
    if (rule.normalize) value = rule.normalize(value);
    if (!value) continue;
    if (rule.minLength && value.length < rule.minLength) continue;
    if (rule.maxLength && value.length > rule.maxLength) continue;
    if (rule.pattern && !regexTest(rule.pattern, value)) continue;
    if (rule.validate && !rule.validate(value)) continue;
    normalized.push({ ...candidate, value });
  }

  if (!normalized.length) {
    return { value: "", confidence: 0, score: 0, sources: [], candidates: [], reason: "候補なし" };
  }

  const groups = new Map<string, RecognitionCandidate[]>();
  for (const candidate of normalized) {
    const key = candidateKey(candidate.value);
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }

  let bestValue = "";
  let bestScore = -Infinity;
  let bestGroup: RecognitionCandidate[] = [];
  let bestReason = "";

  for (const [value, group] of groups) {
    const uniqueSources = [...new Set(group.map(x => x.source))];
    const uniqueVariants = [...new Set(group.map(x => x.variant).filter(Boolean))];
    const strongest = Math.max(...group.map(x => SOURCE_WEIGHT[x.source]));
    const sourceSupport = uniqueSources.reduce((sum, s) => sum + Math.min(35, SOURCE_WEIGHT[s] * 0.28), 0);
    const agreement = Math.max(0, group.length - 1) * 13 + Math.max(0, uniqueVariants.length - 1) * 7;
    const confidenceBonus = group.reduce((sum, c) => sum + Math.max(0, Math.min(1, c.confidence ?? 0.5)) * 6, 0);
    const custom = group.reduce((sum, c) => sum + (rule.score ? rule.score(value, c) : 0), 0);
    const score = strongest + sourceSupport + agreement + confidenceBonus + custom;

    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
      bestGroup = group;
      bestReason = `最強ソース=${uniqueSources.join(",")} / 一致=${group.length} / variant=${uniqueVariants.length || 1}`;
    }
  }

  const strongAuthority = bestGroup.some(c => ["qr", "barcode", "manual"].includes(c.source));
  const agreementCount = bestGroup.length;
  const minScore = rule.minScore ?? 48;
  const accepted = bestScore >= minScore && (!rule.requireAgreement || strongAuthority || agreementCount >= 2);
  if (!accepted) {
    return {
      value: "",
      confidence: Math.max(0, Math.min(0.59, bestScore / 130)),
      score: bestScore,
      sources: [...new Set(bestGroup.map(x => x.source))],
      candidates: bestGroup,
      reason: `保留: ${bestReason}`,
    };
  }

  const confidence = Math.max(0, Math.min(1, 0.38 + bestScore / 180 + Math.min(0.18, (agreementCount - 1) * 0.06)));
  return {
    value: bestValue,
    confidence,
    score: bestScore,
    sources: [...new Set(bestGroup.map(x => x.source))],
    candidates: bestGroup,
    reason: `採用: ${bestReason}`,
  };
}

export function createRecognitionBudget(totalMs = 45_000, maxPasses = 12): RecognitionBudget {
  const now = performance.now();
  return { startedAt: now, deadlineAt: now + totalMs, maxPasses, passes: 0, stopped: false };
}

export function canRunRecognitionPass(budget: RecognitionBudget, reserveMs = 0) {
  if (budget.stopped) return false;
  if (budget.passes >= budget.maxPasses) return false;
  return performance.now() + reserveMs < budget.deadlineAt;
}

export function consumeRecognitionPass(budget: RecognitionBudget) {
  budget.passes += 1;
  if (budget.passes >= budget.maxPasses || performance.now() >= budget.deadlineAt) budget.stopped = true;
  return budget;
}

export function stopRecognitionBudget(budget: RecognitionBudget) {
  budget.stopped = true;
}

function sampleCanvas(source: HTMLCanvasElement, maxSide = 650) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const out = createCanvas(source.width * scale, source.height * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function grayscale(source: HTMLCanvasElement) {
  const ctx = source.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, source.width, source.height);
  const gray = new Uint8Array(source.width * source.height);
  let sum = 0;
  for (let i = 0, p = 0; i < image.data.length; i += 4, p++) {
    const g = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
    gray[p] = g;
    sum += g;
  }
  return { gray, width: source.width, height: source.height, mean: sum / Math.max(1, gray.length) };
}

/** Detect horizontal text bands without running OCR. */
export function detectTextBands(
  source: HTMLCanvasElement,
  options: { maxBands?: number; minHeightRatio?: number; maxHeightRatio?: number } = {},
): TextBand[] {
  const small = sampleCanvas(source, 720);
  const { gray, width, height, mean } = grayscale(small);
  const threshold = Math.max(70, Math.min(210, mean - 24));
  const inkByRow = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x += 2) {
      const p = y * width + x;
      const g = gray[p];
      const left = x > 0 ? gray[p - 1] : g;
      const right = x + 1 < width ? gray[p + 1] : g;
      if (g < threshold || Math.abs(right - left) > 38) ink++;
    }
    inkByRow[y] = ink / Math.max(1, Math.ceil(width / 2));
  }

  const active = new Uint8Array(height);
  for (let y = 1; y < height - 1; y++) {
    const local = (inkByRow[y - 1] + inkByRow[y] + inkByRow[y + 1]) / 3;
    if (local > 0.045) active[y] = 1;
  }

  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const on = y < height ? active[y] : 0;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      runs.push([start, y - 1]);
      start = -1;
    }
  }

  const merged: Array<[number, number]> = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run[0] - prev[1] <= Math.max(3, height * 0.006)) prev[1] = run[1];
    else merged.push([...run]);
  }

  const minH = height * (options.minHeightRatio ?? 0.006);
  const maxH = height * (options.maxHeightRatio ?? 0.095);
  const sx = source.width / width;
  const sy = source.height / height;
  const bands: TextBand[] = [];

  for (const [y1, y2] of merged) {
    const h = y2 - y1 + 1;
    if (h < minH || h > maxH) continue;
    let score = 0;
    for (let y = y1; y <= y2; y++) score += inkByRow[y];
    score /= Math.max(1, h);
    bands.push({
      x: 0,
      y: Math.max(0, Math.round((y1 - 2) * sy)),
      width: source.width,
      height: Math.min(source.height, Math.round((h + 4) * sy)),
      confidence: Math.max(0, Math.min(1, score * 5.5)),
    });
  }

  return bands
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, options.maxBands ?? 80)
    .sort((a, b) => a.y - b.y);
}

/**
 * Estimates small camera skew by maximizing horizontal projection sharpness.
 * This runs only on a small sample and is safe enough for iPhone Safari.
 */
export function estimateSkewAngle(source: HTMLCanvasElement, maxDegrees = 4, step = 0.5) {
  const small = sampleCanvas(source, 560);
  const { gray, width, height, mean } = grayscale(small);
  const threshold = Math.max(65, Math.min(205, mean - 30));
  const points: Array<[number, number]> = [];
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const p = y * width + x;
      if (gray[p] < threshold && Math.abs(gray[p + 1] - gray[p - 1]) + Math.abs(gray[p + width] - gray[p - width]) > 28) {
        points.push([x - width / 2, y - height / 2]);
      }
    }
  }
  if (points.length < 180) return { angle: 0, confidence: 0 };

  let bestAngle = 0;
  let bestScore = -Infinity;
  let second = -Infinity;
  for (let angle = -maxDegrees; angle <= maxDegrees + 0.0001; angle += step) {
    const rad = (angle * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const rows = new Uint16Array(height + 80);
    for (const [x, y] of points) {
      const ry = Math.round(x * sin + y * cos + rows.length / 2);
      if (ry >= 0 && ry < rows.length) rows[ry]++;
    }
    let score = 0;
    for (let i = 1; i < rows.length - 1; i++) {
      const v = rows[i];
      score += v * v + Math.abs(v - rows[i - 1]) * 0.7;
    }
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      bestAngle = angle;
    } else if (score > second) second = score;
  }

  const separation = bestScore > 0 ? Math.max(0, (bestScore - second) / bestScore) : 0;
  return { angle: bestAngle, confidence: Math.max(0, Math.min(1, separation * 8 + points.length / 14000)) };
}

export function rotateCanvas(source: HTMLCanvasElement, angleDegrees: number) {
  if (Math.abs(angleDegrees) < 0.01) {
    const out = createCanvas(source.width, source.height);
    out.getContext("2d")!.drawImage(source, 0, 0);
    return out;
  }
  const rad = (angleDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const width = Math.ceil(source.width * cos + source.height * sin);
  const height = Math.ceil(source.width * sin + source.height * cos);
  const out = createCanvas(width, height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

export function deskewDocument(source: HTMLCanvasElement): DeskewResult {
  const skew = estimateSkewAngle(source);
  const shouldApply = skew.confidence >= 0.22 && Math.abs(skew.angle) >= 0.45;
  return {
    canvas: shouldApply ? rotateCanvas(source, -skew.angle) : source,
    angle: skew.angle,
    applied: shouldApply,
    confidence: skew.confidence,
  };
}

export function rankDocumentVariants(quality: ImageQuality): DocumentVariantName[] {
  const order: DocumentVariantName[] = [];
  const push = (v: DocumentVariantName) => { if (!order.includes(v)) order.push(v); };

  if (quality.contrast < 32 || quality.brightness < 105) {
    push("contrast");
    push("binaryLight");
    push("original");
  } else if (quality.brightness > 210 || quality.clippedLightRatio > 0.22) {
    push("binaryDark");
    push("contrast");
    push("original");
  } else {
    push("original");
    push("contrast");
  }
  push("grayscale");
  push("binaryDark");
  push("binaryLight");
  return order;
}

export function buildRecognitionPlan(document: Pick<PreparedDocument, "quality" | "paperBounds">): RecognitionPlan {
  const warnings = [...document.quality.warnings];
  const lowFocus = document.quality.edgeScore < 20;
  const poorContrast = document.quality.contrast < 30;
  const difficultLight = document.quality.brightness < 85 || document.quality.brightness > 220;
  if (!document.paperBounds) warnings.push("用紙範囲の確信度が低いため全体画像も保持します");

  return {
    variantOrder: rankDocumentVariants(document.quality),
    cellFirst: true,
    useDeskew: lowFocus || poorContrast || difficultLight,
    useTextBands: true,
    allowHeavyFallback: lowFocus || poorContrast || difficultLight,
    maxGlobalPasses: lowFocus ? 2 : 1,
    warnings,
  };
}

export function recognitionDiagnosticSummary(plan: RecognitionPlan, budget?: RecognitionBudget) {
  const parts = [
    `variant=${plan.variantOrder.join(">")}`,
    `cellFirst=${plan.cellFirst ? "yes" : "no"}`,
    `deskew=${plan.useDeskew ? "auto" : "skip"}`,
    `bands=${plan.useTextBands ? "on" : "off"}`,
    `heavy=${plan.allowHeavyFallback ? "allowed" : "off"}`,
  ];
  if (budget) parts.push(`passes=${budget.passes}/${budget.maxPasses}`);
  return parts.join(" / ");
}
