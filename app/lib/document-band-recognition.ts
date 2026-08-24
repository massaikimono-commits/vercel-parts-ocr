import { detectTextBands, type TextBand } from "./document-recognition-engine";
import {
  OCR_FIELD_PRESETS,
  recognizeDocumentRegion,
  type DocumentRecognitionSession,
  type RegionRecognitionOptions,
  type RelativeRegion,
} from "./document-recognition-v2";

export type RecognizedTextBand = {
  band: TextBand;
  region: RelativeRegion;
  text: string;
  confidence: number;
  support: number;
  reason: string;
  contributors: string;
};

export type TextBandRecognitionOptions = {
  maxBands?: number;
  minBandConfidence?: number;
  profile?: RegionRecognitionOptions["profile"];
  variants?: RegionRecognitionOptions["variants"];
  psms?: RegionRecognitionOptions["psms"];
  minSimilarity?: number;
  minSupport?: number;
  minConfidence?: number;
  targetWidth?: number;
  validate?: RegionRecognitionOptions["validate"];
  stopAfterEmpty?: number;
};

function relativeBand(band: TextBand, pageWidth: number, pageHeight: number): RelativeRegion {
  const padX = Math.min(pageWidth * 0.012, 42);
  const padY = Math.min(pageHeight * 0.004, Math.max(4, band.height * 0.28));
  const x = Math.max(0, band.x - padX);
  const y = Math.max(0, band.y - padY);
  const x2 = Math.min(pageWidth, band.x + band.width + padX);
  const y2 = Math.min(pageHeight, band.y + band.height + padY);
  return {
    x: x / pageWidth,
    y: y / pageHeight,
    width: Math.max(0.01, (x2 - x) / pageWidth),
    height: Math.max(0.01, (y2 - y) / pageHeight),
  };
}

function defaultOptions(profile: RegionRecognitionOptions["profile"]): RegionRecognitionOptions {
  if (profile === "numeric") return { ...OCR_FIELD_PRESETS.number };
  if (profile === "money") return { ...OCR_FIELD_PRESETS.money };
  if (profile === "alnum") return { ...OCR_FIELD_PRESETS.code };
  if (profile === "date") return { ...OCR_FIELD_PRESETS.date };
  return { ...OCR_FIELD_PRESETS.japaneseText, profile: profile ?? "japanese" };
}

function contributorSummary(observations: any[] = []) {
  const groups = new Map<string, { count: number; confidence: number; sources: Set<string> }>();
  for (const observation of observations) {
    const variant = String(observation?.variant || "unknown");
    const psm = String(observation?.psm ?? "?");
    const key = `${variant} / PSM=${psm}`;
    const current = groups.get(key) || { count: 0, confidence: 0, sources: new Set<string>() };
    current.count += 1;
    current.confidence += Number(observation?.confidence ?? 0);
    if (observation?.source) current.sources.add(String(observation.source));
    groups.set(key, current);
  }
  return [...groups.entries()]
    .map(([key, value]) => ({
      key,
      count: value.count,
      average: value.count ? value.confidence / value.count : 0,
      sources: [...value.sources],
    }))
    .sort((a, b) => b.count - a.count || b.average - a.average)
    .map(item => `${item.key} / n=${item.count} / avgConf=${item.average.toFixed(1)}${item.sources.some(x => x.includes("sharp")) ? " / SHARP" : ""}`)
    .join("\n");
}

/**
 * Detects horizontal text bands from image structure, then OCRs each band with the
 * same shared V2 field engine. This is layout-agnostic: no certificate/supplier
 * coordinates or sample-specific values are required.
 */
export async function recognizeDocumentTextBands(
  session: DocumentRecognitionSession,
  worker: any,
  options: TextBandRecognitionOptions = {},
): Promise<RecognizedTextBand[]> {
  const page = session.prepared.normalized;
  const maxBands = Math.max(1, Math.min(80, options.maxBands ?? 28));
  const detected = detectTextBands(page, {
    maxBands: Math.min(100, maxBands * 2),
    minHeightRatio: 0.005,
    maxHeightRatio: 0.085,
  }).filter(band => band.confidence >= (options.minBandConfidence ?? 0.11));

  const results: RecognizedTextBand[] = [];
  let consecutiveEmpty = 0;
  for (const band of detected.slice(0, maxBands)) {
    const region = relativeBand(band, page.width, page.height);
    const base = defaultOptions(options.profile);
    const result = await recognizeDocumentRegion(session, worker, region, {
      ...base,
      variants: options.variants ?? ["original", "contrast", "adaptiveBinary"],
      psms: options.psms ?? ["7", "13"],
      targetWidth: options.targetWidth ?? 3200,
      minSimilarity: options.minSimilarity ?? Math.min(0.68, base.minSimilarity ?? 0.68),
      minSupport: options.minSupport ?? 2,
      minConfidence: options.minConfidence ?? 0.52,
      strongConfidence: 0.80,
      strongSupport: 2,
      recoveryMaxPasses: 5,
      sharpRecovery: true,
      sharpRecoveryPasses: 2,
      validate: options.validate,
    });

    if (!result.value) {
      consecutiveEmpty += 1;
      if ((options.stopAfterEmpty ?? 0) > 0 && consecutiveEmpty >= (options.stopAfterEmpty ?? 0)) break;
      continue;
    }
    consecutiveEmpty = 0;
    results.push({
      band,
      region,
      text: result.value,
      confidence: result.confidence,
      support: result.support,
      reason: result.reason,
      contributors: contributorSummary(result.observations || []),
    });
  }
  return results;
}

export function joinRecognizedTextBands(bands: RecognizedTextBand[]) {
  return bands
    .sort((a, b) => a.band.y - b.band.y)
    .map(item => item.text.trim())
    .filter(Boolean)
    .join("\n");
}
