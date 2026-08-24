import { detectTextBands, type TextBand } from "./document-recognition-engine";
import { recognizeDocumentLayoutLines, type LayoutTextLine } from "./document-layout-lines";
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
  source: "image-density" | "ocr-layout";
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
  layoutFallback?: boolean;
  layoutMinConfidence?: number;
  maxLayoutRereads?: number;
};

type BandCandidate = {
  band: TextBand;
  region: RelativeRegion;
  source: "image-density" | "ocr-layout";
  seedText?: string;
  seedConfidence?: number;
  seedContributor?: string;
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

function relativeLayoutLine(line: LayoutTextLine, pageWidth: number, pageHeight: number): RelativeRegion {
  const padX = Math.min(pageWidth * 0.010, Math.max(8, line.height * 0.9));
  const padY = Math.min(pageHeight * 0.004, Math.max(4, line.height * 0.34));
  const x = Math.max(0, line.left - padX);
  const y = Math.max(0, line.top - padY);
  const x2 = Math.min(pageWidth, line.left + line.width + padX);
  const y2 = Math.min(pageHeight, line.top + line.height + padY);
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

function overlapRatio(a: RelativeRegion, b: RelativeRegion) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = x * y;
  if (!intersection) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? intersection / smaller : 0;
}

function selectDistributed(candidates: BandCandidate[], maxBands: number) {
  const sorted = [...candidates].sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  if (sorted.length <= maxBands) return sorted;

  const selected: BandCandidate[] = [];
  const used = new Set<BandCandidate>();
  const leading = Math.min(3, maxBands);
  for (const item of sorted.slice(0, leading)) {
    selected.push(item);
    used.add(item);
  }

  const slots = maxBands - selected.length;
  for (let i = 0; i < slots; i += 1) {
    const targetY = (i + 1) / (slots + 1);
    const available = sorted.filter(item => !used.has(item));
    if (!available.length) break;
    available.sort((a, b) => {
      const ay = a.region.y + a.region.height / 2;
      const by = b.region.y + b.region.height / 2;
      return Math.abs(ay - targetY) - Math.abs(by - targetY);
    });
    selected.push(available[0]);
    used.add(available[0]);
  }

  return selected.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
}

function layoutRereadPriority(candidate: BandCandidate) {
  const text = String(candidate.seedText || "");
  const confidence = Number(candidate.seedConfidence ?? 0);
  let score = Math.max(0, 100 - confidence) * 1.6;
  if (/\d/.test(text)) score += 18;
  if (/[A-Za-z]/.test(text)) score += 12;
  if (/[ぁ-んァ-ヶ一-龠]/.test(text)) score += 8;
  if (/[-ー―]/.test(text)) score += 7;
  score += Math.min(10, [...text.replace(/\s/g, "")].length / 4);
  return score;
}

/**
 * Detects text rows without relying on one document template.
 *
 * 1) For ordinary documents, image-density bands are fast and cheap.
 * 2) On ruled forms, horizontal table rules can make density detection fail. When
 *    that happens, we fall back to Tesseract TSV geometry (actual word/line boxes).
 * 3) Only a small number of the most informative/uncertain TSV rows are re-read at
 *    high resolution across variants; the rest reuse the already-recognized line.
 */
export async function recognizeDocumentTextBands(
  session: DocumentRecognitionSession,
  worker: any,
  options: TextBandRecognitionOptions = {},
): Promise<RecognizedTextBand[]> {
  const page = session.prepared.normalized;
  const maxBands = Math.max(1, Math.min(80, options.maxBands ?? 28));
  const imageBands = detectTextBands(page, {
    maxBands: Math.min(100, maxBands * 2),
    minHeightRatio: 0.005,
    maxHeightRatio: 0.085,
  }).filter(band => band.confidence >= (options.minBandConfidence ?? 0.11));

  const candidates: BandCandidate[] = imageBands.map(band => ({
    band,
    region: relativeBand(band, page.width, page.height),
    source: "image-density" as const,
  }));

  const shouldUseLayout = options.layoutFallback !== false && imageBands.length < Math.min(4, maxBands);
  if (shouldUseLayout) {
    const layoutLines = await recognizeDocumentLayoutLines(session, worker, {
      variants: ["contrast", "original"],
      psm: "11",
      minConfidence: options.layoutMinConfidence ?? 18,
      minTextLength: 2,
      maxLines: Math.min(160, maxBands * 8),
    });

    for (const line of layoutLines) {
      const region = relativeLayoutLine(line, page.width, page.height);
      if (candidates.some(existing => overlapRatio(existing.region, region) >= 0.72)) continue;
      const confidence = Math.max(0, Math.min(100, line.confidence));
      candidates.push({
        band: {
          x: line.left,
          y: line.top,
          width: line.width,
          height: line.height,
          confidence: confidence / 100,
        },
        region,
        source: "ocr-layout",
        seedText: line.text,
        seedConfidence: confidence,
        seedContributor: `${line.variant} / PSM=${line.psm} / TSV line avgConf=${confidence.toFixed(1)}`,
      });
    }
  }

  const selected = selectDistributed(candidates, maxBands);
  const maxLayoutRereads = Math.max(0, Math.min(12, options.maxLayoutRereads ?? 6));
  const layoutToReread = new Set(
    selected
      .filter(item => item.source === "ocr-layout")
      .sort((a, b) => layoutRereadPriority(b) - layoutRereadPriority(a))
      .slice(0, maxLayoutRereads),
  );

  const results: RecognizedTextBand[] = [];
  let consecutiveEmpty = 0;
  for (const candidate of selected) {
    const seedValid = Boolean(candidate.seedText)
      && (!options.validate || options.validate(String(candidate.seedText)));
    const shouldReread = candidate.source === "image-density" || layoutToReread.has(candidate);

    if (!shouldReread && seedValid) {
      consecutiveEmpty = 0;
      results.push({
        band: candidate.band,
        region: candidate.region,
        text: String(candidate.seedText),
        confidence: Math.max(0, Math.min(1, Number(candidate.seedConfidence || 0) / 100)),
        support: 1,
        reason: "全文OCRのTSV行位置を採用 / 高解像度再読取は優先度外のため省略",
        contributors: candidate.seedContributor || "TSV layout",
        source: candidate.source,
      });
      continue;
    }

    const base = defaultOptions(options.profile);
    const result = await recognizeDocumentRegion(session, worker, candidate.region, {
      ...base,
      variants: options.variants ?? ["original", "contrast", "adaptiveBinary"],
      psms: candidate.source === "ocr-layout"
        ? [options.psms?.[0] ?? "7"]
        : (options.psms ?? ["7", "13"]),
      targetWidth: options.targetWidth ?? 3200,
      minSimilarity: options.minSimilarity ?? Math.min(0.68, base.minSimilarity ?? 0.68),
      minSupport: options.minSupport ?? 2,
      minConfidence: options.minConfidence ?? 0.52,
      strongConfidence: 0.80,
      strongSupport: 2,
      recoveryMaxPasses: candidate.source === "ocr-layout" ? 4 : 5,
      sharpRecovery: true,
      sharpRecoveryPasses: 2,
      validate: options.validate,
    });

    if (!result.value) {
      if (seedValid) {
        consecutiveEmpty = 0;
        results.push({
          band: candidate.band,
          region: candidate.region,
          text: String(candidate.seedText),
          confidence: Math.max(0, Math.min(1, Number(candidate.seedConfidence || 0) / 100)),
          support: 1,
          reason: "高解像度再読取は保留 / 全文OCRのTSV行を診断用に保持",
          contributors: [candidate.seedContributor, contributorSummary(result.observations || [])].filter(Boolean).join("\n"),
          source: candidate.source,
        });
        continue;
      }
      consecutiveEmpty += 1;
      if ((options.stopAfterEmpty ?? 0) > 0 && consecutiveEmpty >= (options.stopAfterEmpty ?? 0)) break;
      continue;
    }

    consecutiveEmpty = 0;
    results.push({
      band: candidate.band,
      region: candidate.region,
      text: result.value,
      confidence: result.confidence,
      support: result.support,
      reason: result.reason,
      contributors: contributorSummary(result.observations || []),
      source: candidate.source,
    });
  }
  return results;
}

export function joinRecognizedTextBands(bands: RecognizedTextBand[]) {
  return bands
    .sort((a, b) => a.band.y - b.band.y || a.band.x - b.band.x)
    .map(item => item.text.trim())
    .filter(Boolean)
    .join("\n");
}
