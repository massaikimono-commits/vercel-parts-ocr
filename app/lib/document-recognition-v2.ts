import {
  prepareDocumentImage,
  createOcrVariants,
  type DocumentVariantName,
  type PreparedDocument,
} from "./document-image-pipeline";
import { deskewDocument } from "./document-recognition-engine";
import { correctDocumentPerspective } from "./document-perspective";
import {
  buildOcrConsensus,
  recognizeCanvasEnsemble,
  type OcrConsensusResult,
  type OcrObservation,
  type OcrProfile,
} from "./ocr-ensemble";

export type RelativeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RegionRecognitionOptions = {
  profile?: OcrProfile;
  variants?: DocumentVariantName[];
  psms?: Array<string | number>;
  whitelist?: string;
  targetWidth?: number;
  minSimilarity?: number;
  minSupport?: number;
  minConfidence?: number;
  validate?: (value: string) => boolean;
  recovery?: boolean;
  strongConfidence?: number;
  strongSupport?: number;
  recoveryTargetWidth?: number;
  recoveryMaxPasses?: number;
  recoveryVariants?: DocumentVariantName[];
  recoveryPsms?: Array<string | number>;
  sharpRecovery?: boolean;
  sharpRecoveryPasses?: number;
};

export type DocumentRecognitionSession = {
  prepared: PreparedDocument;
  qualityWarnings: string[];
  geometry: {
    perspectiveApplied: boolean;
    perspectiveConfidence: number;
    perspectiveSeverity: number;
    deskewApplied: boolean;
    deskewAngle: number;
    deskewConfidence: number;
  };
};

type WorkerFactoryOptions = {
  language?: string;
  logger?: (message: any) => void;
};

type TokenQuality = {
  average: number;
  weakRatio: number;
  count: number;
};

const globalState = globalThis as typeof globalThis & {
  __icbOcrQueue?: Promise<void>;
};

function canvas(width: number, height: number) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width));
  out.height = Math.max(1, Math.round(height));
  return out;
}

function cropRelative(source: HTMLCanvasElement, region: RelativeRegion, targetWidth = 2200, pad = 28) {
  const sx = Math.max(0, Math.round(source.width * region.x));
  const sy = Math.max(0, Math.round(source.height * region.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * region.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * region.height)));
  const scale = Math.max(1, Math.min(12, targetWidth / Math.max(1, sw)));
  const out = canvas(sw * scale + pad * 2, sh * scale + pad * 2);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, out.width - pad * 2, out.height - pad * 2);
  return out;
}

/** Mild unsharp mask used only for weak, already-cropped regions. */
function sharpenRecoveryCanvas(source: HTMLCanvasElement, amount = 0.62) {
  const out = canvas(source.width, source.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const data = image.data;
  const width = out.width;
  const height = out.height;
  const gray = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const center = gray[p];
      const average = (gray[p - 1] + gray[p + 1] + gray[p - width] + gray[p + width]) / 4;
      const value = clamp(center + amount * (center - average));
      const i = p * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function expandedRegion(region: RelativeRegion) {
  const padX = Math.min(0.008, region.width * 0.08);
  const padY = Math.min(0.006, region.height * 0.14);
  const x = Math.max(0, region.x - padX);
  const y = Math.max(0, region.y - padY);
  const x2 = Math.min(1, region.x + region.width + padX);
  const y2 = Math.min(1, region.y + region.height + padY);
  return { x, y, width: Math.max(0.01, x2 - x), height: Math.max(0.01, y2 - y) };
}

function cleanupCanvases(canvases: HTMLCanvasElement[]) {
  for (const item of canvases) {
    item.width = 1;
    item.height = 1;
  }
}

function releaseVariants(variants: PreparedDocument["variants"]) {
  for (const item of Object.values(variants)) {
    item.width = 1;
    item.height = 1;
  }
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
  if (!chars) return { average: 55, weakRatio: 0.50, count: 0 };
  return { average: weighted / chars, weakRatio: weakChars / chars, count };
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

function strongEnough(result: OcrConsensusResult, options: RegionRecognitionOptions) {
  return Boolean(result.value)
    && result.confidence >= (options.strongConfidence ?? 0.78)
    && result.support >= (options.strongSupport ?? 3);
}

async function serial<T>(job: () => Promise<T>): Promise<T> {
  const previous = globalState.__icbOcrQueue || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  globalState.__icbOcrQueue = previous.catch(() => {}).then(() => next);
  await previous.catch(() => {});
  try {
    return await job();
  } finally {
    release();
  }
}

export async function createDocumentRecognitionSession(
  file: File,
  options: { maxSide?: number; cropPaper?: boolean; minPaperConfidence?: number } = {},
): Promise<DocumentRecognitionSession> {
  const initial = await prepareDocumentImage(file, {
    maxSide: options.maxSide ?? 3600,
    cropPaper: options.cropPaper ?? true,
    minPaperConfidence: options.minPaperConfidence ?? 0.48,
  });

  // Perspective and rotation are different problems. Correct conservative horizontal
  // keystone first, then estimate small rotational skew on the corrected document.
  const perspective = correctDocumentPerspective(initial.normalized);
  const perspectiveNormalized = perspective.applied ? perspective.canvas : initial.normalized;
  const deskewed = deskewDocument(perspectiveNormalized);
  const finalNormalized = deskewed.applied ? deskewed.canvas : perspectiveNormalized;

  let prepared = initial;
  const warnings = [...initial.quality.warnings];
  if (perspective.applied) {
    warnings.push(`台形補正: severity=${perspective.severity.toFixed(3)} (confidence=${perspective.confidence.toFixed(2)})`);
  }
  if (deskewed.applied) {
    warnings.push(`傾き補正: ${deskewed.angle.toFixed(2)}° (confidence=${deskewed.confidence.toFixed(2)})`);
  }

  if (finalNormalized !== initial.normalized) {
    const variants = createOcrVariants(finalNormalized);
    releaseVariants(initial.variants);
    if (initial.normalized !== initial.source) {
      initial.normalized.width = 1;
      initial.normalized.height = 1;
    }
    if (perspective.applied && perspective.canvas !== finalNormalized && perspective.canvas !== initial.source) {
      perspective.canvas.width = 1;
      perspective.canvas.height = 1;
    }
    prepared = {
      ...initial,
      normalized: finalNormalized,
      variants,
    };
  }

  return {
    prepared,
    qualityWarnings: warnings,
    geometry: {
      perspectiveApplied: perspective.applied,
      perspectiveConfidence: perspective.confidence,
      perspectiveSeverity: perspective.severity,
      deskewApplied: deskewed.applied,
      deskewAngle: deskewed.angle,
      deskewConfidence: deskewed.confidence,
    },
  };
}

export async function createSharedTesseractWorker(options: WorkerFactoryOptions = {}) {
  const tesseract: any = await import("tesseract.js");
  const worker = await tesseract.createWorker(options.language || "jpn+eng", 1, {
    logger: options.logger,
  });
  return { worker, tesseract };
}

/**
 * Shared field OCR for certificates and parts slips.
 * Weak/empty fields are re-read at higher resolution. If those reads still disagree,
 * one small cropped region gets a mild sharpening pass as the final generic recovery.
 */
export async function recognizeDocumentRegion(
  session: DocumentRecognitionSession,
  worker: any,
  region: RelativeRegion,
  options: RegionRecognitionOptions = {},
): Promise<OcrConsensusResult> {
  return serial(async () => {
    const profile = options.profile ?? "text";
    const variantOrder = options.variants?.length
      ? options.variants
      : (["original", "contrast", "adaptiveBinary", "binaryDark"] as DocumentVariantName[]);
    const crops: Array<{ name: string; canvas: HTMLCanvasElement }> = [];
    try {
      for (const name of variantOrder) {
        const source = session.prepared.variants[name];
        if (!source) continue;
        crops.push({
          name,
          canvas: cropRelative(source, region, options.targetWidth ?? 2200),
        });
      }

      const first = await recognizeCanvasEnsemble(worker, {
        profile,
        variants: crops,
        psms: options.psms ?? ["7", "6"],
        whitelist: options.whitelist,
        minSimilarity: options.minSimilarity,
        minSupport: options.minSupport,
        minConfidence: options.minConfidence,
        validate: options.validate,
      });

      if (options.recovery === false || strongEnough(first, options)) {
        return {
          ...first,
          reason: options.recovery === false
            ? `${first.reason} / 再読取OFF`
            : `${first.reason} / 高信頼のため再読取省略`,
        };
      }

      const recoveryVariants = options.recoveryVariants?.length
        ? options.recoveryVariants
        : (["original", "contrast", "adaptiveBinary", "grayscale"] as DocumentVariantName[]);
      const psms = options.recoveryPsms?.length ? options.recoveryPsms : recoveryPsms(profile);
      const targetWidth = Math.min(
        3600,
        Math.max(options.recoveryTargetWidth ?? 0, (options.targetWidth ?? 2200) * 1.45, 2800),
      );
      const maxPasses = Math.max(2, Math.min(10, options.recoveryMaxPasses ?? 7));
      const recoveryRegion = expandedRegion(region);
      const observations: OcrObservation[] = [...(first.observations || [])];
      const recoveryCrops: HTMLCanvasElement[] = [];
      let passes = 0;

      try {
        for (const variantName of recoveryVariants) {
          const source = session.prepared.variants[variantName];
          if (!source) continue;
          const crop = cropRelative(source, recoveryRegion, targetWidth, 36);
          recoveryCrops.push(crop);

          for (const psm of psms) {
            if (passes >= maxPasses) break;
            passes += 1;
            await worker.setParameters({
              tessedit_pageseg_mode: String(psm),
              preserve_interword_spaces: "1",
              user_defined_dpi: "360",
              tessedit_char_whitelist: options.whitelist || "",
            });
            const raw = await worker.recognize(crop, {}, { text: true, tsv: true });
            const text = String(raw?.data?.text || "").trim();
            if (!text) continue;
            const quality = tokenQualityFromTsv(String(raw?.data?.tsv || ""));
            observations.push({
              text,
              confidence: effectiveConfidence(Number(raw?.data?.confidence ?? 55), quality),
              variant: `${variantName}:hires`,
              psm,
              source: `tesseract-recovery tokenAvg=${quality.average.toFixed(1)} weak=${quality.weakRatio.toFixed(2)}`,
            });
          }
          if (passes >= maxPasses) break;
        }

        let recovered = buildOcrConsensus(observations, {
          profile,
          minSimilarity: Math.max(0.48, (options.minSimilarity ?? 0.72) - 0.06),
          minSupport: options.minSupport,
          minConfidence: options.minConfidence,
          validate: options.validate,
        });

        let sharpPasses = 0;
        if (options.sharpRecovery !== false && !strongEnough(recovered, options)) {
          const sharpSource = session.prepared.variants.contrast || session.prepared.variants.original;
          const baseCrop = cropRelative(sharpSource, recoveryRegion, targetWidth, 36);
          const sharpCrop = sharpenRecoveryCanvas(baseCrop);
          recoveryCrops.push(baseCrop, sharpCrop);
          const requested = Math.max(1, Math.min(2, options.sharpRecoveryPasses ?? 2));
          const sharpPsms = psms.slice(0, requested);

          for (const psm of sharpPsms) {
            sharpPasses += 1;
            await worker.setParameters({
              tessedit_pageseg_mode: String(psm),
              preserve_interword_spaces: "1",
              user_defined_dpi: "360",
              tessedit_char_whitelist: options.whitelist || "",
            });
            const raw = await worker.recognize(sharpCrop, {}, { text: true, tsv: true });
            const text = String(raw?.data?.text || "").trim();
            if (!text) continue;
            const quality = tokenQualityFromTsv(String(raw?.data?.tsv || ""));
            observations.push({
              text,
              confidence: effectiveConfidence(Number(raw?.data?.confidence ?? 55), quality),
              variant: "contrast:hires:sharp",
              psm,
              source: `tesseract-recovery-sharp tokenAvg=${quality.average.toFixed(1)} weak=${quality.weakRatio.toFixed(2)}`,
            });
          }

          recovered = buildOcrConsensus(observations, {
            profile,
            minSimilarity: Math.max(0.48, (options.minSimilarity ?? 0.72) - 0.06),
            minSupport: options.minSupport,
            minConfidence: options.minConfidence,
            validate: options.validate,
          });
        }

        const better = Boolean(recovered.value) && (
          !first.value
          || recovered.confidence > first.confidence + 0.025
          || recovered.support > first.support
        );
        const recoveryLabel = sharpPasses
          ? `高解像度${passes}pass＋シャープ${sharpPasses}pass`
          : `高解像度${passes}pass`;

        return better
          ? { ...recovered, reason: `${recovered.reason} / 弱いセルを${recoveryLabel}で再読取` }
          : { ...first, reason: `${first.reason} / ${recoveryLabel}でも改善なし` };
      } finally {
        cleanupCanvases(recoveryCrops);
      }
    } finally {
      cleanupCanvases(crops.map(x => x.canvas));
    }
  });
}

export async function recognizeWholeDocument(
  session: DocumentRecognitionSession,
  worker: any,
  options: Omit<RegionRecognitionOptions, "targetWidth"> = {},
): Promise<OcrConsensusResult> {
  return serial(async () => {
    const variantOrder = options.variants?.length
      ? options.variants
      : (["original", "contrast", "adaptiveBinary", "binaryDark"] as DocumentVariantName[]);
    const variants = variantOrder
      .map(name => ({ name, canvas: session.prepared.variants[name] }))
      .filter(x => !!x.canvas);
    return await recognizeCanvasEnsemble(worker, {
      profile: options.profile ?? "japanese",
      variants,
      psms: options.psms ?? ["11", "6"],
      whitelist: options.whitelist,
      minSimilarity: options.minSimilarity ?? 0.64,
      minSupport: options.minSupport ?? 2,
      minConfidence: options.minConfidence ?? 0.54,
      validate: options.validate,
    });
  });
}

/** Generic profiles shared by certificates and parts slips. */
export const OCR_FIELD_PRESETS = {
  japaneseText: {
    profile: "japanese" as OcrProfile,
    psms: ["7", "6"],
    minSimilarity: 0.72,
    minSupport: 2,
    minConfidence: 0.58,
  },
  code: {
    profile: "alnum" as OcrProfile,
    psms: ["7", "8"],
    minSimilarity: 0.68,
    minSupport: 2,
    minConfidence: 0.60,
  },
  number: {
    profile: "numeric" as OcrProfile,
    psms: ["7", "8"],
    whitelist: "0123456789.,+- ",
    minSimilarity: 0.78,
    minSupport: 2,
    minConfidence: 0.62,
  },
  money: {
    profile: "money" as OcrProfile,
    psms: ["7", "8"],
    whitelist: "0123456789,.- ",
    minSimilarity: 0.80,
    minSupport: 2,
    minConfidence: 0.64,
  },
  date: {
    profile: "date" as OcrProfile,
    psms: ["7", "6"],
    minSimilarity: 0.72,
    minSupport: 2,
    minConfidence: 0.60,
  },
} satisfies Record<string, RegionRecognitionOptions>;
