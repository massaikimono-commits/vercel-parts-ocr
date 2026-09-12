import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "evaluation/parts/yellow-regression-manifest.v2.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "evaluation/parts/yellow-documents.corrected.v2.json"), "utf8"));
const fields = ["name", "qty", "retail", "cost"];
const gtField = { name: "partName", qty: "qty", retail: "retail", cost: "cost" };
const ALIGNMENT_VERSION = "order-preserving-weighted-v1";

const normName = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const normNumber = (value) => String(value ?? "").normalize("NFKC").replace(/[￥¥,\s]/g, "").trim();
const normalizeField = (field, value) => field === "name" ? normName(value) : normNumber(value);
const captureByImage = new Map(manifest.captures.map((capture) => [capture.imageId, capture]));

function expectedRows(capture) {
  return capture.documentsInCapture.flatMap((relation) => fixture.documents[relation.documentId] ?? []);
}

function rowMatchWeight(gt, row) {
  if (!row) return 0;
  // Generic, predeclared identity evidence. qty alone can never align a row.
  // This is scoring-only and is not available to any runtime candidate.
  const weights = { name: 4, qty: 1, retail: 3, cost: 3 };
  let score = 0;
  for (const field of fields) {
    const predicted = normalizeField(field, row?.fields?.[field]?.normalized ?? "");
    const wanted = normalizeField(field, gt?.[gtField[field]] ?? "");
    if (predicted && wanted && predicted === wanted) score += weights[field];
  }
  return score;
}

function betterAlignment(a, b) {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (a.pairs.length !== b.pairs.length) return a.pairs.length > b.pairs.length ? a : b;
  const aKey = a.pairs.map(([i, j]) => `${String(i).padStart(3, "0")}:${String(j).padStart(3, "0")}`).join("|");
  const bKey = b.pairs.map(([i, j]) => `${String(i).padStart(3, "0")}:${String(j).padStart(3, "0")}`).join("|");
  return aKey <= bKey ? a : b;
}

export function alignRows(expected, actual) {
  const minWeight = 4; // name exact OR equivalent multi-field numeric evidence; never qty-only.
  const dp = Array.from({ length: expected.length + 1 }, () => Array(actual.length + 1));
  dp[0][0] = { score: 0, pairs: [] };
  for (let i = 0; i <= expected.length; i += 1) {
    for (let j = 0; j <= actual.length; j += 1) {
      if (i === 0 && j === 0) continue;
      let best = null;
      if (i > 0 && dp[i - 1][j]) best = dp[i - 1][j];
      if (j > 0 && dp[i][j - 1]) best = best ? betterAlignment(best, dp[i][j - 1]) : dp[i][j - 1];
      if (i > 0 && j > 0 && dp[i - 1][j - 1]) {
        const weight = rowMatchWeight(expected[i - 1], actual[j - 1]);
        if (weight >= minWeight) {
          const candidate = {
            score: dp[i - 1][j - 1].score + weight,
            pairs: [...dp[i - 1][j - 1].pairs, [i - 1, j - 1]],
          };
          best = best ? betterAlignment(best, candidate) : candidate;
        }
      }
      dp[i][j] = best ?? { score: 0, pairs: [] };
    }
  }
  return dp[expected.length][actual.length].pairs;
}

function metricSeed(candidateId) {
  return { candidateId, alignmentVersion: ALIGNMENT_VERSION, captureCount: 0, singleDocumentCaptures: 0, compositeCaptures: 0, expectedRows: 0, detectedRows: 0, matchedRows: 0, falseRows: 0, missedRows: 0, duplicateRows: 0, fields: Object.fromEntries(fields.map((field) => [field, { correct: 0, total: 0 }])), completeRows: 0, expectedCompleteRows: 0, wrongAutoConfirm: 0, abstain: 0, manualReview: 0, documentComplete: 0, documentEvaluable: 0, captureComplete: 0, timeout: 0, errors: 0, processingTimeMs: 0 };
}

function selfTest() {
  const gt = (name, qty, retail, cost) => ({ partName: name, qty, retail, cost });
  const row = (name, qty, retail, cost) => ({ fields: {
    name: { normalized: name }, qty: { normalized: qty }, retail: { normalized: retail }, cost: { normalized: cost },
  } });
  const expected = [gt("A", "1", "100", "60"), gt("B", "2", "200", "120"), gt("C", "3", "300", "180")];
  const perfect = alignRows(expected, [row("A", "1", "100", "60"), row("B", "2", "200", "120"), row("C", "3", "300", "180")]);
  const missingMiddle = alignRows(expected, [row("A", "1", "100", "60"), row("C", "3", "300", "180")]);
  const extraMiddle = alignRows(expected, [row("A", "1", "100", "60"), row("X", "9", "999", "999"), row("B", "2", "200", "120"), row("C", "3", "300", "180")]);
  const qtyOnly = alignRows([gt("A", "1", "100", "60")], [row("WRONG", "1", "999", "888")]);
  const assert = (condition, message) => { if (!condition) throw new Error(`scorer self-test failed: ${message}`); };
  assert(JSON.stringify(perfect) === JSON.stringify([[0, 0], [1, 1], [2, 2]]), "perfect alignment");
  assert(JSON.stringify(missingMiddle) === JSON.stringify([[0, 0], [2, 1]]), "missing middle row must not shift later rows");
  assert(JSON.stringify(extraMiddle) === JSON.stringify([[0, 0], [1, 2], [2, 3]]), "extra middle row must not shift later rows");
  assert(qtyOnly.length === 0, "qty-only evidence must not align a row");
  console.log(JSON.stringify({ ok: true, alignmentVersion: ALIGNMENT_VERSION, tests: 4 }, null, 2));
}

const predictionPath = process.argv[2];
if (predictionPath === "--self-test") {
  selfTest();
  process.exit(0);
}
if (!predictionPath) {
  console.error("usage: node scripts/score-parts-ocr-bakeoff-v1.mjs <prediction-export.json> | --self-test");
  process.exit(2);
}

const exported = JSON.parse(fs.readFileSync(path.resolve(predictionPath), "utf8"));
if (exported.gtIncluded !== false) throw new Error("prediction export must declare gtIncluded=false");

const aggregates = new Map();
for (const prediction of exported.results ?? []) {
  if (prediction.schema !== "icb.parts-ocr.bakeoff-prediction.v1") throw new Error(`unknown prediction schema for ${prediction.imageId}`);
  if (prediction.gtIncluded !== false) throw new Error(`GT leaked into ${prediction.candidateId}/${prediction.imageId}`);
  const capture = captureByImage.get(prediction.imageId);
  if (!capture) throw new Error(`image not in regression manifest: ${prediction.imageId}`);
  const expected = expectedRows(capture);
  const actual = prediction.rowPredictions ?? [];
  const pairs = alignRows(expected, actual);
  const actualByExpected = new Map(pairs.map(([expectedIndex, actualIndex]) => [expectedIndex, actual[actualIndex]]));
  const metric = aggregates.get(prediction.candidateId) ?? metricSeed(prediction.candidateId);
  metric.captureCount += 1;
  metric[capture.subset === "SINGLE_DOCUMENT" ? "singleDocumentCaptures" : "compositeCaptures"] += 1;
  metric.expectedRows += expected.length;
  metric.detectedRows += actual.length;
  metric.matchedRows += pairs.length;
  metric.falseRows += actual.length - pairs.length;
  metric.missedRows += expected.length - pairs.length;
  metric.duplicateRows += actual.filter((row) => row.duplicateOf).length;
  metric.expectedCompleteRows += expected.length;
  let completeRows = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const gt = expected[index];
    const row = actualByExpected.get(index);
    let complete = Boolean(row);
    for (const field of fields) {
      metric.fields[field].total += 1;
      const predicted = row?.fields?.[field]?.normalized ?? "";
      const wanted = gt[gtField[field]];
      const equal = normalizeField(field, predicted) === normalizeField(field, wanted);
      if (equal) metric.fields[field].correct += 1;
      else {
        complete = false;
        if (row && predicted && !prediction.manualReviewRequired) metric.wrongAutoConfirm += 1;
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
  rowPrecision: metric.detectedRows ? metric.matchedRows / metric.detectedRows : null,
  fourFieldCompleteRowRate: metric.expectedCompleteRows ? metric.completeRows / metric.expectedCompleteRows : null,
  fieldExact: Object.fromEntries(fields.map((field) => [field, { ...metric.fields[field], rate: metric.fields[field].total ? metric.fields[field].correct / metric.fields[field].total : null }])),
  documentCompleteRate: metric.documentEvaluable ? metric.documentComplete / metric.documentEvaluable : null,
  captureCompleteRate: metric.captureCount ? metric.captureComplete / metric.captureCount : null,
  averageProcessingTimeMs: metric.captureCount ? metric.processingTimeMs / metric.captureCount : null,
}));

console.log(JSON.stringify({ schema: "icb.parts-ocr.bakeoff-score.v1", scoringOnly: true, alignmentVersion: ALIGNMENT_VERSION, predictionSource: path.basename(predictionPath), metrics }, null, 2));
