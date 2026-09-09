export const MINIMAL_RUN_IDS = Object.freeze([
  "IMG_0940.jpeg",
  "IMG_0941.jpeg",
  "IMG_0943.jpeg",
  "IMG_0945.jpeg",
  "IMG_0946.jpeg",
  "IMG_0947.jpeg",
]);

export const EXISTING_EVIDENCE = Object.freeze({
  "0942": Object.freeze({
    source: "existing-diagnostic-evidence",
    candidateCount: 10,
    ownership: Object.freeze({ A: 3, B: 4, C: 2, D: 1 }),
    rerun: false,
  }),
  "0944": Object.freeze({
    source: "existing-diagnostic-evidence",
    candidateCount: 5,
    ownership: Object.freeze({ A: 2, B: 3, C: 0, D: 0 }),
    rerun: false,
  }),
});

function sameIds(rows) {
  return Array.isArray(rows)
    && rows.length === MINIMAL_RUN_IDS.length
    && rows.every((row, index) => row?.id === MINIMAL_RUN_IDS[index]);
}

export async function runMinimalDiagnosticBatch(rows, runner) {
  if (!sameIds(rows)) {
    throw new Error("MINIMAL_BATCH_INPUT_INVARIANT_FAIL");
  }
  if (typeof runner !== "function") {
    throw new Error("MINIMAL_RUNNER_MISSING");
  }

  const records = [];
  for (const row of rows) {
    try {
      const matrix = await runner(row.file);
      records.push({ imageId: row.id, success: true, diagnosticError: null, matrix });
    } catch (error) {
      records.push({
        imageId: row.id,
        success: false,
        diagnosticError: {
          name: String(error?.name || "Error"),
          message: String(error?.message || error || "unknown diagnostic error"),
        },
        matrix: null,
      });
    }
  }
  if (records.length !== 6) throw new Error("MINIMAL_BATCH_RESULT_RECORD_INVARIANT_FAIL");
  return records;
}

export function buildMinimalDiagnosticSummary({ evaluationHead, records, summarize }) {
  if (!Array.isArray(records) || records.length !== 6) {
    throw new Error("MINIMAL_SUMMARY_REQUIRES_SIX_RECORDS");
  }
  if (!records.every((record, index) => record?.imageId === MINIMAL_RUN_IDS[index])) {
    throw new Error("MINIMAL_SUMMARY_IMAGE_ID_INVARIANT_FAIL");
  }
  if (typeof summarize !== "function") throw new Error("MINIMAL_SUMMARIZER_MISSING");

  const perImageDiagnostics = records.map((record) => summarize(record));
  if (perImageDiagnostics.length !== 6) throw new Error("MINIMAL_SUMMARY_DIAGNOSTIC_COUNT_FAIL");

  return {
    schema: "icb-certificate-qr-minimal-diagnostic-summary-v1",
    evaluationHead: evaluationHead || null,
    selectedImageCount: 6,
    selectedImageIds: MINIMAL_RUN_IDS.map((id) => id.replace("IMG_", "").replace(".jpeg", "")),
    decodedImageCount: records.filter((record) => record.success).length,
    diagnosticErrorImageCount: records.filter((record) => !record.success).length,
    perImageDiagnostics,
    existingEvidence: EXISTING_EVIDENCE,
    formalReference: {
      finalSafeUnion: 28,
      expectedQrCount: 47,
      preserved: true,
      newFormalEvaluation: false,
    },
    isolation: {
      groundTruthScoringOnly: true,
      groundTruthUsedDuringDecode: false,
      formalDecodeLogicChanged: false,
      recognitionLogicChanged: false,
      iframeDomBridgeUsed: false,
    },
    protection: {
      frozen: "HOLD",
      production: "HOLD",
      candidateLock: "NOT EVALUATED / HOLD",
      physicalSlot: "HOLD",
      adoptedHead: null,
    },
  };
}
