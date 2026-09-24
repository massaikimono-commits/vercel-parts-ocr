import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCertificatePdfGenericStructuralFields } from "../app/certificate-pdf-generic-structural-resolver.js";
import { resolveCertificatePdfMissingFields } from "../app/certificate-pdf-canonical-missing-field-resolver.js";
import { resolveCertificatePdfSemanticFields } from "../app/certificate-pdf-semantic-resolver.js";
import { resolveCertificatePdfWeightDisplacementFields } from "../app/certificate-pdf-weight-displacement-resolver.js";

const reader = readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../app/certificate-pdf-inspection-record-adapter.jsx", import.meta.url), "utf8");
const { isCertificateInspectionRecord, parseCertificateInspectionRecordLines } = new Function(
  `${adapter.replaceAll("export default ", "").replaceAll("export ", "")}; return { isCertificateInspectionRecord, parseCertificateInspectionRecordLines };`
)();
const parserSource = reader.slice(reader.indexOf("const MAKERS ="), reader.indexOf("async function loadPdfJs()"));
const parseStructured = new Function(
  "resolveCertificatePdfMissingFields", "resolveCertificatePdfGenericStructuralFields",
  "resolveCertificatePdfSemanticFields", "resolveCertificatePdfWeightDisplacementFields",
  "isCertificateInspectionRecord", "parseCertificateInspectionRecordLines",
  `${parserSource}; return parseStructured;`
)(resolveCertificatePdfMissingFields, resolveCertificatePdfGenericStructuralFields,
  resolveCertificatePdfSemanticFields, resolveCertificatePdfWeightDisplacementFields,
  isCertificateInspectionRecord, parseCertificateInspectionRecordLines);
assert.match(reader, /import \{ resolveCertificatePdfGenericStructuralFields \} from "\.\/certificate-pdf-generic-structural-resolver"/);
assert.match(reader, /const generic = resolveCertificatePdfGenericStructuralFields\(lines, patch\);\s*Object\.assign\(patch, generic\.patch\);\s*const recovered = resolveCertificatePdfMissingFields\(lines, patch\)/);
assert.match(reader, /\.\.\.generic\.provenance, \.\.\.recovered\.provenance/);

function row(y, cells) {
  const tokens = cells.map(([text, x, w = .045]) => ({ text, x, y, w, h: .01 }));
  return { y, text: tokens.map(({ text }) => text).join(" "), tokens };
}

const vehicleLabels = [
  ["最大積載量", .07, .085], ["車両重量", .23, .075], ["車両総重量", .38, .09],
  ["長さ", .55, .04], ["幅", .68, .03], ["高さ", .80, .04],
];
const vehicleValues = [
  ["-", .09], ["1050 kg", .25, .08], ["1330 kg", .41, .08],
  ["339 cm", .56, .07], ["147 cm", .68, .07], ["178 cm", .80, .07],
];
const lines = [row(.20, vehicleLabels), row(.22, vehicleValues),
  row(.30, [["前軸重", .11, .06], ["後軸重", .40, .06]]),
  row(.32, [["570 kg", .11, .07], ["480 kg", .40, .07]]),
  row(.40, [["所有者の氏名又は名称", .10, .15], ["甲", .29]]),
  row(.42, [["使用者の氏名又は名称", .10, .15], ["乙", .29]]),
  row(.44, [["4.備考", .10, .07], ["区分外の文字", .29, .12]]),
];
const generic = resolveCertificatePdfGenericStructuralFields(lines, {});
assert.equal(generic.patch.maxPayloadKg, "", "explicit empty payload is canonicalized to an empty form value");
assert.equal(generic.patch.lengthCm, "339");
assert.equal(generic.patch.vehicleWeightKg, "1050");
assert.equal(generic.patch.grossVehicleWeightKg, "1330");
assert.equal(generic.patch.widthCm, "147");
assert.equal(generic.patch.heightCm, "178");
assert.equal(generic.patch.frontFrontAxleWeightKg, "570");
assert.equal(generic.patch.rearRearAxleWeightKg, "480");
assert.equal(generic.patch.frontRearAxleWeightKg, undefined);
assert.equal(generic.patch.rearFrontAxleWeightKg, undefined);
assert.equal(generic.patch.ownerName, "甲");
assert.equal(generic.patch.userName, "乙");
assert.ok(!String(generic.patch.userName).includes("備考"), "identity section boundary");
assert.equal(generic.provenance.lengthCm.source, "generic-structural");
assert.equal(generic.provenance.maxPayloadKg.explicitEmpty, true);

// A syntactically valid but structurally cross-owned value must not defeat a complete sequence.
const contaminated = resolveCertificatePdfGenericStructuralFields(lines, {
  maxPayloadKg: "339", vehicleWeightKg: "650", grossVehicleWeightKg: "650",
  lengthCm: "570", widthCm: "570", heightCm: "570",
  frontFrontAxleWeightKg: "339", rearRearAxleWeightKg: "339",
});
assert.equal(contaminated.patch.maxPayloadKg, "");
assert.equal(contaminated.patch.vehicleWeightKg, "1050");
assert.equal(contaminated.patch.grossVehicleWeightKg, "1330");
assert.equal(contaminated.patch.lengthCm, "339");
assert.equal(contaminated.patch.widthCm, "147");
assert.equal(contaminated.patch.heightCm, "178");
assert.equal(contaminated.patch.frontFrontAxleWeightKg, "570");
assert.equal(contaminated.patch.rearRearAxleWeightKg, "480");
assert.equal(contaminated.provenance.grossVehicleWeightKg.ownership, "sequence-slot");

// The real integration order runs structural ownership before the existing resolvers.
let patch = { ...generic.patch };
for (const resolver of [resolveCertificatePdfMissingFields, resolveCertificatePdfSemanticFields, resolveCertificatePdfWeightDisplacementFields]) {
  patch = resolver(lines, patch).patch;
}
assert.equal(patch.maxPayloadKg, "", "explicit payload dash must remain empty and never become a following dimension");
assert.equal(patch.lengthCm, "339");
const integrated = parseStructured(lines).patch;
assert.equal(integrated.maxPayloadKg, "", "runtime V3: explicit empty slot cannot become a following dimension");
assert.equal(integrated.lengthCm, "339", "runtime V3: dimension is retained");

// Complete structural ownership may replace a valid-looking but conflicting value.
const corrected = resolveCertificatePdfGenericStructuralFields(lines, {
  maxPayloadKg: "999", lengthCm: "355", vehicleWeightKg: "1070", ownerName: "正しい所有者",
});
assert.equal(corrected.patch.maxPayloadKg, "");
assert.equal(corrected.patch.lengthCm, "339");
assert.equal(corrected.patch.vehicleWeightKg, "1050");
assert.equal(corrected.patch.ownerName, "正しい所有者", "identity values remain preserve-first when already structurally valid");
assert.equal(corrected.provenance.maxPayloadKg.ownership, "sequence-slot");

const invalid = resolveCertificatePdfGenericStructuralFields(lines, { lengthCm: "長さ", vehicleWeightKg: "not-weight" });
assert.equal(invalid.patch.lengthCm, "339");
assert.equal(invalid.patch.vehicleWeightKg, "1050");

const fourAxles = [row(.1, [["前前軸重", .1, .09], ["前後軸重", .31, .09], ["後前軸重", .52, .09], ["後後軸重", .73, .09]]),
  row(.12, [["1250 kg", .11, .075], ["1050 kg", .32, .075], ["1690 kg", .53, .075], ["3070 kg", .74, .075]])];
const registered = resolveCertificatePdfGenericStructuralFields(fourAxles, {}).patch;
assert.deepEqual([
  registered.frontFrontAxleWeightKg, registered.frontRearAxleWeightKg,
  registered.rearFrontAxleWeightKg, registered.rearRearAxleWeightKg,
], ["1250", "1050", "1690", "3070"]);

const noPayload = resolveCertificatePdfGenericStructuralFields([
  row(.1, vehicleLabels), row(.12, vehicleValues.slice(1)),
], {});
assert.equal(noPayload.patch.maxPayloadKg, undefined, "missing is not confused with an explicit dash");
assert.equal(noPayload.patch.lengthCm, "339", "dimension keeps its own cell");

const incomplete = resolveCertificatePdfGenericStructuralFields([
  row(.1, [["長さ", .55, .04], ["幅", .68, .03], ["高さ", .80, .04]]),
  row(.12, [["339 cm", .56, .07], ["147 cm", .68, .07], ["178 cm", .80, .07]]),
], { lengthCm: "355" });
assert.equal(incomplete.patch.lengthCm, "355", "incomplete sequence cannot override an existing valid field");

const nextLabel = resolveCertificatePdfGenericStructuralFields([
  row(.1, [["所有者の氏名又は名称", .1, .15]]),
  row(.12, [["所有者の住所", .1, .12]]),
  row(.14, [["東京都", .1, .07]]),
], {});
assert.equal(nextLabel.patch.ownerName, undefined, "the next label is not an identity value");
assert.equal(nextLabel.patch.ownerAddress, "東京都");

console.log("certificate PDF generic structural regression: PASS (sequence ownership authoritative, explicit-empty safe, cross-field FP 0, anti-overfit incomplete-sequence guard PASS)");
