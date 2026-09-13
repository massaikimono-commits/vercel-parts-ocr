/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { orientedCanvas } from "../diagnostic/stage-a20/a19-table-crops";
import { diagnoseHeaderCandidates, reconstructTokenGrid } from "./p5-token-grid-core.mjs";
import type { P5Result, P5Token } from "./p5-token-grid-types";

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/jpeg", .96));
}

function loadInputImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    image.src = url;
  });
}

function renderOrientationCanvas(image: HTMLImageElement, degrees: 0 | 90 | 180 | -90, maxSide = 2200) {
  const quarterTurn = Math.abs(degrees) === 90;
  const rawWidth = quarterTurn ? image.naturalHeight : image.naturalWidth;
  const rawHeight = quarterTurn ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(rawWidth, rawHeight));
  const width = Math.max(1, Math.round(rawWidth * scale));
  const height = Math.max(1, Math.round(rawHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (degrees === 0) {
    ctx.drawImage(image, 0, 0, width, height);
  } else if (degrees === 90) {
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, 0, height, width);
  } else if (degrees === -90) {
    ctx.translate(0, height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(image, 0, 0, height, width);
  } else {
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
    ctx.drawImage(image, 0, 0, width, height);
  }
  ctx.restore();
  return canvas;
}

function pixelStatistics(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { meanLuminance: null, lumaStddev: null, minLuma: null, maxLuma: null, nonblankPixelRatio: null, sampledPixels: 0 };
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height).data;
  const totalPixels = width * height;
  const step = Math.max(1, Math.ceil(Math.sqrt(totalPixels / 180000)));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let min = 255;
  let max = 0;
  let nonblank = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const luma = image[i] * 0.2126 + image[i + 1] * 0.7152 + image[i + 2] * 0.0722;
      n += 1;
      sum += luma;
      sumSq += luma * luma;
      min = Math.min(min, luma);
      max = Math.max(max, luma);
      if (luma < 248) nonblank += 1;
    }
  }
  const mean = n ? sum / n : 0;
  const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0;
  return {
    meanLuminance: Number(mean.toFixed(2)),
    lumaStddev: Number(Math.sqrt(variance).toFixed(2)),
    minLuma: n ? Number(min.toFixed(2)) : null,
    maxLuma: n ? Number(max.toFixed(2)) : null,
    nonblankPixelRatio: n ? Number((nonblank / n).toFixed(6)) : null,
    sampledPixels: n,
  };
}

function parseTsv(tsv: string): P5Token[] {
  const lines = String(tsv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const index = Object.fromEntries(header.map((value, i) => [value, i]));
  const required = ["level", "left", "top", "width", "height", "conf", "text"];
  if (required.some((key) => index[key] === undefined)) return [];
  const out: P5Token[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (Number(cells[index.level]) !== 5) continue;
    const text = String(cells[index.text] ?? "").trim();
    if (!text) continue;
    const left = Number(cells[index.left]);
    const top = Number(cells[index.top]);
    const width = Number(cells[index.width]);
    const height = Number(cells[index.height]);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const confidenceRaw = Number(cells[index.conf]);
    out.push({ text, x1: left, y1: top, x2: left + width, y2: top + height, confidence: Number.isFinite(confidenceRaw) ? confidenceRaw / 100 : null });
  }
  return out;
}

function parseBlocks(blocks: any): P5Token[] {
  if (!Array.isArray(blocks)) return [];
  const out: P5Token[] = [];
  for (const block of blocks) {
    for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
      for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
        for (const word of Array.isArray(line?.words) ? line.words : []) {
          const text = String(word?.text ?? "").trim();
          const bbox = word?.bbox;
          const x1 = Number(bbox?.x0);
          const y1 = Number(bbox?.y0);
          const x2 = Number(bbox?.x1);
          const y2 = Number(bbox?.y1);
          if (!text || ![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
          const confidenceRaw = Number(word?.confidence);
          out.push({ text, x1, y1, x2, y2, confidence: Number.isFinite(confidenceRaw) ? confidenceRaw / 100 : null });
        }
      }
    }
  }
  return out;
}

const OUTPUT_OPTIONS = {
  text: true,
  blocks: true,
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
};

function summarizeRecognition(recognized: any, elapsed: number, canvas: HTMLCanvasElement, blob: Blob) {
  const data = recognized?.data ?? {};
  const tsvValue = data?.tsv;
  const textValue = data?.text;
  const blocksValue = data?.blocks;
  const tsvTokens = parseTsv(typeof tsvValue === "string" ? tsvValue : "");
  const blockTokens = parseBlocks(blocksValue);
  const tokens = tsvTokens.length > 0 ? tsvTokens : blockTokens;
  const tokenSource: "tsv" | "blocks" | "none" = tsvTokens.length > 0 ? "tsv" : blockTokens.length > 0 ? "blocks" : "none";
  return {
    data,
    tsvValue,
    textValue,
    blocksValue,
    tsvTokens,
    blockTokens,
    tokens,
    tokenSource,
    diagnostic: {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      blobBytes: blob.size,
      recognizeElapsedMs: elapsed,
      recognizeSucceeded: true,
      textLength: typeof textValue === "string" ? textValue.length : 0,
      tsvLength: typeof tsvValue === "string" ? tsvValue.length : 0,
      tsvParsedTokenCount: tsvTokens.length,
      blockCount: Array.isArray(blocksValue) ? blocksValue.length : 0,
      blocksWordCount: blockTokens.length,
      pageOcrTokenCount: tokens.length,
      tokenSource,
    },
  };
}

async function recognizeCanvas(worker: any, canvas: HTMLCanvasElement) {
  const blob = await canvasBlob(canvas);
  const started = performance.now();
  const recognized = await worker.recognize(blob, {}, OUTPUT_OPTIONS);
  const elapsed = Math.round(performance.now() - started);
  return summarizeRecognition(recognized, elapsed, canvas, blob);
}

export type P5BrowserResult = P5Result & {
  sourceWidth: number;
  sourceHeight: number;
  rotated: boolean;
  ocrTokenCount: number;
  assignedTokenCount: number;
  ocrProcessingTimeMs: number;
  tableLocalizationStatus: "PAGE_SCOPE_ONLY";
  ocrOutputDiagnostic: {
    recognizedDataKeys: string[];
    tsvType: string;
    tsvLength: number;
    textType: string;
    textLength: number;
    blocksPresent: boolean;
    blockCount: number;
    blockWordCount: number;
    tsvParsedTokenCount: number;
    blockParsedTokenCount: number;
    tokenSource: "tsv" | "blocks" | "none";
    recognizeSucceeded: true;
    acquisitionDiagnostic: any;
    headerDiagnostic: any;
    orientationCounterfactual: any;
    psmCounterfactual: any;
  };
};

export async function runP5TokenGridBrowser(file: File): Promise<P5BrowserResult> {
  const inputImage = await loadInputImage(file);
  const inputDimensions = { width: inputImage.naturalWidth, height: inputImage.naturalHeight };
  const source = await orientedCanvas(file, 2200);
  const pixels = pixelStatistics(source.canvas);
  const tess: any = await import("tesseract.js");
  const psm = tess.PSM?.AUTO ?? "3";
  const worker = await tess.createWorker("jpn+eng", 1);
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: psm, user_defined_dpi: "300", tessedit_char_whitelist: "" });

    let current: Awaited<ReturnType<typeof recognizeCanvas>>;
    try {
      current = await recognizeCanvas(worker, source.canvas);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OCR_RECOGNIZE_EXCEPTION: ${message}`);
    }

    const reconstructed = reconstructTokenGrid(current.tokens) as P5Result;
    const headerDiagnostic = diagnoseHeaderCandidates(current.tokens);
    const acquisitionDiagnostic = {
      imageLoadDecodeSucceeded: true,
      inputImageWidth: inputDimensions.width,
      inputImageHeight: inputDimensions.height,
      canvasWidth: source.canvas.width,
      canvasHeight: source.canvas.height,
      orientation: source.rotate ? "rotated-90ccw" : "as-loaded",
      rotated: source.rotate,
      rotateRadians: source.rotate ? -Math.PI / 2 : 0,
      canvasBlobSizeBytes: current.diagnostic.blobBytes,
      recognizeElapsedMs: current.diagnostic.recognizeElapsedMs,
      ocrConfidence: Number.isFinite(Number(current.data?.confidence)) ? Number(current.data.confidence) : null,
      psm: String(psm),
      workerOutputCounts: {
        recognizedDataKeyCount: Object.keys(current.data).length,
        textLength: current.diagnostic.textLength,
        tsvLength: current.diagnostic.tsvLength,
        tsvParsedTokenCount: current.tsvTokens.length,
        blockCount: Array.isArray(current.blocksValue) ? current.blocksValue.length : 0,
        blocksWordCount: current.blockTokens.length,
        selectedTokenCount: current.tokens.length,
      },
      pixelStatistics: pixels,
    };

    const currentDegrees: 0 | -90 = source.rotate ? -90 : 0;
    const orientationVariants: Array<{ label: string; degrees: 0 | 90 | 180 | -90; current: boolean; reusedCurrent?: boolean } & Record<string, any>> = [
      { label: "CURRENT", degrees: currentDegrees, current: true, reusedCurrent: true, ...current.diagnostic },
    ];

    for (const degrees of [0, 90, 180, -90] as const) {
      if (degrees === currentDegrees) {
        orientationVariants.push({ label: `${degrees}deg`, degrees, current: false, reusedCurrent: true, ...current.diagnostic });
        continue;
      }
      const cfCanvas = renderOrientationCanvas(inputImage, degrees, 2200);
      try {
        const cf = await recognizeCanvas(worker, cfCanvas);
        orientationVariants.push({ label: `${degrees}deg`, degrees, current: false, reusedCurrent: false, ...cf.diagnostic });
      } catch (error) {
        orientationVariants.push({
          label: `${degrees}deg`, degrees, current: false, reusedCurrent: false,
          recognizeSucceeded: false,
          recognizeError: error instanceof Error ? error.message : String(error),
          canvasWidth: cfCanvas.width, canvasHeight: cfCanvas.height, blobBytes: null, recognizeElapsedMs: null,
          textLength: 0, tsvLength: 0, tsvParsedTokenCount: 0, blockCount: 0, blocksWordCount: 0, pageOcrTokenCount: 0, tokenSource: "none",
        });
      }
    }

    const orientationCounterfactual = {
      diagnosticOnly: true,
      runtimeOrientationUnchanged: true,
      psm: String(psm),
      language: "jpn+eng",
      maxSide: 2200,
      successMetric: "text/token/word-count-not-confidence",
      variants: orientationVariants,
    };

    const psmSpecs = [
      { label: "CURRENT_AUTO", psm: tess.PSM?.AUTO ?? "3", expectedValue: "3", current: true },
      { label: "SINGLE_BLOCK", psm: tess.PSM?.SINGLE_BLOCK ?? "6", expectedValue: "6", current: false },
      { label: "SPARSE_TEXT", psm: tess.PSM?.SPARSE_TEXT ?? "11", expectedValue: "11", current: false },
      { label: "SPARSE_TEXT_OSD", psm: tess.PSM?.SPARSE_TEXT_OSD ?? "12", expectedValue: "12", current: false },
    ];
    const psmVariants: Array<Record<string, any>> = [];
    for (const spec of psmSpecs) {
      if (spec.current) {
        psmVariants.push({ label: spec.label, psm: String(spec.psm), expectedValue: spec.expectedValue, current: true, reusedCurrent: true, ...current.diagnostic });
        continue;
      }
      try {
        await worker.setParameters({ tessedit_pageseg_mode: spec.psm });
        const cf = await recognizeCanvas(worker, source.canvas);
        psmVariants.push({ label: spec.label, psm: String(spec.psm), expectedValue: spec.expectedValue, current: false, reusedCurrent: false, ...cf.diagnostic });
      } catch (error) {
        psmVariants.push({
          label: spec.label,
          psm: String(spec.psm),
          expectedValue: spec.expectedValue,
          current: false,
          reusedCurrent: false,
          recognizeSucceeded: false,
          recognizeError: error instanceof Error ? error.message : String(error),
          canvasWidth: source.canvas.width,
          canvasHeight: source.canvas.height,
          blobBytes: null,
          recognizeElapsedMs: null,
          textLength: 0,
          tsvLength: 0,
          tsvParsedTokenCount: 0,
          blockCount: 0,
          blocksWordCount: 0,
          pageOcrTokenCount: 0,
          tokenSource: "none",
        });
      }
    }
    await worker.setParameters({ tessedit_pageseg_mode: psm });

    const psmCounterfactual = {
      diagnosticOnly: true,
      runtimePsmUnchanged: true,
      runtimePsm: String(psm),
      orientation: source.rotate ? "rotated-90ccw" : "as-loaded",
      language: "jpn+eng",
      maxSide: 2200,
      preprocessingUnchanged: true,
      successMetric: "text/token/word-count-not-confidence",
      variants: psmVariants,
    };

    return {
      ...reconstructed,
      stageDiagnostics: { ...reconstructed.stageDiagnostics, acquisitionDiagnostic, headerDiagnostic, orientationCounterfactual, psmCounterfactual } as any,
      sourceWidth: source.canvas.width,
      sourceHeight: source.canvas.height,
      rotated: source.rotate,
      ocrTokenCount: current.tokens.length,
      assignedTokenCount: reconstructed.rows.reduce((sum, row) => sum + row.sourceTokenCount, 0),
      ocrProcessingTimeMs: current.diagnostic.recognizeElapsedMs,
      tableLocalizationStatus: "PAGE_SCOPE_ONLY",
      ocrOutputDiagnostic: {
        recognizedDataKeys: Object.keys(current.data).sort(),
        tsvType: typeof current.tsvValue,
        tsvLength: current.diagnostic.tsvLength,
        textType: typeof current.textValue,
        textLength: current.diagnostic.textLength,
        blocksPresent: Array.isArray(current.blocksValue),
        blockCount: Array.isArray(current.blocksValue) ? current.blocksValue.length : 0,
        blockWordCount: current.blockTokens.length,
        tsvParsedTokenCount: current.tsvTokens.length,
        blockParsedTokenCount: current.blockTokens.length,
        tokenSource: current.tokenSource,
        recognizeSucceeded: true,
        acquisitionDiagnostic,
        headerDiagnostic,
        orientationCounterfactual,
        psmCounterfactual,
      },
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
