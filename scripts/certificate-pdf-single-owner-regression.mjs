import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCertificatePdfMissingFields } from "../app/certificate-pdf-canonical-missing-field-resolver.js";
import { resolveCertificatePdfSemanticFields } from "../app/certificate-pdf-semantic-resolver.js";
import { resolveCertificatePdfWeightDisplacementFields } from "../app/certificate-pdf-weight-displacement-resolver.js";
import { commitCertificatePdfFinal, createCertificatePdfRunOwnership } from "../app/certificate-pdf-single-owner-contract.js";

function line(y, entries) {
  return { y, text: entries.map(([text]) => text).join(" "), tokens: entries.map(([text, x, w = 0.04]) => ({ text, x, y, w, h: 0.012 })) };
}

function resolve(lines, strict = {}) {
  const canonical = resolveCertificatePdfMissingFields(lines, strict).patch;
  const semantic = resolveCertificatePdfSemanticFields(lines, canonical).patch;
  return resolveCertificatePdfWeightDisplacementFields(lines, semantic).patch;
}

// Valid strict values remain locked through every pure resolver.
{
  const lines = [line(0.2, [["総排気量又は定格出力", 0.1, 0.2], ["1.99", 0.42], ["kW", 0.49]])];
  assert.equal(resolve(lines, { displacementOrRatedOutput: "1.99 L" }).displacementOrRatedOutput, "1.99 L");
}
{
  const lines = [line(0.2, [["車両重量", 0.1, 0.12], ["1690 kg", 0.25, 0.08]])];
  assert.equal(resolve(lines, { vehicleWeightKg: "1700" }).vehicleWeightKg, "1700");
}

// Known-good L values remain tied to their explicit unit by baseline geometry.
for (const value of ["1.99", "1.79", "0.65", "3.49", "4.77"]) {
  const lines = [line(0.3, [["総排気量又は定格出力", 0.1, 0.2], [value, 0.42], ["L", 0.49]]), line(0.325, [["kW", 0.49]])];
  assert.equal(resolve(lines).displacementOrRatedOutput, `${value} L`);
}

// Real kW semantics remain representable; no L or magnitude inference is used.
{
  const lines = [line(0.4, [["総排気量又は定格出力", 0.1, 0.2], ["85", 0.42], ["kW", 0.49]])];
  assert.equal(resolve(lines).displacementOrRatedOutput, "85 KW");
}

// Bracket weight semantics are preserved and axle values are excluded.
{
  const lines = [
    line(0.5, [["最大積載量", 0.05, 0.1], ["1250 [1050] kg", 0.18, 0.12], ["車両重量", 0.38, 0.09], ["1690 kg", 0.5, 0.08], ["車両総重量", 0.68, 0.1], ["3105 [3070] kg", 0.81, 0.14]]),
    line(0.56, [["前前軸重", 0.38, 0.09], ["910 kg", 0.5, 0.08]]),
  ];
  const patch = resolveCertificatePdfSemanticFields(lines, {}).patch;
  assert.equal(patch.maxPayloadKg, "1250 [1050]");
  assert.equal(patch.vehicleWeightKg, "1690");
  assert.equal(patch.grossVehicleWeightKg, "3105 [3070]");
}

// Runtime ownership: stale runs cannot commit, and the active run commits once.
{
  const ownership = createCertificatePdfRunOwnership();
  const staleRun = ownership.beginRun();
  const activeRun = ownership.beginRun();
  let pdfWrites = 0;
  let qrClears = 0;
  let authDispatches = 0;
  let lastPatch = null;
  const commit = (runId) => commitCertificatePdfFinal({ ownership, runId, patch: { registrationNumber: "なにわ 400 む 5905" }, writePdf: (patch) => { pdfWrites += 1; lastPatch = patch; }, clearQr: () => { qrClears += 1; }, dispatch: () => { authDispatches += 1; } });
  assert.equal(commit(staleRun), null);
  assert.ok(commit(activeRun));
  assert.equal(commit(activeRun), null);
  assert.equal(pdfWrites, 1);
  assert.equal(qrClears, 1);
  assert.equal(authDispatches, 1);
  assert.equal(lastPatch.__certificatePdfFinalOwner, "structured-v3");
  assert.equal(lastPatch.__certificatePdfRunId, activeRun);
}

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const structured = read("app/certificate-pdf-structured-reader-v3.jsx");
const semanticWriter = read("app/certificate-pdf-semantic-recovery.jsx");
const weightWriter = read("app/certificate-pdf-weight-displacement-recovery.jsx");
const inspectionAdapter = read("app/certificate-pdf-inspection-record-adapter.jsx");
const rowCorrector = read("app/certificate-pdf-row-corrector.jsx");
const ownerSemantics = read("app/certificate-owner-semantics.jsx");

assert.match(structured, /commitCertificatePdfFinal/);
assert.match(structured, /createCertificatePdfRunOwnership/);
assert.match(structured, /createCertificatePdfCompletionContract/);
assert.match(structured, /cancelIfInactive\(runId, diagnosticId\)/);
assert.doesNotMatch(semanticWriter, /addEventListener|dispatchEvent|PDF_PRIORITY/);
assert.doesNotMatch(weightWriter, /addEventListener|dispatchEvent|PDF_PRIORITY/);
assert.doesNotMatch(inspectionAdapter, /addEventListener|dispatchEvent|PDF_PRIORITY/);
assert.match(rowCorrector, /isCertificatePdfStructuredFinal/);
assert.match(ownerSemantics, /isCertificatePdfStructuredFinal/);

console.log("certificate PDF single authoritative owner regression: PASS");
