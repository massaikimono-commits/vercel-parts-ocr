export const LIVE_UNKNOWN_SAFE_CONTRACT_SCHEMA = "icb-certificate-qr-live-unknown-safe-contract-v1";

function finiteInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "")).filter(Boolean))];
}

export function evaluateUnknownSafeCandidate(candidate = {}) {
  const parserSchemaRecognized = Boolean(candidate.parserSchemaRecognized);
  const decodeIntegrityPass = Boolean(candidate.decodeIntegrityPass);
  const frameHitCount = finiteInt(candidate.frameHitCount);
  const bothEngineFrameCount = finiteInt(candidate.bothEngineFrameCount);
  const repeatedFrameSupport = frameHitCount >= 2;
  const bothEngineAgreementSupport = bothEngineFrameCount >= 1;
  const positionClusterCount = finiteInt(candidate.positionClusterCount);
  const hasPositionEvidence = positionClusterCount >= 1;

  const rejectReasons = [];
  if (parserSchemaRecognized) rejectReasons.push("recognized-schema-not-unknown-safe");
  if (!decodeIntegrityPass) rejectReasons.push("decode-integrity-fail");
  if (!repeatedFrameSupport) rejectReasons.push("insufficient-repeated-frame-support");
  if (!bothEngineAgreementSupport) rejectReasons.push("missing-both-engine-agreement");
  if (!hasPositionEvidence) rejectReasons.push("missing-position-evidence");

  return {
    diagnosticId: candidate.diagnosticId || null,
    parserSchemaClass: candidate.parserSchemaClass || "unrecognized-safe",
    eligible: rejectReasons.length === 0,
    rejectReasons,
    evidence: {
      decodeIntegrityPass,
      repeatedFrameSupport,
      bothEngineAgreementSupport,
      hasPositionEvidence,
      frameHitCount,
      bothEngineFrameCount,
      positionClusterCount,
    },
  };
}

export function evaluateUnknownSafeCompletion(input = {}) {
  const expectedQrCount = Number.isInteger(input.expectedQrCount) && input.expectedQrCount > 0
    ? input.expectedQrCount
    : null;
  const kind = input.kind === "kei" || input.kind === "registered" ? input.kind : null;
  const recognizedConfirmedCount = finiteInt(input.recognizedConfirmedCount);
  const currentConfirmedCount = finiteInt(input.currentConfirmedCount);
  const rawCandidates = Array.isArray(input.candidates) ? input.candidates : [];

  const seenDiagnosticIds = new Set();
  const duplicateDiagnosticIds = [];
  const candidateResults = [];
  for (const candidate of rawCandidates) {
    const id = String(candidate?.diagnosticId || "");
    if (id && seenDiagnosticIds.has(id)) {
      duplicateDiagnosticIds.push(id);
      continue;
    }
    if (id) seenDiagnosticIds.add(id);
    candidateResults.push(evaluateUnknownSafeCandidate(candidate));
  }

  const eligibleUnknownSafe = candidateResults.filter((candidate) => candidate.eligible);
  const totalCandidateConfirmed = recognizedConfirmedCount + eligibleUnknownSafe.length;
  const kindAndExpectedKnown = Boolean(kind) && expectedQrCount != null;
  const overflow = expectedQrCount != null && totalCandidateConfirmed > expectedQrCount;
  const underflow = expectedQrCount != null && totalCandidateConfirmed < expectedQrCount;
  const exactExpected = expectedQrCount != null && totalCandidateConfirmed === expectedQrCount;
  const duplicateIntegrityPass = duplicateDiagnosticIds.length === 0;
  const currentRegression = currentConfirmedCount > recognizedConfirmedCount;

  const completionEligible =
    kindAndExpectedKnown &&
    duplicateIntegrityPass &&
    !currentRegression &&
    exactExpected;

  const holdReasons = [];
  if (!kindAndExpectedKnown) holdReasons.push("recognized-kind-or-expected-count-unknown");
  if (!duplicateIntegrityPass) holdReasons.push("duplicate-diagnostic-id");
  if (currentRegression) holdReasons.push("current-confirmed-regression");
  if (overflow) holdReasons.push("confirmed-count-overflow");
  if (underflow) holdReasons.push("confirmed-count-underflow");

  return {
    schema: LIVE_UNKNOWN_SAFE_CONTRACT_SCHEMA,
    diagnosticOnly: true,
    runtimeChanged: false,
    parserChanged: false,
    decoderChanged: false,
    completionChanged: false,
    gtUsedInRuntimeOrControl: false,
    payloadIncluded: false,
    unknownSafeMayInferKind: false,
    unknownSafeMaySetExpectedQrCount: false,
    strictUnknownSafeAdmission: {
      requiresDecodeIntegrityPass: true,
      requiresRepeatedFrameSupport: true,
      requiresBothEngineAgreement: true,
      requiresPositionEvidence: true,
    },
    completionPolicyCounterfactual: {
      expectedCountSource: "recognized-schema-only",
      exactExpectedCountRequired: true,
      overflowFailsClosed: true,
      underflowIncomplete: true,
    },
    kind,
    expectedQrCount,
    currentConfirmedCount,
    recognizedConfirmedCount,
    unknownSafeCandidateCount: candidateResults.length,
    eligibleUnknownSafeCount: eligibleUnknownSafe.length,
    eligibleUnknownSafeDiagnosticIds: uniqueStrings(eligibleUnknownSafe.map((candidate) => candidate.diagnosticId)),
    totalCandidateConfirmed,
    duplicateDiagnosticIds: uniqueStrings(duplicateDiagnosticIds),
    duplicateIntegrityPass,
    currentRegression,
    overflow,
    underflow,
    exactExpected,
    completionEligible,
    holdReasons,
    candidateResults,
  };
}
