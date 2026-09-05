import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

assert.ok(
  src.includes('"車名","自動車の種別","用途","自家用・事業用の別","車体の形状","乗車定員","最大積載量 kg","燃料の種類"'),
  "photo missing-profile detection must continue to include fuel and numeric profile fields"
);
assert.ok(
  src.includes('const needOutput = !fieldValue("総排気量又は定格出力");'),
  "displacement/rated-output must remain an independent missing-field trigger"
);
assert.ok(
  src.includes('const categorical = ["vehicleName","vehicleClass","purpose","privateBusiness","bodyShape","fuel"].includes(key);'),
  "only fixed-dictionary profile fields may use single-pass acceptance"
);
assert.ok(
  src.includes('if (unique.length === 1 && (categorical || values.length >= 2)) patch[key] = unique[0];'),
  "numeric profile/output values must still require agreement across both OCR passes"
);

for (const numericKey of ["seatingCapacity", "maxPayloadKg", "displacementOrRatedOutput"]) {
  assert.ok(!src.includes(`\"${numericKey}\"].includes(key)`), `${numericKey} must not be treated as a categorical single-pass field`);
}

console.log("photo profile confidence regression: ok");
