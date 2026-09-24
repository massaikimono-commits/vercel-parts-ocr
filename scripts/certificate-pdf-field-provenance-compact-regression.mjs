import assert from "node:assert/strict";
import { CERTIFICATE_PDF_COMPACT_FIELDS, projectCertificatePdfFieldProvenanceCompact } from "../app/certificate-pdf-field-provenance-compact.js";
import { beginCertificatePdfFieldProvenance, getCertificatePdfFieldProvenance,
  observeCertificatePdfFieldRaw, observeCertificatePdfFieldRows, observeCertificatePdfFieldStage,
  terminalCertificatePdfFieldProvenance } from "../app/certificate-pdf-field-provenance.js";

const rawItems = Array.from({ length: 1200 }, (_, index) => ({ index, str: `PDF unrelated item ${index} ${"x".repeat(24)}`,
  transformX: index, transformY: index, width: 10, height: 10 }));
const normalizedTokens = rawItems.map((item) => ({ rawIndex: item.index, text: item.str, x: item.transformX,
  y: item.transformY, w: item.width, h: item.height }));
const rows = Array.from({ length: 300 }, (_, rowId) => ({ rowId, y: rowId,
  memberRawIndexes: [rowId], lineText: `unrelated row ${rowId}` }));
const fields = Object.fromEntries(CERTIFICATE_PDF_COMPACT_FIELDS.map((field, index) => {
  const rawIndex = index + 10;
  rawItems[rawIndex].str = `label ${field}: ${index + 100} kg`;
  normalizedTokens[rawIndex].text = rawItems[rawIndex].str;
  rows[rawIndex].lineText = rawItems[rawIndex].str;
  const value = index % 4 === 0 ? null : `${index + 100} kg`;
  const provenance = { decision: { source: "anchor", locked: true,
    evidence: { label: field, candidate: value, method: "anchor-relative" } } };
  const stages = Object.fromEntries(["strict", "canonical", "semantic", "weight", "displacement", "final"]
    .map((name) => [name, { output: value, provenance }]));
  return [field, { field, section: { name: "weight-or-axle" },
    label: { found: true, text: [field], rowId: rawIndex, bounds: { x: 1, y: rawIndex, right: 10 }, tokenIndexes: [rawIndex] },
    rawItems: [rawItems[rawIndex], { index: 1300 + index, str: value || "unrecognized", transformX: 20,
      transformY: rawIndex, width: 12, height: 10 }],
    normalizedTokens: [normalizedTokens[rawIndex], { rawIndex: 1300 + index, text: value || "unrecognized",
      x: 20, y: rawIndex, w: 12, h: 10 }],
    candidates: [{ text: value, source: "canonical-selected", validatorResult: true, tokenIndexes: [1300 + index],
      dx: 10, dy: 0, rank: 1 }, { text: "rejected", source: "diagnostic-neighborhood",
      validatorResult: false, rejectReason: "geometry", dx: 12, dy: 0, rank: 2 }],
    stages, final: { finalSelectedValue: value, applyPatchValue: value, applyState: "applied",
      finalProvenance: provenance }, firstLossStage: null, failureClassification: "REQUIRES_EXPECTED_VALUE" }];
}));
fields.unrelatedName = { section: { name: "identity" }, label: { found: true }, final: { finalSelectedValue: "not-for-compact" } };
const full = { schema: "certificate-pdf-field-provenance-v1", run: 2, diagnosticId: 15, page: 1,
  rawItems, normalizedTokens, rows, fields, terminal: "completed" };
const before = structuredClone(full);
const diagnostic = { terminalState: "completed", checkpoints: [{ checkpoint: "RUN_STARTED",
  metadata: { fileFingerprint: "n12:s12345:tapplication/pdf:m0" } }] };
const compact = projectCertificatePdfFieldProvenanceCompact(full, diagnostic);
assert.ok(compact);
assert.equal(compact.schemaVersion, "certificate-pdf-field-provenance-compact-v1");
assert.equal(compact.runId, 2);
assert.equal(compact.page, 1);
assert.equal(compact.fileFingerprint, "n12:s12345:tapplication/pdf:m0");
assert.equal(compact.runState, "completed");
assert.equal(compact.parseTerminalState, "completed");
assert.match(compact.timestamp, /^\d{4}-\d\d-/);
assert.equal(compact.pdfSummary.rawItemCount, 1200);
assert.equal(compact.pdfSummary.normalizedTokenCount, 1200);
assert.equal(compact.pdfSummary.derivedRowCount, 300);
assert.equal(compact.pdfSummary.finalPatch.appliedFields, 15, "empty fields are not counted as applied values");
assert.equal(compact.fields.length, CERTIFICATE_PDF_COMPACT_FIELDS.length);
assert.ok(compact.fields.some((item) => item.field === "displacementOrRatedOutput"));
assert.ok(compact.fields.some((item) => item.field === "frontAxleWeightKg"));
assert.ok(compact.fields.some((item) => item.field === "rearAxleWeightKg"));
const vehicleWeight = compact.fields.find((item) => item.field === "vehicleWeightKg");
assert.equal(vehicleWeight.finalValue, "101 kg");
assert.equal(vehicleWeight.applyPatchValue, "101 kg");
assert.equal(vehicleWeight.finalProvenance.source, "anchor");
assert.equal(vehicleWeight.label.found, true);
assert.equal(vehicleWeight.rawMatch.found, true);
assert.equal(vehicleWeight.normalizedMatch.found, true);
assert.equal(vehicleWeight.candidateSummary.count, 2);
assert.equal(vehicleWeight.selectedCandidate.text, "101 kg");
assert.equal(vehicleWeight.nearestRejectedCandidate.rejectReason, "geometry");
assert.equal(vehicleWeight.strict.value, "101 kg");
assert.equal(vehicleWeight.canonical.provenance, "anchor");
assert.equal(vehicleWeight.semantic.value, "101 kg");
assert.equal(vehicleWeight.specialized.value, "101 kg");
assert.equal(vehicleWeight.final.value, "101 kg");
assert.equal(vehicleWeight.firstLossStage, null, "classification is not invented without expected value");
assert.equal(vehicleWeight.failureClassification, "REQUIRES_EXPECTED_VALUE");
assert.equal(compact.omittedFromCompact.fullRawItems, true);
assert.ok(compact.omittedFromCompact.otherFields.includes("unrelatedName"));
assert.equal("rawItems" in compact, false);
assert.equal("rows" in compact, false);
assert.deepEqual(full, before, "FULL TRACE remains byte-for-byte equivalent as data");
const fullSize = Buffer.byteLength(JSON.stringify(full));
const compactSize = Buffer.byteLength(JSON.stringify(compact));
const fieldSize = Buffer.byteLength(JSON.stringify({ ...compact, fields: [vehicleWeight],
  omittedFromCompact: { ...compact.omittedFromCompact,
    otherSelectedFields: compact.fields.filter((item) => item.field !== "vehicleWeightKg").map((item) => item.field) } }));
assert.ok(fullSize > 100000);
assert.ok(compactSize < 32000, `compact trace should be pasteable: ${compactSize} bytes`);
assert.ok(fieldSize < 5000, `one-field fallback should be pasteable: ${fieldSize} bytes`);
assert.ok(compactSize < fullSize / 5);
assert.equal(projectCertificatePdfFieldProvenanceCompact({ fields: { vehicleWeightKg: { get label() { throw Error("observer failure"); } } } }), null);

beginCertificatePdfFieldProvenance(45, 1);
observeCertificatePdfFieldRaw(45, 1, [{ str: "車両重量", transform: [1, 0, 0, 1, 1, 1], width: 1, height: 1 }],
  [{ text: "車両重量", x: 1, y: 1, w: 1, h: 1 }]);
observeCertificatePdfFieldRows(45, [{ y: 1, text: "車両重量", tokens: [{ text: "車両重量", x: 1, y: 1, w: 1, h: 1 }] }]);
observeCertificatePdfFieldStage(45, "strict", {}, {}, {}, {});
terminalCertificatePdfFieldProvenance(45, "fallback");
const observed = getCertificatePdfFieldProvenance(45);
assert.ok(projectCertificatePdfFieldProvenanceCompact(observed));
assert.deepEqual(getCertificatePdfFieldProvenance(45), observed, "projection cannot write observer or business state");
console.log(`certificate PDF compact provenance regression: PASS (full ${fullSize} bytes, compact ${compactSize} bytes, field ${fieldSize} bytes)`);
