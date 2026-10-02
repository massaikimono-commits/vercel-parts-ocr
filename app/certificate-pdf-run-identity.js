// Interactive vehicle workflow only; bulk import owns each PDF independently.
const RUN_ID = Symbol.for("icb.certificatePdfRunId");
const CONTINUATION = Symbol.for("icb.certificatePdfRunContinuation");
let sequence = 0;
let currentRunId = 0;

export function beginPdfRun(event) {
  currentRunId = ++sequence;
  event[RUN_ID] = currentRunId;
  window.__vehicleCertificatePdfPriority = null;
  window.__vehicleCertificateQrPriority = null;
  window.__vehicleCertificatePdfRowPriority = null;
  window.__certificatePdfRunDiagnostic = { runId: currentRunId, producer: "run-owner", staleRunRejected: false };
  window.dispatchEvent(new CustomEvent("certificate-pdf-document-started", { detail: { runId: currentRunId } }));
  return currentRunId;
}

export function hasPdfRunMark(event) {
  return Boolean(event?.[RUN_ID]);
}

export function pdfRunForEvent(event) {
  return event?.[RUN_ID] || currentRunId;
}

export function isPdfRunContinuation(event) {
  return Boolean(event?.[CONTINUATION]);
}

export function markPdfRunContinuation(event, runId) {
  event[RUN_ID] = runId;
  event[CONTINUATION] = true;
  return event;
}

export function isCurrentPdfRun(runId, producer) {
  if (runId && runId === currentRunId) return true;
  if (typeof window !== "undefined") {
    window.__certificatePdfStaleRunDiagnostic = { runId, producer, staleRunRejected: true };
  }
  return false;
}
