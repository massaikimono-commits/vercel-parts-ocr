import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "evaluation/parts/yellow-regression-manifest.v2.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "evaluation/parts/yellow-documents.corrected.v2.json"), "utf8"));
const predictionPath = process.argv[2];
if (!predictionPath) {
  console.error("usage: node scripts/score-parts-ocr-bakeoff-v1.mjs <prediction-export.json>");
  process.exit(2);
}
const exported = JSON.parse(fs.readFileSync(path.resolve(predictionPath), "utf8"));
if (exported.gtIncluded !== false) throw new Error("prediction export must declare gtIncluded=false");

const normName = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const normNumber = (value) => String(value ?? "").normalize("NFKC").replace(/[￥¥,\s]/g, "").trim();
const captureByImage = new Map(manifest.captures.map((capture) => [capture.imageId, capture]));
const fields = ["name", "qty", "retail", "cost"];
const gtField = { name: "partName", qty: "qty", retail: "retail", cost: "cost" };

function expectedRows(capture) {
  return capture.documentsInCapture.flatMap((relation) => fixture.documents[relation.documentId] ?? []);
}

function metricSeed(candidateId) {
  return { candidateId, captureCount: 0, singleDocumentCaptures: 0, compositeCaptures: 0, expectedRows: 0, detectedRows: 0, matchedRows: 0, falseRows: 0, missedRows: 0, duplicateRows: 0, fields: Object.fromEntries(fields.map((field) => [field, { correct: 0, total: 0 }])), completeRows: 0, expectedCompleteRows: 0, wrongAutoConfirm: 0, abstain: 0, manualReview: 0, documentComplete: 0, documentEvaluable: 0, captureComplete: 0, timeout: 0, errors: 0, processingTimeMs: 0 };
}

const aggregates = new Map();
for (const prediction of exported.results ?? []) {
  if (prediction.schema !== "icb.parts-ocr.bakeoff-prediction.v1") throw new Error(`unknown prediction schema for ${prediction.imageId}`);
  if (prediction.gtIncluded !== false) throw new Error(`GT leaked into ${prediction.candidateId}/${prediction.imageId}`);
  const capture = captureByImage.get(prediction.imageId);
  if (!capture) throw new Error(`image not in regression manifest: ${prediction.imageId}`);
  const expected = expectedRows(capture);
  const actual = prediction.rowPredictions ?? [];
  const metric = aggregates.get(prediction.candidateId) ?? metricSeed(prediction.candidateId);
  metric.captureCount += 1;
  metric[capture.subset === "SINGLE_DOCUMENT" ? "singleDocumentCaptures" : "compositeCaptures"] += 1;
  metric.expectedRows += expected.length;
  metric.detectedRows += actual.length;
  metric.matchedRows += Math.min(expected.length, actual.length);
  metric.falseRows += Math.max(0, actual.length - expected.length);
  metric.missedRows += Math.max(0, expected.length - actual.length);
  metric.duplicateRows += actual.filter((row) => row.duplicateOf).length;
  metric.expectedCompleteRows += expected.length;
  let completeRows = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const gt = expected[index];
    const row = actual[index];
    let complete = Boolean(row);
    for (const field of fields) {
      metric.fields[field].total += 1;
      const predicted = row?.fields?.[field]?.normalized ?? "";
      const wanted = gt[gtField[field]];
      const equal = field === "name" ? normName(predicted) === normName(wanted) : normNumber(predicted) === normNumber(wanted);
      if (equal) metric.fields[field].correct += 1;
      else {
        complete = false;
        if (predicted && !prediction.manualReviewRequired) metric.wrongAutoConfirm += 1;
      }
    }
    if (complete) completeRows += 1;
  }
  metric.completeRows += completeRows;
  if (prediction.abstainReason) metric.abstain += 1;
  if (prediction.manualReviewRequired) metric.manualReview += 1;
  if (capture.subset === "SINGLE_DOCUMENT") {
    metric.documentEvaluable += 1;
    if (completeRows === expected.length && actual.length === expected.length) metric.documentComplete += 1;
  }
  if (completeRows === expected.length && actual.length === expected.length) metric.captureComplete += 1;
  metric.timeout += prediction.timeout ? 1 : 0;
  metric.errors += prediction.error ? 1 : 0;
  metric.processingTimeMs += Number(prediction.processingTimeMs || 0);
  aggregates.set(prediction.candidateId, metric);
}

const metrics = [...aggregates.values()].map((metric) => ({
  ...metric,
  rowRecall: metric.expectedRows ? metric.matchedRows / metric.expectedRows : null,
  fourFieldCompleteRowRate: metric.expectedCompleteRows ? metric.completeRows / metric.expectedCompleteRows : null,
  fieldExact: Object.fromEntries(fields.map((field) => [field, { ...metric.fields[field], rate: metric.fields[field].total ? metric.fields[field].correct / metric.fields[field].total : null }])),
  documentCompleteRate: metric.documentEvaluable ? metric.documentComplete / metric.documentEvaluable : null,
  captureCompleteRate: metric.captureCount ? metric.captureComplete / metric.captureCount : null,
  averageProcessingTimeMs: metric.captureCount ? metric.processingTimeMs / metric.captureCount : null,
}));

console.log(JSON.stringify({ schema: "icb.parts-ocr.bakeoff-score.v1", scoringOnly: true, predictionSource: path.basename(predictionPath), metrics }, null, 2));
