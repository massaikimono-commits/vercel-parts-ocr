export const CERTIFICATE_PDF_FINAL_OWNER = "structured-v3";

export function isCertificatePdfStructuredFinal(detail) {
  return Boolean(detail && detail.__certificatePdfFinalOwner === CERTIFICATE_PDF_FINAL_OWNER);
}

export function createCertificatePdfRunOwnership() {
  let currentRunId = 0;
  let committedRunId = 0;
  return {
    beginRun() {
      currentRunId += 1;
      committedRunId = 0;
      return currentRunId;
    },
    isCurrent(runId) {
      return runId === currentRunId;
    },
    claimCommit(runId) {
      if (runId !== currentRunId || committedRunId === runId) return false;
      committedRunId = runId;
      return true;
    },
    invalidate() {
      currentRunId += 1;
      committedRunId = 0;
    },
  };
}

const TERMINAL_STATES = new Set(["completed", "fallback", "error", "cancelled"]);

export function createCertificatePdfCompletionContract(ownership) {
  const states = new Map();
  let currentRunId = null;

  return {
    beginRun() {
      if (currentRunId !== null && states.get(currentRunId) === "processing") {
        states.set(currentRunId, "cancelled");
      }
      currentRunId = ownership.beginRun();
      states.set(currentRunId, "processing");
      return currentRunId;
    },
    isActive(runId) {
      return ownership.isCurrent(runId) && states.get(runId) === "processing";
    },
    settle(runId, state) {
      if (!TERMINAL_STATES.has(state) || states.get(runId) !== "processing") return false;
      if (state !== "cancelled" && !ownership.isCurrent(runId)) return false;
      states.set(runId, state);
      return true;
    },
    cancel(runId) {
      return this.settle(runId, "cancelled");
    },
    state(runId) {
      return states.get(runId) || null;
    },
    invalidate() {
      const runId = currentRunId;
      const cancelled = runId !== null && this.cancel(runId);
      ownership.invalidate();
      currentRunId = null;
      return cancelled ? runId : null;
    },
  };
}

export function commitCertificatePdfFinal({ ownership, runId, patch, writePdf, clearQr, dispatch }) {
  if (!ownership.claimCommit(runId)) return null;
  const finalPatch = {
    ...patch,
    __certificatePdfFinalOwner: CERTIFICATE_PDF_FINAL_OWNER,
    __certificatePdfRunId: runId,
  };
  writePdf(finalPatch);
  clearQr();
  dispatch(finalPatch);
  return finalPatch;
}
