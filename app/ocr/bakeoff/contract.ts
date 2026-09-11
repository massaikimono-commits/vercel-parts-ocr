export const BAKEOFF_CONTRACT_VERSION = "icb.parts-ocr.bakeoff-prediction.v1" as const;

export type CandidateId = "P0" | "P1" | "P2" | "P4-L";
export type FieldKey = "name" | "qty" | "retail" | "cost";

export type NormalizedFieldPrediction = {
  raw: string;
  normalized: string;
  confidence: number | null;
  source: string;
};

export type RowPrediction = {
  rowId: string;
  region: { x: number; y: number; width: number; height: number } | null;
  fields: Record<FieldKey, NormalizedFieldPrediction>;
  confidence: number | null;
  duplicateOf: string | null;
};

export type QualityMetrics = {
  width: number;
  height: number;
  documentCoverage: number | null;
  blurScore: number | null;
  glareRatio: number | null;
  angleDeg: number | null;
  perspectiveDelta: number | null;
  accepted: boolean;
  rejectionReasons: string[];
};

export type BakeoffPrediction = {
  schema: typeof BAKEOFF_CONTRACT_VERSION;
  runId: string;
  candidateId: CandidateId;
  candidateVersion: string;
  configHash: string;
  imageId: string;
  captureId: string;
  documentFamilyPrediction: { family: string; confidence: number | null };
  documentRegions: Array<{ documentId: string | null; x: number; y: number; width: number; height: number }>;
  qualityMetrics: QualityMetrics;
  rowPredictions: RowPrediction[];
  fieldPredictions: Array<{ rowId: string; field: FieldKey; prediction: NormalizedFieldPrediction }>;
  confidence: number | null;
  abstainReason: string | null;
  manualReviewRequired: boolean;
  processingTimeMs: number;
  modelLoadTimeMs: number | null;
  memoryBytes: number | null;
  timeout: boolean;
  error: string | null;
  gtIncluded: false;
};

export function fieldsFromRows(rows: RowPrediction[]) {
  return rows.flatMap((row) => (Object.keys(row.fields) as FieldKey[]).map((field) => ({
    rowId: row.rowId,
    field,
    prediction: row.fields[field],
  })));
}

export function meanConfidence(rows: RowPrediction[]) {
  const values = rows.flatMap((row) => Object.values(row.fields).map((field) => field.confidence)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
