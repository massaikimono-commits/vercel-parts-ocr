import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCertificatePdfMissingFields } from "../app/certificate-pdf-canonical-missing-field-resolver.js";
import { resolveCertificatePdfSemanticFields } from "../app/certificate-pdf-semantic-resolver.js";
import { resolveCertificatePdfWeightDisplacementFields } from "../app/certificate-pdf-weight-displacement-resolver.js";
import { createCertificatePdfCompletionContract, createCertificatePdfRunOwnership } from "../app/certificate-pdf-single-owner-contract.js";
import {
  beginCertificatePdfFieldProvenance, classifyCertificatePdfFieldTrace,
  getCertificatePdfFieldProvenance, isCertificatePdfFieldProvenanceEnabled,
  observeCertificatePdfFieldApply, observeCertificatePdfFieldRaw,
  observeCertificatePdfFieldRows, observeCertificatePdfFieldStage,
  terminalCertificatePdfFieldProvenance,
} from "../app/certificate-pdf-field-provenance.js";

const source = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");
const inspectionSource = fs.readFileSync(new URL("../app/certificate-pdf-inspection-record-adapter.jsx", import.meta.url), "utf8");
const { isCertificateInspectionRecord, parseCertificateInspectionRecordLines } = new Function(
  `${inspectionSource.replaceAll("export default ", "").replaceAll("export ", "")}; return { isCertificateInspectionRecord, parseCertificateInspectionRecordLines };`
)();
const parserSource = source.slice(source.indexOf("const MAKERS ="), source.indexOf("async function loadPdfJs()"));
assert.ok(parserSource.startsWith("const MAKERS"));
const { tokenFromItem, buildLines, parseStructured } = new Function(
  "resolveCertificatePdfMissingFields", "resolveCertificatePdfSemanticFields",
  "resolveCertificatePdfWeightDisplacementFields", "isCertificateInspectionRecord",
  "parseCertificateInspectionRecordLines", `${parserSource}; return { tokenFromItem, buildLines, parseStructured };`
)(resolveCertificatePdfMissingFields, resolveCertificatePdfSemanticFields,
  resolveCertificatePdfWeightDisplacementFields, isCertificateInspectionRecord, parseCertificateInspectionRecordLines);
const pageTokensSource = source.slice(source.indexOf("async function pageTokens(page, observeContent = null)"), source.indexOf("async function choosePage"));
const pageTokens = new Function("tokenFromItem", `${pageTokensSource}; return pageTokens;`)(tokenFromItem);

const rawItems = [
  ["車両重量", 100, 900], ["1250 kg", 300, 900],
  ["車両総重量", 100, 875], ["1760 kg", 300, 875],
  ["総排気量又は定格出力", 100, 850], ["1.79", 330, 850], ["L", 400, 850],
  ["所有者の氏名又は名称", 100, 825], ["架空所有者", 350, 825],
].map(([str, x, y]) => ({ str, transform: [1, 0, 0, 14, x, y], width: 100, height: 14,
  fontName: "fixture-font", hasEOL: false }));
const tokens = rawItems.map((item) => tokenFromItem(item, 1000, 1000)).filter(Boolean);
let textReads = 0;
const page = { getViewport: () => ({ width: 1000, height: 1000 }), getTextContent: async () => {
  textReads++;
  return { items: rawItems };
} };
assert.deepEqual(await pageTokens(page), tokens);
assert.deepEqual(await pageTokens(page, () => { throw Error("observer failure"); }), tokens);
assert.equal(textReads, 2, "OFF and ON each perform exactly one getTextContent");
const lines = buildLines(tokens);
const untouchedRaw = structuredClone(rawItems), untouchedTokens = structuredClone(tokens), untouchedLines = structuredClone(lines);
const off = parseStructured(lines);
const offOwnership = createCertificatePdfRunOwnership();
const offCompletion = createCertificatePdfCompletionContract(offOwnership);
const offRun = offCompletion.beginRun();
assert.equal(offCompletion.settle(offRun, off.strong ? "completed" : "fallback"), true);

const diagId = 123, onOwnership = createCertificatePdfRunOwnership();
const onCompletion = createCertificatePdfCompletionContract(onOwnership);
const onRun = onCompletion.beginRun();
beginCertificatePdfFieldProvenance(diagId, onRun);
observeCertificatePdfFieldRaw(diagId, 1, rawItems, tokens);
observeCertificatePdfFieldRows(diagId, lines);
const on = parseStructured(lines, (stage, input, candidate, output, provenance) =>
  observeCertificatePdfFieldStage(diagId, stage, input, candidate, output, provenance));
const onState = on.strong ? "completed" : "fallback";
assert.equal(onCompletion.settle(onRun, onState), true);
observeCertificatePdfFieldApply(diagId, on.patch, on.strong);
terminalCertificatePdfFieldProvenance(diagId, onState);

assert.deepEqual(on, off, "parseStructured and all resolver results match OFF vs ON");
assert.deepEqual(on.patch, off.patch, "FINAL selected fields and applyPatch input match");
assert.equal(on.strong, off.strong, "fallback decision matches");
assert.equal(onRun, offRun, "beginRun count and ID match");
assert.equal(onCompletion.state(onRun), offCompletion.state(offRun), "terminal state matches");
assert.deepEqual(rawItems, untouchedRaw);
assert.deepEqual(tokens, untouchedTokens);
assert.deepEqual(lines, untouchedLines);
const failedObserver = parseStructured(lines, () => { throw new Error("observer failure"); });
assert.deepEqual(failedObserver, off, "observer failure cannot affect PDF parsing");
assert.doesNotThrow(() => observeCertificatePdfFieldRaw(diagId, 1, [{ get str() { throw Error("broken observation"); } }], tokens));
assert.deepEqual(parseStructured(lines), off);

const snapshot = getCertificatePdfFieldProvenance(diagId);
assert.equal(snapshot.schema, "certificate-pdf-field-provenance-v1");
assert.ok(snapshot.classificationOptions.includes("UNIT_ASSOCIATION_FAILURE"));
assert.ok(snapshot.classificationOptions.includes("RANKING_WRONG"));
assert.equal(snapshot.page, 1);
assert.equal(snapshot.rawItems[5].str, "1.79");
assert.equal(snapshot.normalizedTokens[5].rawIndex, 5);
assert.ok(snapshot.rows.find((row) => row.lineText.includes("車両重量")));
assert.equal(snapshot.fields.vehicleWeightKg.label.found, true);
assert.ok(snapshot.fields.vehicleWeightKg.candidates.length);
assert.ok(snapshot.fields.vehicleWeightKg.candidates.some((item) => item.source === "weight-resolver-ranked"));
assert.equal(snapshot.fields.vehicleWeightKg.final.finalSelectedValue, on.patch.vehicleWeightKg ?? null);
assert.equal(snapshot.fields.vehicleWeightKg.final.applyState, "not-applied");
for (const stage of ["strict", "canonical", "semantic", "weight", "displacement", "final"]) {
  assert.ok(snapshot.fields.displacementOrRatedOutput.stages[stage], `${stage} stage exists`);
}
assert.equal(classifyCertificatePdfFieldTrace(snapshot.fields.vehicleWeightKg, "9999", snapshot).failureClassification, "RAW_ABSENT");
assert.equal(classifyCertificatePdfFieldTrace(snapshot.fields.vehicleWeightKg, "1250", snapshot).failureClassification, "PATCH_LOSS");
const copy = getCertificatePdfFieldProvenance(diagId);
copy.fields.vehicleWeightKg.final.finalSelectedValue = "changed-in-copy";
assert.notEqual(getCertificatePdfFieldProvenance(diagId).fields.vehicleWeightKg.final.finalSelectedValue, "changed-in-copy");
beginCertificatePdfFieldProvenance(124, 2);
observeCertificatePdfFieldRows(diagId, lines);
assert.equal(getCertificatePdfFieldProvenance(124).run, 2);
assert.equal(getCertificatePdfFieldProvenance(diagId), null, "new run does not expose prior data");

assert.equal(isCertificatePdfFieldProvenanceEnabled({ hostname: "preview.vercel.app", search: "?certificatePdfProvenance=1" }), true);
assert.equal(isCertificatePdfFieldProvenanceEnabled({ hostname: "preview.vercel.app", search: "" }), false);
assert.equal(isCertificatePdfFieldProvenanceEnabled({ hostname: "icb-vehicle-app.netlify.app", search: "?certificatePdfProvenance=1" }), false);
assert.match(source, /data-pdf-structured-v3-field-provenance/);
assert.match(source, /FIELD_PROVENANCE_READY/);
const observerSource = fs.readFileSync(new URL("../app/certificate-pdf-field-provenance.js", import.meta.url), "utf8");
for (const forbidden of ["dispatchEvent", "AUTH_EVENT", "PDF_PRIORITY", "QR_PRIORITY", "localStorage", "supabase", "fetch(", "Promise.race", "setTimeout", "renderTask.cancel"]) {
  assert.equal(observerSource.includes(forbidden), false, `observer cannot write business state: ${forbidden}`);
}
console.log("certificate PDF field provenance non-interference regression: PASS");
