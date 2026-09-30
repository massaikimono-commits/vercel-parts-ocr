import assert from "node:assert/strict";
import fs from "node:fs";

const recovery = fs.readFileSync(new URL("../app/certificate-pdf-generalization-recovery.jsx", import.meta.url), "utf8");
const v2Layout = fs.readFileSync(new URL("../app/vehicle-workflow-v2/layout.tsx", import.meta.url), "utf8");
const fastLayout = fs.readFileSync(new URL("../app/vehicle-workflow-fast/layout.tsx", import.meta.url), "utf8");

assert.match(recovery, /parseTwoAxleVehicleRows/);
assert.match(recovery, /detectAxleLayout/);
assert.match(recovery, /layout !== "two-axis"/);
assert.match(recovery, /isCurrentPdfRun\(runId, "GeneralizationRecovery"\)/);
assert.match(recovery, /isPdfRunContinuation\(event\)/);
assert.match(recovery, /new CustomEvent\(AUTH_EVENT/);
assert.doesNotMatch(recovery, /5905|7010|三重|なにわ|車台番号.*===|registrationNumber.*===/);

for (const [name, source] of [["v2", v2Layout], ["fast", fastLayout]]) {
  assert.match(source, /CertificatePdfRunOwner/);
  assert.match(source, /CertificatePdfGeneralizationRecovery/);
  assert.ok(source.indexOf("<CertificatePdfRunOwner />") < source.indexOf("<CertificatePdfGeneralizationRecovery />"), `${name}: run owner must mount before generic recovery`);
  assert.ok(source.indexOf("<CertificatePdfGeneralizationRecovery />") < source.indexOf("<CertificatePdfStructuredReaderV3 />"), `${name}: generic recovery must retain PDF before V3 can clear input`);
}

console.log("PASS PDF generalization runtime integration: run-scoped, generic, V2+fast mounted");
