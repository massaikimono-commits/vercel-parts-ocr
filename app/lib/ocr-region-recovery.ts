import {
  recognizeDocumentRegion,
  type DocumentRecognitionSession,
  type RegionRecognitionOptions,
  type RelativeRegion,
} from "./document-recognition-v2";
import {
  buildOcrConsensus,
  type OcrConsensusResult,
  type OcrObservation,
  type OcrProfile,
} from "./ocr-ensemble";
import type { DocumentVariantName } from "./document-image-pipeline";

export type RegionRecoveryOptions = RegionRecognitionOptions & {
  strongConfidence?: number;
  strongSupport?: number;
  recoveryTargetWidth?: number;
  recoveryVariants?: DocumentVariantName[];
  recoveryPsms?: Array<string | number>;
  maxRecoveryPasses?: number;
};

type TokenQuality = {
  average: number;
  weakRatio: number;
  count: number;
};

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function expandedRegion(region: RelativeRegion): RelativeRegion {
  const padX = Math.min(0.008, region.width * 0.08);
  const padY = Math.min(0.006, region.height * 0.14);
  const x = Math.max(0, region.x - padX);
  const y = Math.max(0, region.y - padY);
  const x2 = Math.min(1, region.x + region.width + padX);
  const y2 = Math.min(1, region.y + region.height + padY);
  return { x, y, width: Math.max(0.01, x2 - x), height: Math.max(0.01, y2 - y) };
}

function cropRelative(source: HTMLCanvasElement, region: RelativeRegion, targetWidth: number) {
  const sx = Math.max(0, Math.round(source.width * region.x));
  const sy = Math.max(0, Math.round(source.height * region.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * region.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * region.height)));
  const scale = Math.max(1, Math.min(12, targetWidth / Math.max(1, sw)));
  const pad = 36;
  const out = createCanvas(sw * scale + pad * 2, sh * scale + pad * 2);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, out.width - pad * 2, out.height - pad * 2);
  return out;
}

function tokenQualityFromTsv(tsv = ""): TokenQuality {
  let weighted = 0;
  let chars = 0;
  let weakChars = 0;
  let count = 0;
  for (const row of String(tsv || "").split(/\n/).slice(1)) {
    const cols = row.split("\t");
    if (cols.length < 12) continue;
    const confidence = Number(cols[10]);
    const text = cols.slice(11).join("\t").trim();
    if (!text || !Number.isFinite(confidence) || confidence < 0) continue;
    const length = Math.max(1, [...text.replace(/\s/g, "")].length);
    weighted += confidence * length;
    chars += length;
    if (confidence < 45) weakChars += length;
    count += 1;
  }
  if (!chars) return { average: 55, weakRatio: 0.5, count: 0 };
  return {
    average: weighted / chars,
    weakRatio: weakChars / chars,
    count,
  };
}

function effectiveConfidence(globalConfidence: number, quality: TokenQuality) {
  const global = Number.isFinite(globalConfidence) ? globalConfidence : 55;
  const blended = global * 0.52 + quality.average * 0.48 - quality.weakRatio * 18;
  return Math.max(5, Math.min(99, blended));
}

function recoveryPsms(profile: OcrProfile | undefined) {
  if (profile === "numeric" || profile === "money" || profile === "alnum" || profile === "date") {
    return ["13", "7", "8"];
  }
  return ["13", "7", "6"];
}

function resultIsStrong(result: OcrConsensusResult, options: RegionRecoveryOptions) {
  const confidence = options.strongConfidence ?? 0.78;
  const support = options.strongSupport ?? 3;
  return Boolean(result.value) && result.confidence >= confidence && result.support >= support;
}

/**
 * Generic confidence-driven OCR recovery for a small field/region.
 *
 * Pass 1 uses the normal shared ensemble. Only when the result is weak/empty do we
 * re-read the same field at higher resolution with alternate segmentation modes.
 * No vehicle, supplier, address, or sample-specific knowledge is used here.
 */
export async function recognizeDocumentRegionWithRecovery(
  session: DocumentRecognitionSession,
  worker: any,
  region: RelativeRegion,
  options: RegionRecoveryOptions = {},
): Promise<OcrConsensusResult> {
  const first = await recognizeDocumentRegion(session, worker, region, options);
  if (resultIsStrong(first, options)) {
    return { ...first, reason: `${first.reason} / 高信頼のため再読取省略` };
  }

  const profile = options.profile ?? "text";
  const variants = options.recoveryVariants?.length
    ? options.recoveryVariants
    : (["original", "contrast", "adaptiveBinary", "grayscale"] as DocumentVariantName[]);
  const psms = options.recoveryPsms?.length ? options.recoveryPsms : recoveryPsms(profile);
  const targetWidth = Math.min(3600, Math.max(options.recoveryTargetWidth ?? 0, (options.targetWidth ?? 2200) * 1.45, 2800));
  const maxPasses = Math.max(2, Math.min(10, options.maxRecoveryPasses ?? 7));
  const recoveryRegion = expandedRegion(region);
  const observations: OcrObservation[] = [...(first.observations || [])];
  const crops: HTMLCanvasElement[] = [];
  let passes = 0;

  try {
    for (const variantName of variants) {
      const source = session.prepared.variants[variantName];
      if (!source) continue;
      const crop = cropRelative(source, recoveryRegion, targetWidth);
      crops.push(crop);

      for (const psm of psms) {
        if (passes >= maxPasses) break;
        passes += 1;
        await worker.setParameters({
          tessedit_pageseg_mode: String(psm),
          preserve_interword_spaces: "1",
          user_defined_dpi: "360",
          tessedit_char_whitelist: options.whitelist || "",
        });
        const result = await worker.recognize(crop, {}, { text: true, tsv: true });
        const text = String(result?.data?.text || "").trim();
        if (!text) continue;
        const quality = tokenQualityFromTsv(String(result?.data?.tsv || ""));
        observations.push({
          text,
          confidence: effectiveConfidence(Number(result?.data?.confidence ?? 55), quality),
          variant: `${variantName}:hires`,
          psm,
          source: `tesseract-recovery tokenAvg=${quality.average.toFixed(1)} weak=${quality.weakRatio.toFixed(2)}`,
        });
      }
      if (passes >= maxPasses) break;
    }
  } finally {
    for (const crop of crops) {
      crop.width = 1;
      crop.height = 1;
    }
  }

  const recovered = buildOcrConsensus(observations, {
    profile,
    minSimilarity: Math.max(0.48, (options.minSimilarity ?? 0.72) - 0.06),
    minSupport: options.minSupport,
    minConfidence: options.minConfidence,
    validate: options.validate,
  });

  const better = recovered.value && (
    !first.value ||
    recovered.confidence > first.confidence + 0.025 ||
    recovered.support > first.support
  );
  if (better) {
    return {
      ...recovered,
      reason: `${recovered.reason} / 弱いセルを高解像度再読取(${passes}pass)`,
    };
  }
  return {
    ...first,
    reason: `${first.reason} / 高解像度再読取${passes}passでも改善なし`,
  };
}
