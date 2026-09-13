/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { orientedCanvas } from "../diagnostic/stage-a20/a19-table-crops";
import { diagnoseSemanticHeaderRootCause, reconstructTokenGrid } from "./p5-token-grid-core.mjs";
import type { P5Token } from "./p5-token-grid-types";

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

export type P5PsmPrimaryVariant = {
  label: "PSM3_AUTO" | "PSM6_SINGLE_BLOCK" | "PSM11_SPARSE_TEXT";
  psm: string;
  recognizeSucceeded: boolean;
  recognizeElapsedMs: number | null;
  textLength: number;
  tsvLength: number;
  tsvParsedTokenCount: number;
  blockCount: number;
  blocksWordCount: number;
  pageOcrTokenCount: number;
  tokenSource: "tsv" | "blocks" | "none";
  mappedHeaderFieldCount: number;
  rowClusterCount: number;
  columnAssignmentCount: number;
  reconstructedRowCount: number;
  wrongAutoConfirm: number;
  manualReviewRequired: boolean;
  rows: Array<{ rowId: string; fields: { name: string; qty: string; retail: string; cost: string }; sourceTokenCount: number }>;
  error?: string;
};

export type P5PsmPrimaryComparison = {
  diagnosticOnly: true;
  runtimePsmUnchanged: true;
  runtimePsm: "3";
  language: "jpn+eng";
  maxSide: 2200;
  preprocessingUnchanged: true;
  canvasWidth: number;
  canvasHeight: number;
  variants: P5PsmPrimaryVariant[];
};

function summarizeVariant(label: P5PsmPrimaryVariant["label"], psm: any, data: any, elapsed: number): P5PsmPrimaryVariant & { semanticRootCause: any } {
  const tsvValue = typeof data?.tsv === "string" ? data.tsv : "";
  const textValue = typeof data?.text === "string" ? data.text : "";
  const tsvTokens = parseTsv(tsvValue);
  const blockTokens = parseBlocks(data?.blocks);
  const tokens = tsvTokens.length > 0 ? tsvTokens : blockTokens;
  const tokenSource: "tsv" | "blocks" | "none" = tsvTokens.length > 0 ? "tsv" : blockTokens.length > 0 ? "blocks" : "none";
  const reconstructed: any = reconstructTokenGrid(tokens);
  const rows = Array.isArray(reconstructed?.rows) ? reconstructed.rows.map((row: any) => ({ rowId: String(row?.rowId ?? ""), fields: { name: String(row?.fields?.name ?? ""), qty: String(row?.fields?.qty ?? ""), retail: String(row?.fields?.retail ?? ""), cost: String(row?.fields?.cost ?? "") }, sourceTokenCount: Number(row?.sourceTokenCount ?? 0) })) : [];
  return {
    label,
    psm: String(psm),
    recognizeSucceeded: true,
    recognizeElapsedMs: elapsed,
    textLength: textValue.length,
    tsvLength: tsvValue.length,
    tsvParsedTokenCount: tsvTokens.length,
    blockCount: Array.isArray(data?.blocks) ? data.blocks.length : 0,
    blocksWordCount: blockTokens.length,
    pageOcrTokenCount: tokens.length,
    tokenSource,
    mappedHeaderFieldCount: reconstructed?.stageDiagnostics?.mappedHeaderFieldCount ?? 0,
    rowClusterCount: reconstructed?.stageDiagnostics?.clusteredRowCount ?? 0,
    columnAssignmentCount: rows.reduce((sum: number, row: any) => sum + Number(row?.sourceTokenCount || 0), 0),
    reconstructedRowCount: reconstructed?.stageDiagnostics?.reconstructedRowCount ?? 0,
    wrongAutoConfirm: Number(reconstructed?.wrongAutoConfirm ?? 0),
    manualReviewRequired: Boolean(reconstructed?.manualReviewRequired ?? true),
    rows,
    semanticRootCause: diagnoseSemanticHeaderRootCause(tokens),
  };
}

export async function runP5SemanticHeaderDiagnostic(file: File, requestedPsm: "3" | "6") {
  const source = await orientedCanvas(file, 2200);
  const blob = await canvasBlob(source.canvas);
  const tess: any = await import("tesseract.js");
  const spec = requestedPsm === "6"
    ? { label: "PSM6_SINGLE_BLOCK" as const, psm: tess.PSM?.SINGLE_BLOCK ?? "6" }
    : { label: "PSM3_AUTO" as const, psm: tess.PSM?.AUTO ?? "3" };
  const worker = await tess.createWorker("jpn+eng", 1);
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "", tessedit_pageseg_mode: spec.psm });
    const started = performance.now();
    const recognized = await worker.recognize(blob, {}, OUTPUT_OPTIONS);
    const elapsed = Math.round(performance.now() - started);
    return {
      diagnosticOnly: true,
      runtimePsmUnchanged: true,
      runtimePsm: "3" as const,
      selectedDiagnosticPsm: String(spec.psm),
      language: "jpn+eng",
      maxSide: 2200,
      preprocessingUnchanged: true,
      canvasWidth: source.canvas.width,
      canvasHeight: source.canvas.height,
      variant: summarizeVariant(spec.label, spec.psm, recognized?.data ?? {}, elapsed),
    };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: tess.PSM?.AUTO ?? "3" }).catch(() => undefined);
    await worker.terminate().catch(() => undefined);
  }
}

export async function runP5PsmPrimaryComparison(file: File): Promise<P5PsmPrimaryComparison> {
  const source = await orientedCanvas(file, 2200);
  const blob = await canvasBlob(source.canvas);
  const tess: any = await import("tesseract.js");
  const specs = [
    { label: "PSM3_AUTO" as const, psm: tess.PSM?.AUTO ?? "3" },
    { label: "PSM6_SINGLE_BLOCK" as const, psm: tess.PSM?.SINGLE_BLOCK ?? "6" },
    { label: "PSM11_SPARSE_TEXT" as const, psm: tess.PSM?.SPARSE_TEXT ?? "11" },
  ];
  const worker = await tess.createWorker("jpn+eng", 1);
  const variants: P5PsmPrimaryVariant[] = [];
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "" });
    for (const spec of specs) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: spec.psm });
        const started = performance.now();
        const recognized = await worker.recognize(blob, {}, OUTPUT_OPTIONS);
        const elapsed = Math.round(performance.now() - started);
        const summarized = summarizeVariant(spec.label, spec.psm, recognized?.data ?? {}, elapsed);
        const { semanticRootCause: _semanticRootCause, ...legacy } = summarized;
        variants.push(legacy);
      } catch (error) {
        variants.push({ label: spec.label, psm: String(spec.psm), recognizeSucceeded: false, recognizeElapsedMs: null, textLength: 0, tsvLength: 0, tsvParsedTokenCount: 0, blockCount: 0, blocksWordCount: 0, pageOcrTokenCount: 0, tokenSource: "none", mappedHeaderFieldCount: 0, rowClusterCount: 0, columnAssignmentCount: 0, reconstructedRowCount: 0, wrongAutoConfirm: 0, manualReviewRequired: true, rows: [], error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: tess.PSM?.AUTO ?? "3" }).catch(() => undefined);
    await worker.terminate().catch(() => undefined);
  }
  return { diagnosticOnly: true, runtimePsmUnchanged: true, runtimePsm: "3", language: "jpn+eng", maxSide: 2200, preprocessingUnchanged: true, canvasWidth: source.canvas.width, canvasHeight: source.canvas.height, variants };
}
