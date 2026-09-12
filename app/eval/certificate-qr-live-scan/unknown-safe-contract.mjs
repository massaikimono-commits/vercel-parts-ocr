import assert from "node:assert/strict";
import {
  LIVE_UNKNOWN_SAFE_CONTRACT_SCHEMA,
  evaluateUnknownSafeCandidate,
  evaluateUnknownSafeCompletion,
} from "../app/eval/certificate-qr-live-scan/unknown-safe-contract.mjs";

function unknown(overrides = {}) {
  return {
    diagnosticId: "raw-05",
    parserSchemaRecognized: false,
    parserSchemaClass: "unrecognized-safe",
    decodeIntegrityPass: true,
    frameHitCount: 26,
    bothEngineFrameCount: 11,
    positionClusterCount: 2,
    ...overrides,
  };
}

{
  const result = evaluateUnknownSafeCandidate(unknown());
  assert.equal(result.eligible, true);
  assert.deepEqual(result.rejectReasons, []);
}

{
  const result = evaluateUnknownSafeCandidate(unknown({ bothEngineFrameCount: 0 }));
  assert.equal(result.eligible, false);
  assert(result.rejectReasons.includes("missing-both-engine-agreement"));
}

{
  const result = evaluateUnknownSafeCandidate(unknown({ frameHitCount: 1 }));
  assert.equal(result.eligible, false);
  assert(result.rejectReasons.includes("insufficient-repeated-frame-support"));
}

{
  const result = evaluateUnknownSafeCandidate(unknown({ positionClusterCount: 0 }));
  assert.equal(result.eligible, false);
  assert(result.rejectReasons.includes("missing-position-evidence"));
}

{
  const result = evaluateUnknownSafeCompletion({
    kind: "kei",
    expectedQrCount: 6,
    currentConfirmedCount: 5,
    recognizedConfirmedCount: 5,
    candidates: [unknown()],
  });
  assert.equal(result.schema, LIVE_UNKNOWN_SAFE_CONTRACT_SCHEMA);
  assert.equal(result.completionEligible, true);
  assert.equal(result.totalCandidateConfirmed, 6);
  assert.equal(result.eligibleUnknownSafeCount, 1);
  assert.equal(result.unknownSafeMayInferKind, false);
  assert.equal(result.unknownSafeMaySetExpectedQrCount, false);
}

{
  const result = evaluateUnknownSafeCompletion({
    kind: "kei",
    expectedQrCount: 6,
    currentConfirmedCount: 5,
    recognizedConfirmedCount: 5,
    candidates: [unknown({ diagnosticId: "raw-05" }), unknown({ diagnosticId: "raw-06" })],
  });
  assert.equal(result.completionEligible, false);
  assert.equal(result.overflow, true);
  assert(result.holdReasons.includes("confirmed-count-overflow"));
}

{
  const result = evaluateUnknownSafeCompletion({
    kind: null,
    expectedQrCount: null,
    currentConfirmedCount: 0,
    recognizedConfirmedCount: 0,
    candidates: [unknown()],
  });
  assert.equal(result.completionEligible, false);
  assert(result.holdReasons.includes("recognized-kind-or-expected-count-unknown"));
}

{
  const result = evaluateUnknownSafeCompletion({
    kind: "registered",
    expectedQrCount: 5,
    currentConfirmedCount: 5,
    recognizedConfirmedCount: 5,
    candidates: [],
  });
  assert.equal(result.completionEligible, true);
  assert.equal(result.exactExpected, true);
}

{
  const result = evaluateUnknownSafeCompletion({
    kind: "kei",
    expectedQrCount: 6,
    currentConfirmedCount: 5,
    recognizedConfirmedCount: 5,
    candidates: [unknown(), unknown()],
  });
  assert.equal(result.completionEligible, false);
  assert.equal(result.duplicateIntegrityPass, false);
  assert(result.holdReasons.includes("duplicate-diagnostic-id"));
}

{
  const result = evaluateUnknownSafeCompletion({
    kind: "kei",
    expectedQrCount: 6,
    currentConfirmedCount: 6,
    recognizedConfirmedCount: 5,
    candidates: [unknown()],
  });
  assert.equal(result.completionEligible, false);
  assert.equal(result.currentRegression, true);
  assert(result.holdReasons.includes("current-confirmed-regression"));
}

console.log("Live unknown-safe contract tests passed.");
