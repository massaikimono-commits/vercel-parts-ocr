/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { orientedCanvas } from "../diagnostic/stage-a20/a19-table-crops";
import { reconstructTokenGrid } from "./p5-token-grid-core.mjs";
import type { P5Result, P5Token } from "./p5-token-grid-types";

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/jpeg", .96));
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
    out.push({
      text,
      x1: left,
      y1: top,
      x2: left + width,
      y2: top + height,
      confidence: Number.isFinite(confidenceRaw) ? confidenceRaw / 100 : null,
    });
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
          out.push({
            text,
            x1,
            y1,
            x2,
            y2,
            confidence: Number.isFinite(confidenceRaw) ? confidenceRaw / 100 : null,
          });
        }
      }
    }
  }
  return out;
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
  };
};

export async function runP5TokenGridBrowser(file: File): Promise<P5BrowserResult> {
  const source = await orientedCanvas(file, 2200);
  const tess: any = await import("tesseract.js");
  const worker = await tess.createWorker("jpn+eng", 1);
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: tess.PSM?.AUTO ?? "3",
      user_defined_dpi: "300",
      tessedit_char_whitelist: "",
    });
    const blob = await canvasBlob(source.canvas);
    const started = performance.now();
    let recognized: any;
    try {
      recognized = await worker.recognize(blob, {}, {
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OCR_RECOGNIZE_EXCEPTION: ${message}`);
    }
    const elapsed = Math.round(performance.now() - started);
    const data = recognized?.data ?? {};
    const tsvValue = data?.tsv;
    const textValue = data?.text;
    const blocksValue = data?.blocks;
    const tsvText = typeof tsvValue === "string" ? tsvValue : "";
    const tsvTokens = parseTsv(tsvText);
    const blockTokens = parseBlocks(blocksValue);
    const tokens = tsvTokens.length > 0 ? tsvTokens : blockTokens;
    const tokenSource: "tsv" | "blocks" | "none" = tsvTokens.length > 0 ? "tsv" : blockTokens.length > 0 ? "blocks" : "none";
    const reconstructed = reconstructTokenGrid(tokens) as P5Result;
    return {
      ...reconstructed,
      sourceWidth: source.canvas.width,
      sourceHeight: source.canvas.height,
      rotated: source.rotate,
      ocrTokenCount: tokens.length,
      assignedTokenCount: reconstructed.rows.reduce((sum, row) => sum + row.sourceTokenCount, 0),
      ocrProcessingTimeMs: elapsed,
      tableLocalizationStatus: "PAGE_SCOPE_ONLY",
      ocrOutputDiagnostic: {
        recognizedDataKeys: Object.keys(data).sort(),
        tsvType: typeof tsvValue,
        tsvLength: typeof tsvValue === "string" ? tsvValue.length : 0,
        textType: typeof textValue,
        textLength: typeof textValue === "string" ? textValue.length : 0,
        blocksPresent: Array.isArray(blocksValue),
        blockCount: Array.isArray(blocksValue) ? blocksValue.length : 0,
        blockWordCount: blockTokens.length,
        tsvParsedTokenCount: tsvTokens.length,
        blockParsedTokenCount: blockTokens.length,
        tokenSource,
        recognizeSucceeded: true,
      },
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
