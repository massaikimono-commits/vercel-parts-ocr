/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { orientedCanvas } from "../diagnostic/stage-a20/a19-table-crops";
import { compareSemanticMappingCandidates } from "./p5-semantic-candidates.mjs";
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

export type P5SemanticCandidateSummary = {
  variantId: "CURRENT" | "A_SPLIT_TOKEN_COMPOSITION" | "B_GENERALIZED_FUZZY" | "C_SOFT_HEADER_BAND";
  mappedHeaderFieldCount: number;
  rowClusterCount: number;
  columnAssignmentCount: number;
  reconstructedRowCount: number;
  nonBlankNameCount: number;
  nonBlankQtyCount: number;
  nonBlankRetailCount: number;
  nonBlankCostCount: number;
  wrongAutoConfirm: number;
  manualReviewRequired: boolean;
  processingTimeMs: number;
};

export async function runP5SemanticCandidateComparison(file: File, requestedPsm: "3" | "6") {
  const source = await orientedCanvas(file, 2200);
  const blob = await canvasBlob(source.canvas);
  const tess: any = await import("tesseract.js");
  const psm = requestedPsm === "6" ? (tess.PSM?.SINGLE_BLOCK ?? "6") : (tess.PSM?.AUTO ?? "3");
  const worker = await tess.createWorker("jpn+eng", 1);
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "", tessedit_pageseg_mode: psm });
    const started = performance.now();
    const recognized = await worker.recognize(blob, {}, OUTPUT_OPTIONS);
    const recognizeElapsedMs = Math.round(performance.now() - started);
    const data = recognized?.data ?? {};
    const tsvTokens = parseTsv(typeof data.tsv === "string" ? data.tsv : "");
    const blockTokens = parseBlocks(data.blocks);
    const tokens = tsvTokens.length ? tsvTokens : blockTokens;
    const mappingStarted = performance.now();
    const variants = compareSemanticMappingCandidates(tokens).map((variant: any) => ({
      variantId: variant.variantId,
      mappedHeaderFieldCount: Number(variant.mappedHeaderFieldCount ?? 0),
      rowClusterCount: Number(variant.rowClusterCount ?? 0),
      columnAssignmentCount: Number(variant.columnAssignmentCount ?? 0),
      reconstructedRowCount: Number(variant.reconstructedRowCount ?? 0),
      nonBlankNameCount: Number(variant.nonBlankNameCount ?? 0),
      nonBlankQtyCount: Number(variant.nonBlankQtyCount ?? 0),
      nonBlankRetailCount: Number(variant.nonBlankRetailCount ?? 0),
      nonBlankCostCount: Number(variant.nonBlankCostCount ?? 0),
      wrongAutoConfirm: Number(variant.wrongAutoConfirm ?? 0),
      manualReviewRequired: Boolean(variant.manualReviewRequired ?? true),
      processingTimeMs: recognizeElapsedMs + Math.round(performance.now() - mappingStarted),
    })) as P5SemanticCandidateSummary[];
    return {
      diagnosticOnly: true,
      runtimePsmUnchanged: true,
      runtimePsm: "3" as const,
      selectedDiagnosticPsm: String(psm),
      pageOcrTokenCount: tokens.length,
      tokenSource: tsvTokens.length ? "tsv" : blockTokens.length ? "blocks" : "none",
      variants,
    };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: tess.PSM?.AUTO ?? "3" }).catch(() => undefined);
    await worker.terminate().catch(() => undefined);
  }
}
