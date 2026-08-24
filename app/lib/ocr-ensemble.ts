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

function sameLengthCharacterConsensus(cluster: Array<OcrObservation & { normalized: string }>, pivot: string) {
  const close = cluster.filter(x => x.normalized.length === pivot.length && ocrTextSimilarity(x.normalized, pivot) >= 0.72);
  if (close.length < 2) return pivot;
  const chars: string[] = [];
  for (let i = 0; i < pivot.length; i++) {
    const votes = new Map<string, number>();
    for (const observation of close) {
      const ch = observation.normalized[i];
      if (!ch) continue;
      votes.set(ch, (votes.get(ch) || 0) + weight(observation));
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    chars.push(ranked[0]?.[0] || pivot[i]);
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
  let value = sameLengthCharacterConsensus(bestCluster, pivot.normalized);
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
      ? `採用: 近似一致${support}件 / variant=${variantSupport} / confidence=${confidence.toFixed(2)}`
      : `保留: 近似一致${support}件 / variant=${variantSupport} / confidence=${confidence.toFixed(2)}${valid ? "" : " / validation NG"}`,
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
