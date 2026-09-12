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

export type P5BrowserResult = P5Result & {
  sourceWidth: number;
  sourceHeight: number;
  rotated: boolean;
  ocrTokenCount: number;
  assignedTokenCount: number;
  ocrProcessingTimeMs: number;
  tableLocalizationStatus: "PAGE_SCOPE_ONLY";
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
    const recognized = await worker.recognize(blob, {}, {
      blocks: false,
      text: false,
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
    const elapsed = Math.round(performance.now() - started);
    const tokens = parseTsv(String(recognized.data.tsv || ""));
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
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
