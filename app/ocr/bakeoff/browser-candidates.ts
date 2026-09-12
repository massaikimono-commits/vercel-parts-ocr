/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { detectPaperBox, makeCellCrop, orientedCanvas, type CandidateRow, type ColumnBoxes } from "../diagnostic/stage-a20/a19-table-crops";
import { recognizeTess, type FieldKey } from "../diagnostic/stage-a20/recognition";
import { columnsFromMeasuredRules, makeA22CellCrop, measureTableRules, rectifyPaper, type CorrectedRow } from "../diagnostic/stage-a22/crop-correction";
import { BAKEOFF_CONTRACT_VERSION, fieldsFromRows, meanConfidence, type BakeoffPrediction, type RowPrediction } from "./contract";
import { adaptFrozenControl } from "./p0-adapter";
import { measureCaptureQuality } from "./quality";
import { rowConfidence } from "./normalize";
import { validateRows } from "./hybrid";

const FIELDS: FieldKey[] = ["name", "qty", "retail", "cost"];
const FIXED_COLUMNS: ColumnBoxes = { name: { x1: .025, x2: .395 }, qty: { x1: .432, x2: .472 }, retail: { x1: .480, x2: .570 }, cost: { x1: .596, x2: .676 } };

function fixedRows(paper: { x: number; y: number; w: number; h: number }) {
  const rows: CandidateRow[] = [];
  for (let index = 0; ; index += 1) {
    const y = .440 + index * .100;
    if (y >= .88) break;
    const top = paper.y + paper.h * y;
    const bottom = paper.y + paper.h * (y + .070);
    rows.push({ top, bottom, center: (top + bottom) / 2, source: "frozen-fixed" });
  }
  return rows;
}

function rowsFromMeasuredRules(horizontal: number[], paper: { x: number; y: number; w: number; h: number }): CorrectedRow[] {
  const relevant = horizontal.filter((value) => value >= paper.h * .38 && value <= paper.h * .94).sort((a, b) => a - b);
  const rows: CorrectedRow[] = [];
  for (let index = 0; index < relevant.length - 1; index += 1) {
    const top = relevant[index];
    const bottom = relevant[index + 1];
    const height = bottom - top;
    if (height < paper.h * .018 || height > paper.h * .13) continue;
    const margin = Math.max(2, paper.h * .003);
    const sourceRow: CandidateRow = { top, bottom, center: (top + bottom) / 2, source: "measured-rules" };
    rows.push({ top: top + margin, bottom: bottom - margin, center: sourceRow.center, source: "p1-rule-bounded", boundedByRules: true, sourceRow });
  }
  return rows;
}

function familyFromCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { family: "unknown", confidence: null };
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(4, Math.floor(data.length / 4 / 30000));
  let yellow = 0;
  let samples = 0;
  for (let pixel = 0; pixel < data.length / 4; pixel += step) {
    const index = pixel * 4;
    const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
    if (red > 110 && green > 100 && blue < Math.min(red, green) * .82) yellow += 1;
    samples += 1;
  }
  const ratio = samples ? yellow / samples : 0;
  return ratio > .08 ? { family: "yellow-parts-slip", confidence: Math.min(1, ratio / .25) } : { family: "unknown", confidence: Math.max(0, 1 - ratio / .08) };
}

async function recognizeRows(worker: any, tess: any, canvas: HTMLCanvasElement, paper: any, rows: Array<CandidateRow | CorrectedRow>, columns: ColumnBoxes, p1: boolean) {
  const predictions: RowPrediction[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const fields = {} as RowPrediction["fields"];
    for (const field of FIELDS) {
      const row = rows[rowIndex];
      const cell = p1
        ? await makeA22CellCrop(canvas, paper, row as CorrectedRow, columns[field], field, rowIndex, field === "name" ? 1600 : 900)
        : await makeCellCrop(canvas, paper, row, columns[field], field, rowIndex, field === "name" ? 1600 : 900);
      const result = await recognizeTess(worker, tess, cell.blob, field);
      fields[field] = { raw: result.raw, normalized: result.normalized, confidence: result.confidence, source: p1 ? "p1-a22-tesseract" : "p0-frozen-control" };
    }
    const prediction: RowPrediction = {
      rowId: `R${String(rowIndex + 1).padStart(2, "0")}`,
      region: { x: paper.x, y: rows[rowIndex].top, width: paper.w, height: rows[rowIndex].bottom - rows[rowIndex].top },
      fields,
      confidence: null,
      duplicateOf: null,
    };
    prediction.confidence = rowConfidence(prediction);
    if (Object.values(fields).some((field) => field.normalized)) predictions.push(prediction);
  }
  return predictions;
}

function memoryBytes() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize ?? null;
}

export async function runBrowserCandidates(file: File, imageId: string, captureId: string, onStatus: (message: string) => void) {
  const runId = crypto.randomUUID();
  const source = await orientedCanvas(file, 2200);
  const paper = detectPaperBox(source.canvas);
  const tess: any = await import("tesseract.js");
  const loadStarted = performance.now();
  const worker = await tess.createWorker("jpn+eng", 1);
  const modelLoadTimeMs = Math.round(performance.now() - loadStarted);
  try {
    onStatus(`${imageId}: P0 control`);
    const p0Started = performance.now();
    const p0Quality = measureCaptureQuality(source.canvas, { coverage: paper.w * paper.h / Math.max(1, source.canvas.width * source.canvas.height) });
    const p0Rows = await recognizeRows(worker, tess, source.canvas, paper, fixedRows(paper), FIXED_COLUMNS, false);
    const p0 = adaptFrozenControl({ runId, imageId, captureId, qualityMetrics: p0Quality, control: { rows: p0Rows, processingTimeMs: Math.round(performance.now() - p0Started), modelLoadTimeMs } });

    onStatus(`${imageId}: P1 guided known-template`);
    const p1Started = performance.now();
    const rectified = rectifyPaper(source.canvas, paper);
    const rules = measureTableRules(rectified.canvas, rectified.paper);
    const p1Rows = rowsFromMeasuredRules(rules.horizontal, rectified.paper);
    const p1Quality = measureCaptureQuality(rectified.canvas, { coverage: paper.w * paper.h / Math.max(1, source.canvas.width * source.canvas.height), angleDeg: rectified.skewDeg, perspectiveDelta: rectified.perspectiveDelta });
    const family = familyFromCanvas(rectified.canvas);
    const reasons = [...p1Quality.rejectionReasons];
    if (family.family !== "yellow-parts-slip") reasons.push("unknown-document-family");
    if (!p1Rows.length) reasons.push("no-rule-bounded-rows");
    const p1PredictedRows = await recognizeRows(worker, tess, rectified.canvas, rectified.paper, p1Rows, columnsFromMeasuredRules(rules, rectified.paper), true);
    if (p1Rows.length > 0 && p1PredictedRows.length === 0) reasons.push("post-row-ocr-empty");
    reasons.push(...validateRows(p1PredictedRows));
    const p1: BakeoffPrediction = {
      schema: BAKEOFF_CONTRACT_VERSION,
      runId,
      candidateId: "P1",
      candidateVersion: "guided-known-template-a22.v2",
      configHash: "sha256:acedfad742ae41a81d21e1bc568b7ecfa0ce435b9b918f002485761046369628",
      imageId,
      captureId,
      documentFamilyPrediction: family,
      documentRegions: [{ documentId: null, x: paper.x, y: paper.y, width: paper.w, height: paper.h }],
      qualityMetrics: p1Quality,
      rowPredictions: p1PredictedRows,
      fieldPredictions: [],
      confidence: null,
      abstainReason: reasons.length ? [...new Set(reasons)].join(";") : null,
      manualReviewRequired: reasons.length > 0,
      processingTimeMs: Math.round(performance.now() - p1Started),
      modelLoadTimeMs,
      memoryBytes: memoryBytes(),
      timeout: false,
      error: null,
      gtIncluded: false,
    };
    p1.fieldPredictions = fieldsFromRows(p1.rowPredictions);
    p1.confidence = meanConfidence(p1.rowPredictions);
    return { p0, p1 };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
