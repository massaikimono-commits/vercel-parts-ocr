import { BAKEOFF_CONTRACT_VERSION, fieldsFromRows, meanConfidence, type BakeoffPrediction, type FieldKey, type RowPrediction } from "./contract";

const FIELDS: FieldKey[] = ["name", "qty", "retail", "cost"];
const LOW_CONFIDENCE = 0.78;

export function validateRows(rows: RowPrediction[]) {
  const reasons: string[] = [];
  const seen = new Map<string, string>();
  for (const row of rows) {
    const values = FIELDS.map((field) => row.fields[field].normalized);
    if (row.fields.qty.normalized && !/^\d+$/.test(row.fields.qty.normalized)) reasons.push(`${row.rowId}:qty-nonnumeric`);
    for (const field of ["retail", "cost"] as const) if (row.fields[field].normalized && !/^\d+$/.test(row.fields[field].normalized)) reasons.push(`${row.rowId}:${field}-invalid`);
    if (!row.fields.name.normalized && values.slice(1).some(Boolean)) reasons.push(`${row.rowId}:name-blank`);
    if (Object.values(row.fields).some((field) => field.confidence !== null && field.confidence < LOW_CONFIDENCE)) reasons.push(`${row.rowId}:low-confidence`);
    const signature = values.join("|");
    if (signature.replace(/\|/g, "")) {
      const duplicate = seen.get(signature);
      if (duplicate) reasons.push(`${row.rowId}:duplicate-of:${duplicate}`);
      else seen.set(signature, row.rowId);
    }
  }
  return [...new Set(reasons)];
}

export function buildLocalHybrid(p1: BakeoffPrediction, p2: BakeoffPrediction): BakeoffPrediction {
  const started = performance.now();
  const disagreement = p1.rowPredictions.length !== p2.rowPredictions.length || p1.rowPredictions.some((row, index) => {
    const other = p2.rowPredictions[index];
    return !other || FIELDS.some((field) => row.fields[field].normalized !== other.fields[field].normalized);
  });
  const p1Reasons = validateRows(p1.rowPredictions);
  const p2Reasons = validateRows(p2.rowPredictions);
  const p1Score = p1Reasons.length + (p1.error ? 100 : 0);
  const p2Score = p2Reasons.length + (p2.error ? 100 : 0);
  const selected = p1Score <= p2Score ? p1 : p2;
  const reasons = [...validateRows(selected.rowPredictions)];
  if (disagreement) reasons.push("candidate-disagreement");
  if (!selected.qualityMetrics.accepted) reasons.push(...selected.qualityMetrics.rejectionReasons.map((reason) => `quality:${reason}`));
  if (p1.error && p2.error) reasons.push("all-candidates-error");
  return {
    ...selected,
    schema: BAKEOFF_CONTRACT_VERSION,
    candidateId: "P4-L",
    candidateVersion: "p4-local-deterministic.v1",
    configHash: "sha256:09e18d5dca401bf64ec8393e87f948a64f35d608d05e16b3deca41345f477e86",
    rowPredictions: selected.rowPredictions,
    fieldPredictions: fieldsFromRows(selected.rowPredictions),
    confidence: meanConfidence(selected.rowPredictions),
    abstainReason: reasons.length ? reasons.join(";") : null,
    manualReviewRequired: reasons.length > 0,
    processingTimeMs: p1.processingTimeMs + p2.processingTimeMs + Math.round(performance.now() - started),
    modelLoadTimeMs: (p1.modelLoadTimeMs ?? 0) + (p2.modelLoadTimeMs ?? 0),
    timeout: p1.timeout && p2.timeout,
    error: p1.error && p2.error ? "P1 and P2 unavailable" : null,
    gtIncluded: false,
  };
}
