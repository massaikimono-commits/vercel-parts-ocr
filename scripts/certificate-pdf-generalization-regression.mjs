import assert from "node:assert/strict";
import { clusterPhysicalRows, detectAxleLayout, parseTwoAxleVehicleRows } from "../app/lib/certificate-pdf-row-semantics.mjs";

function token(text, x, y, w = 0.08, h = 0.012) { return { text, x, y, w, h }; }
function row(y, entries) { return entries.map(([text, x, w]) => token(text, x, y, w)); }

// Sanitized structural fixture derived from the official two-axle kei layout.
// It intentionally contains no registration number, chassis number, person name,
// address, or document-specific coordinate branch in production logic.
const twoAxleTokens = [
  ...row(0.50, [["車両重量", .05, .10], ["車両総重量", .27, .12], ["長さ", .53, .06], ["幅", .70, .03], ["高さ", .85, .05]]),
  ...row(0.525, [["650 kg", .08, .08], ["870 kg", .30, .08], ["339 cm", .54, .08], ["147 cm", .70, .08], ["152 cm", .85, .08]]),
  ...row(0.57, [["前軸重", .10, .07], ["後軸重", .40, .07], ["総排気量又は定格出力", .70, .20]]),
  ...row(0.595, [["400 kg", .18, .08], ["250 kg", .48, .08], ["0.65 L", .84, .07]]),
  ...row(0.64, [["燃料の種類", .06, .10], ["型式指定番号", .40, .12], ["類別区分番号", .75, .12]]),
  ...row(0.665, [["ガソリン", .08, .09], ["18098", .49, .06], ["0001", .84, .05]]),
];

const twoRows = clusterPhysicalRows(twoAxleTokens);
assert.equal(detectAxleLayout(twoRows), "two-axis");
assert.deepEqual(parseTwoAxleVehicleRows(twoRows), {
  vehicleWeightKg: "650",
  grossVehicleWeightKg: "870",
  lengthCm: "339",
  widthCm: "147",
  heightCm: "152",
  frontFrontAxleWeightKg: "400",
  rearRearAxleWeightKg: "250",
  displacementOrRatedOutput: "0.65 L",
  fuel: "ガソリン",
  modelDesignationNumber: "18098",
  classificationNumber: "0001",
});

// Four-axis baseline must remain distinguishable and must not be forced through
// the two-axle normalizer. This protects the pre-existing registered-vehicle path.
const fourAxleTokens = [
  ...row(0.50, [["車台番号", .04, .10], ["長さ", .30, .05], ["幅", .42, .03], ["高さ", .52, .05], ["前前軸重", .62, .08], ["後後軸重", .88, .08]]),
  ...row(0.525, [["ABC-123456", .05, .12], ["469 cm", .30, .08], ["169 cm", .42, .08], ["198 cm", .52, .08], ["1020 kg", .62, .09], ["670 kg", .88, .08]]),
];
const fourRows = clusterPhysicalRows(fourAxleTokens);
assert.equal(detectAxleLayout(fourRows), "four-axis");

// Cross-row isolation: values from axle/output row must never populate dimensions.
const parsed = parseTwoAxleVehicleRows(twoRows);
assert.notEqual(parsed.lengthCm, parsed.frontFrontAxleWeightKg);
assert.notEqual(parsed.widthCm, parsed.frontFrontAxleWeightKg);
assert.notEqual(parsed.heightCm, parsed.frontFrontAxleWeightKg);
assert.notEqual(parsed.displacementOrRatedOutput, parsed.modelDesignationNumber);

console.log("PASS post-5905 PDF generalization row semantics: two-axis + four-axis isolation");
