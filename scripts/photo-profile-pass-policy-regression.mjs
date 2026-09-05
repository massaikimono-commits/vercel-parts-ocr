import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

const categoricalKeys = ["vehicleName", "vehicleClass", "purpose", "privateBusiness", "bodyShape", "fuel"];
const numericKeys = ["seatingCapacity", "maxPayloadKg", "displacementOrRatedOutput"];

function accepted(values, key) {
  const unique = [...new Set(values.filter(Boolean))];
  const categorical = categoricalKeys.includes(key);
  return unique.length === 1 && (categorical || values.length >= 2) ? unique[0] : "";
}

assert.equal(accepted(["ガソリン"], "fuel"), "ガソリン", "fixed-category fuel may be accepted from one validated OCR pass");
assert.equal(accepted(["5"], "seatingCapacity"), "", "numeric seating capacity must not be accepted from one OCR pass");
assert.equal(accepted(["5", "5"], "seatingCapacity"), "5", "numeric seating capacity may be accepted after two-pass agreement");
assert.equal(accepted(["5", "8"], "seatingCapacity"), "", "conflicting numeric OCR passes must be rejected");
assert.equal(accepted(["1.8 L"], "displacementOrRatedOutput"), "", "output/displacement must not be accepted from one OCR pass");
assert.equal(accepted(["1.8 L", "1.8 L"], "displacementOrRatedOutput"), "1.8 L", "output/displacement may be accepted after agreement");

for (const key of categoricalKeys) {
  assert.ok(src.includes(`\"${key}\"`), `${key} must remain represented in photo profile fallback`);
}
for (const key of numericKeys) {
  assert.ok(src.includes(`\"${key}\"`), `${key} must remain represented in numeric confidence policy`);
}

assert.ok(
  src.includes('if (unique.length === 1 && (categorical || values.length >= 2)) patch[key] = unique[0];'),
  "runtime profile acceptance must keep the same categorical-vs-numeric confidence policy"
);
assert.ok(
  src.includes('for (const [y, h, binary] of [[.345, .225, false], [.315, .285, true]])'),
  "profile fallback must retain the two complementary OCR passes needed for numeric agreement"
);

console.log("photo profile pass policy regression: ok");
