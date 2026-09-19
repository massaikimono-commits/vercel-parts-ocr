import assert from "node:assert/strict";
import { resolveCertificatePdfMissingFields } from "../app/certificate-pdf-canonical-missing-field-resolver.js";

function line(y, entries) {
  return {
    y,
    text: entries.map(([text]) => text).join(" "),
    tokens: entries.map(([text, x, w = 0.04]) => ({ text, x, y, w, h: 0.012 })),
  };
}

// Regression lock: strict values are immutable, even when nearby candidates differ.
{
  const lines = [
    line(0.2, [["総排気量又は定格出力", 0.2, 0.18], ["1.99", 0.5], ["kW", 0.57]]),
    line(0.3, [["車両重量", 0.2, 0.08], ["9999 kg", 0.35]]),
  ];
  const strict = { displacementOrRatedOutput: "1.99 L", vehicleWeightKg: "1250" };
  const result = resolveCertificatePdfMissingFields(lines, strict);
  assert.equal(result.patch.displacementOrRatedOutput, "1.99 L");
  assert.equal(result.patch.vehicleWeightKg, "1250");
  assert.equal(result.provenance.displacementOrRatedOutput.source, "strict");
  assert.equal(result.provenance.displacementOrRatedOutput.locked, true);
}

// Generalization: independent labels need not share one reconstructed header line.
{
  const lines = [
    line(0.10, [["車台番号", 0.10, 0.08], ["PE52-000952", 0.28, 0.10]]),
    line(0.18, [["型式", 0.10, 0.05], ["DBA-PE52", 0.28, 0.09]]),
    line(0.26, [["原動機の型式", 0.10, 0.10], ["VQ35", 0.28, 0.06]]),
    line(0.34, [["車両重量", 0.10, 0.08], ["2020 kg", 0.28, 0.08]]),
    line(0.42, [["車両総重量", 0.10, 0.10], ["2405 kg", 0.28, 0.08]]),
  ];
  const result = resolveCertificatePdfMissingFields(lines, {});
  assert.equal(result.patch.chassisNumber, "PE52-000952");
  assert.equal(result.patch.model, "DBA-PE52");
  assert.equal(result.patch.engineModel, "VQ35");
  assert.equal(result.patch.vehicleWeightKg, "2020");
  assert.equal(result.patch.grossVehicleWeightKg, "2405");
}

// Unit semantics: bind a split numeric/unit pair by baseline affinity, not fuel or value heuristics.
{
  const lines = [
    line(0.50, [["総排気量又は定格出力", 0.10, 0.18], ["1.99", 0.40, 0.05], ["L", 0.47, 0.02]]),
    line(0.53, [["kW", 0.47, 0.02]]),
  ];
  const result = resolveCertificatePdfMissingFields(lines, {});
  assert.equal(result.patch.displacementOrRatedOutput, "1.99 L");
  assert.equal(result.provenance.displacementOrRatedOutput.evidence.method, "baseline-affinity-split-token");
}

// Real kW remains representable; the resolver does not force L.
{
  const lines = [line(0.60, [["総排気量又は定格出力", 0.10, 0.18], ["85", 0.40], ["kW", 0.46]])];
  const result = resolveCertificatePdfMissingFields(lines, {});
  assert.equal(result.patch.displacementOrRatedOutput, "85 KW");
}

// No identity-specific inference: unlabeled values must not be harvested.
{
  const lines = [line(0.70, [["PE52-000952", 0.20], ["2020 kg", 0.40], ["3.49", 0.55], ["L", 0.60]])];
  const result = resolveCertificatePdfMissingFields(lines, {});
  assert.equal(result.patch.chassisNumber, undefined);
  assert.equal(result.patch.vehicleWeightKg, undefined);
  assert.equal(result.patch.displacementOrRatedOutput, undefined);
}

console.log("certificate PDF canonical resolver regression: PASS");
