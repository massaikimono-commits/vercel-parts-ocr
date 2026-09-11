import { BAKEOFF_CONTRACT_VERSION, fieldsFromRows, meanConfidence, type BakeoffPrediction, type QualityMetrics, type RowPrediction } from "./contract";

export type FrozenControlOutput = {
  rows: RowPrediction[];
  processingTimeMs: number;
  modelLoadTimeMs?: number | null;
  error?: string | null;
};

export function adaptFrozenControl(input: {
  runId: string;
  imageId: string;
  captureId: string;
  qualityMetrics: QualityMetrics;
  control: FrozenControlOutput;
}): BakeoffPrediction {
  const reasons = input.qualityMetrics.accepted ? [] : input.qualityMetrics.rejectionReasons.map((reason) => `quality:${reason}`);
  if (input.control.error) reasons.push("control-error");
  return {
    schema: BAKEOFF_CONTRACT_VERSION,
    runId: input.runId,
    candidateId: "P0",
    candidateVersion: "frozen-control-adapter.v1",
    configHash: "sha256:7c6a9fe4180c6dc695f0dd170458f8f94ec8f94d1374938c868d48531c12ae73",
    imageId: input.imageId,
    captureId: input.captureId,
    documentFamilyPrediction: { family: "legacy-control", confidence: null },
    documentRegions: [],
    qualityMetrics: input.qualityMetrics,
    rowPredictions: input.control.rows,
    fieldPredictions: fieldsFromRows(input.control.rows),
    confidence: meanConfidence(input.control.rows),
    abstainReason: reasons.length ? reasons.join(";") : null,
    manualReviewRequired: reasons.length > 0,
    processingTimeMs: input.control.processingTimeMs,
    modelLoadTimeMs: input.control.modelLoadTimeMs ?? null,
    memoryBytes: null,
    timeout: false,
    error: input.control.error ?? null,
    gtIncluded: false,
  };
}
