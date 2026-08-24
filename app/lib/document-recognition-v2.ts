import {
  prepareDocumentImage,
  createOcrVariants,
  type DocumentVariantName,
  type PreparedDocument,
} from "./document-image-pipeline";
import { deskewDocument } from "./document-recognition-engine";
import { recognizeCanvasEnsemble, type OcrConsensusResult, type OcrProfile } from "./ocr-ensemble";

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

const globalState = globalThis as typeof globalThis & {
  __icbOcrQueue?: Promise<void>;
};

function canvas(width: number, height: number) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width));
  out.height = Math.max(1, Math.round(height));
  return out;
}

function cropRelative(source: HTMLCanvasElement, region: RelativeRegion, targetWidth = 2200) {
  const sx = Math.max(0, Math.round(source.width * region.x));
  const sy = Math.max(0, Math.round(source.height * region.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * region.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * region.height)));
  const scale = Math.max(1, Math.min(10, targetWidth / Math.max(1, sw)));
  const pad = 28;
  const out = canvas(sw * scale + pad * 2, sh * scale + pad * 2);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, out.width - pad * 2, out.height - pad * 2);
  return out;
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

  // Geometry correction is shared by every document type. It never depends on a
  // vehicle, supplier, address, or a hard-coded sample image. Low-confidence skew
  // estimates are ignored rather than risking a destructive correction.
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

export async function recognizeDocumentRegion(
  session: DocumentRecognitionSession,
  worker: any,
  region: RelativeRegion,
  options: RegionRecognitionOptions = {},
): Promise<OcrConsensusResult> {
  return serial(async () => {
    const variantOrder = options.variants?.length
      ? options.variants
      : (["original", "contrast", "binaryDark", "binaryLight"] as DocumentVariantName[]);
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
      return await recognizeCanvasEnsemble(worker, {
        profile: options.profile ?? "text",
        variants: crops,
        psms: options.psms ?? ["7", "6"],
        whitelist: options.whitelist,
        minSimilarity: options.minSimilarity,
        minSupport: options.minSupport,
        minConfidence: options.minConfidence,
        validate: options.validate,
      });
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
      : (["original", "contrast", "binaryDark"] as DocumentVariantName[]);
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

/**
 * Generic field profiles. They describe the kind of text, not a specific photo or vehicle.
 * The same profiles are shared by vehicle certificates and parts slips.
 */
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
