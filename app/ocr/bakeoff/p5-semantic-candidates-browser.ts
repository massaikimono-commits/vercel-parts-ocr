/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { orientedCanvas } from "../diagnostic/stage-a20/a19-table-crops";
import { compareSemanticMappingCandidates } from "./p5-semantic-candidates.mjs";
import { parsePageTsv as parseTsv, parsePageBlocks as parseBlocks } from "./p5-token-evidence.mjs";
import type { P5Token } from "./p5-token-grid-types";

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/jpeg", .96));
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
  variantId: "CURRENT" | "A_SPLIT_TOKEN_COMPOSITION" | "B_GENERALIZED_FUZZY" | "C_SOFT_HEADER_BAND" | "D_PARTIAL_HEADER_COLUMN_LATTICE";
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

const MANAGEMENT_VARIANTS = new Set(["CURRENT", "C_SOFT_HEADER_BAND", "D_PARTIAL_HEADER_COLUMN_LATTICE"]);

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
    const variants = compareSemanticMappingCandidates(tokens)
      .filter((variant: any) => MANAGEMENT_VARIANTS.has(String(variant.variantId)))
      .map((variant: any) => ({
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
