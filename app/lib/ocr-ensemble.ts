export type OcrProfile = "text" | "japanese" | "numeric" | "money" | "alnum" | "date";

export type OcrObservation = {
  text: string;
  confidence?: number;
  variant?: string;
  psm?: string | number;
  source?: string;
};

export type OcrConsensusOptions = {
  profile?: OcrProfile;
  minSimilarity?: number;
  minSupport?: number;
  minConfidence?: number;
  validate?: (value: string) => boolean;
};

export type OcrConsensusResult = {
  value: string;
  confidence: number;
  support: number;
  observations: OcrObservation[];
  normalized: string[];
  reason: string;
};

const DASHES = /[‐‑‒–—―ー−]/g;
const GAP = "\u0000";

function baseNormalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function numericConfusables(value = "") {
  return value
    .replace(/[OoＯｏQqＤＤDd](?=\d)|(?<=\d)[OoＯｏQqＤＤDd]/g, "0")
    .replace(/[Il|!ｌＩ](?=\d)|(?<=\d)[Il|!ｌＩ]/g, "1")
    .replace(/[Zz](?=\d)|(?<=\d)[Zz]/g, "2")
    .replace(/[Ss§](?=\d)|(?<=\d)[Ss§]/g, "5")
    .replace(/[Bb](?=\d)|(?<=\d)[Bb]/g, "8");
}

export function normalizeForOcrProfile(value = "", profile: OcrProfile = "text") {
  let text = baseNormalize(value);
  if (!text) return "";

  if (profile === "numeric" || profile === "money") {
    text = numericConfusables(text)
      .replace(/[^0-9.,+\-]/g, "")
      .replace(/,/g, "");
    if (profile === "money") text = text.replace(/\.(?=.*\.)/g, "");
    return text;
  }

  if (profile === "alnum") {
    return numericConfusables(text.toUpperCase())
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9-]/g, "");
  }

  if (profile === "date") {
    return numericConfusables(text)
      .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
      .replace(/平[或戊陰咸戌]/g, "平成")
      .replace(/昭[禾口知]/g, "昭和")
      .replace(/\s+/g, "");
  }

  if (profile === "japanese") {
    return text.replace(/[|｜]/g, "").replace(/\s*\n\s*/g, "\n").trim();
  }

  return text;
}

export function levenshteinDistance(a = "", b = "") {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Uint16Array(b.length + 1);
  const next = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    next[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev.set(next);
  }
  return prev[b.length];
}

export function ocrTextSimilarity(a = "", b = "") {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return Math.max(0, 1 - levenshteinDistance(a, b) / longest);
}

function weight(observation: OcrObservation) {
  const confidence = Math.max(0.05, Math.min(1, (observation.confidence ?? 55) / 100));
  return 0.45 + confidence * 0.85;
}

function clusterObservations(
  observations: Array<OcrObservation & { normalized: string }>,
  minSimilarity: number,
) {
  const clusters: Array<Array<OcrObservation & { normalized: string }>> = [];
  for (const observation of observations) {
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const similarity = Math.max(...cluster.map(x => ocrTextSimilarity(x.normalized, observation.normalized)));
      if (similarity >= minSimilarity && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) clusters[bestIndex].push(observation);
    else clusters.push([observation]);
  }
  return clusters;
}

function medoid(cluster: Array<OcrObservation & { normalized: string }>) {
  let best = cluster[0];
  let bestScore = -Infinity;
  for (const candidate of cluster) {
    let score = weight(candidate) * 0.35;
    for (const other of cluster) {
      score += ocrTextSimilarity(candidate.normalized, other.normalized) * weight(other);
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Global alignment against a scaffold. This lets OCR observations vote even when
 * one pass dropped or inserted a character. We intentionally keep the scaffold
 * as the longest close reading, because OCR more often drops thin characters than
 * invents a stable extra character across several preprocessing variants.
 */
function alignToScaffold(scaffold: string, value: string) {
  const rows = scaffold.length + 1;
  const cols = value.length + 1;
  const score = Array.from({ length: rows }, () => new Int16Array(cols));
  const trace = Array.from({ length: rows }, () => new Uint8Array(cols));
  const gapPenalty = -2;
  const mismatchPenalty = -1;
  const matchScore = 3;

  for (let i = 1; i < rows; i++) {
    score[i][0] = score[i - 1][0] + gapPenalty;
    trace[i][0] = 1;
  }
  for (let j = 1; j < cols; j++) {
    score[0][j] = score[0][j - 1] + gapPenalty;
    trace[0][j] = 2;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const diag = score[i - 1][j - 1] + (scaffold[i - 1] === value[j - 1] ? matchScore : mismatchPenalty);
      const up = score[i - 1][j] + gapPenalty;
      const left = score[i][j - 1] + gapPenalty;
      if (diag >= up && diag >= left) {
        score[i][j] = diag;
        trace[i][j] = 0;
      } else if (up >= left) {
        score[i][j] = up;
        trace[i][j] = 1;
      } else {
        score[i][j] = left;
        trace[i][j] = 2;
      }
    }
  }

  const aligned = Array.from({ length: scaffold.length }, () => GAP);
  let i = scaffold.length;
  let j = value.length;
  while (i > 0 || j > 0) {
    const step = trace[i][j];
    if (i > 0 && j > 0 && step === 0) {
      aligned[i - 1] = value[j - 1];
      i--;
      j--;
    } else if (i > 0 && (j === 0 || step === 1)) {
      aligned[i - 1] = GAP;
      i--;
    } else if (j > 0) {
      // Insertion relative to the scaffold. Ignore here; if it is genuine it should
      // appear in the longest close reading selected as scaffold.
      j--;
    } else {
      break;
    }
  }
  return aligned;
}

function alignedCharacterConsensus(cluster: Array<OcrObservation & { normalized: string }>, medoidValue: string) {
  const close = cluster.filter(x => ocrTextSimilarity(x.normalized, medoidValue) >= 0.66);
  if (close.length < 2) return medoidValue;

  const longest = Math.max(...close.map(x => x.normalized.length));
  const scaffoldCandidates = close.filter(x => x.normalized.length === longest);
  const scaffoldObservation = scaffoldCandidates.sort((a, b) => weight(b) - weight(a))[0] || close[0];
  const scaffold = scaffoldObservation.normalized;
  const aligned = close.map(observation => ({ observation, chars: alignToScaffold(scaffold, observation.normalized) }));
  const chars: string[] = [];

  for (let i = 0; i < scaffold.length; i++) {
    const votes = new Map<string, number>();
    for (const item of aligned) {
      const ch = item.chars[i] || GAP;
      votes.set(ch, (votes.get(ch) || 0) + weight(item.observation));
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [winner, winnerWeight] = ranked[0] || [scaffold[i], 0];
    const nonGap = ranked.find(([ch]) => ch !== GAP);

    if (winner === GAP) {
      // Drop a scaffold character only when gaps clearly dominate and at least two
      // readings independently omitted it. Otherwise keep the best non-gap vote.
      const gapCount = aligned.filter(x => x.chars[i] === GAP).length;
      if (gapCount >= 2 && winnerWeight > (nonGap?.[1] || 0) * 1.18) continue;
      chars.push(nonGap?.[0] || scaffold[i]);
    } else {
      chars.push(winner);
    }
  }
  return chars.join("");
}

export function buildOcrConsensus(
  input: OcrObservation[],
  options: OcrConsensusOptions = {},
): OcrConsensusResult {
  const profile = options.profile ?? "text";
  const minSimilarity = options.minSimilarity ?? (profile === "japanese" || profile === "text" ? 0.78 : 0.72);
  const minSupport = options.minSupport ?? 2;
  const minConfidence = options.minConfidence ?? 0.62;

  const observations = input
    .map(observation => ({
      ...observation,
      normalized: normalizeForOcrProfile(observation.text, profile),
    }))
    .filter(observation => observation.normalized);

  if (!observations.length) {
    return { value: "", confidence: 0, support: 0, observations: [], normalized: [], reason: "OCR候補なし" };
  }

  const clusters = clusterObservations(observations, minSimilarity);
  let bestCluster = clusters[0];
  let bestScore = -Infinity;
  for (const cluster of clusters) {
    const variants = new Set(cluster.map(x => x.variant).filter(Boolean)).size;
    const psms = new Set(cluster.map(x => String(x.psm ?? "")).filter(Boolean)).size;
    const avgWeight = cluster.reduce((sum, x) => sum + weight(x), 0) / cluster.length;
    let cohesion = 0;
    let pairs = 0;
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        cohesion += ocrTextSimilarity(cluster[i].normalized, cluster[j].normalized);
        pairs++;
      }
    }
    const avgCohesion = pairs ? cohesion / pairs : 0.45;
    const score = cluster.length * 1.8 + variants * 0.75 + psms * 0.35 + avgWeight + avgCohesion * 2.2;
    if (score > bestScore) {
      bestScore = score;
      bestCluster = cluster;
    }
  }

  const pivot = medoid(bestCluster);
  let value = alignedCharacterConsensus(bestCluster, pivot.normalized);
  value = normalizeForOcrProfile(value, profile);

  const support = bestCluster.filter(x => ocrTextSimilarity(x.normalized, value) >= minSimilarity).length;
  const variantSupport = new Set(bestCluster.map(x => x.variant).filter(Boolean)).size;
  const avgConfidence = bestCluster.reduce((sum, x) => sum + Math.max(0, Math.min(100, x.confidence ?? 55)), 0) / bestCluster.length / 100;
  const cohesion = bestCluster.reduce((sum, x) => sum + ocrTextSimilarity(x.normalized, value), 0) / bestCluster.length;
  const confidence = Math.max(0, Math.min(1,
    0.20 + Math.min(0.28, support * 0.09) + Math.min(0.14, variantSupport * 0.045) + avgConfidence * 0.20 + cohesion * 0.20,
  ));

  const valid = !options.validate || options.validate(value);
  const accepted = valid && support >= minSupport && confidence >= minConfidence;
  return {
    value: accepted ? value : "",
    confidence,
    support,
    observations: bestCluster.map(({ normalized: _normalized, ...rest }) => rest),
    normalized: bestCluster.map(x => x.normalized),
    reason: accepted
      ? `採用: アラインメント近似一致${support}件 / variant=${variantSupport} / confidence=${confidence.toFixed(2)}`
      : `保留: アラインメント近似一致${support}件 / variant=${variantSupport} / confidence=${confidence.toFixed(2)}${valid ? "" : " / validation NG"}`,
  };
}

export type RecognizeEnsembleOptions = {
  profile?: OcrProfile;
  variants?: Array<{ name: string; canvas: HTMLCanvasElement }>;
  psms?: Array<string | number>;
  whitelist?: string;
  minSimilarity?: number;
  minSupport?: number;
  minConfidence?: number;
  validate?: (value: string) => boolean;
};

/**
 * Shared Tesseract ensemble runner.
 * The caller owns the worker so certificate/parts flows can reuse one worker and avoid
 * starting several WASM workers on iPhone Safari.
 */
export async function recognizeCanvasEnsemble(
  worker: any,
  options: RecognizeEnsembleOptions,
): Promise<OcrConsensusResult> {
  const observations: OcrObservation[] = [];
  const variants = options.variants || [];
  const psms = options.psms?.length ? options.psms : ["7"];

  for (const variant of variants) {
    for (const psm of psms) {
      await worker.setParameters({
        tessedit_pageseg_mode: String(psm),
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_char_whitelist: options.whitelist || "",
      });
      const result = await worker.recognize(variant.canvas);
      const text = String(result?.data?.text || "").trim();
      if (!text) continue;
      observations.push({
        text,
        confidence: Number(result?.data?.confidence ?? 55),
        variant: variant.name,
        psm,
        source: "tesseract",
      });
    }
  }

  return buildOcrConsensus(observations, {
    profile: options.profile,
    minSimilarity: options.minSimilarity,
    minSupport: options.minSupport,
    minConfidence: options.minConfidence,
    validate: options.validate,
  });
}
