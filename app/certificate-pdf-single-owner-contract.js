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
