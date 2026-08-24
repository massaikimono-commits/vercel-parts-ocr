import {
  prepareDocumentImage,
  createOcrVariants,
  type DocumentVariantName,
  type PreparedDocument,
} from "./document-image-pipeline";
import { deskewDocument } from "./document-recognition-engine";
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
};

export type DocumentRecognitionSession = {
  prepared: PreparedDocument;
  qualityWarnings: string[];
  geometry: {
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

  const deskewed = deskewDocument(initial.normalized);
  let prepared = initial;
  const warnings = [...initial.quality.warnings];
  if (deskewed.applied) {
    const normalized = deskewed.canvas;
    const variants = createOcrVariants(normalized);
    releaseVariants(initial.variants);
    if (initial.normalized !== initial.source) {
      initial.normalized.width = 1;
      initial.normalized.height = 1;
    }
    prepared = {
      ...initial,
      normalized,
      variants,
    };
    warnings.push(`傾き補正: ${deskewed.angle.toFixed(2)}° (confidence=${deskewed.confidence.toFixed(2)})`);
  }

  return {
    prepared,
    qualityWarnings: warnings,
    geometry: {
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
 *
 * Pass 1 uses the normal multi-variant ensemble. If that result is strong, we stop.
 * Weak/empty fields are automatically re-read at higher resolution with alternate
 * segmentation modes, and token-level confidence from TSV is used when weighting
 * those recovery observations. No vehicle/address/supplier-specific correction is
 * performed in this layer.
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
      } finally {
        cleanupCanvases(recoveryCrops);
      }

      const recovered = buildOcrConsensus(observations, {
        profile,
        minSimilarity: Math.max(0.48, (options.minSimilarity ?? 0.72) - 0.06),
        minSupport: options.minSupport,
        minConfidence: options.minConfidence,
        validate: options.validate,
      });

      const better = Boolean(recovered.value) && (
        !first.value
        || recovered.confidence > first.confidence + 0.025
        || recovered.support > first.support
      );

      return better
        ? { ...recovered, reason: `${recovered.reason} / 弱いセルを高解像度再読取(${passes}pass)` }
        : { ...first, reason: `${first.reason} / 高解像度再読取${passes}passでも改善なし` };
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
