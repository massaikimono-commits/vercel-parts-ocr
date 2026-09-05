import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

const loops = [
  { name: "top-right", marker: "if (needTopRight)", maxPasses: 2 },
  { name: "engine", marker: "if (needEngine)", maxPasses: 2 },
  { name: "profile/output", marker: "if (needProfile || needOutput)", maxPasses: 2 },
  { name: "registration", marker: "if (needReg)", maxPasses: 2 },
  { name: "chassis", marker: "if (needChassis)", maxPasses: 2 },
];

for (const loop of loops) {
  assert.ok(src.includes(loop.marker), `${loop.name} fallback must remain conditional`);
}

assert.equal(
  src.match(/passes \+= 1;/g)?.length,
  loops.length,
  "fallback OCR pass accounting changed; review the worst-case pass budget"
);

const binaryTwoPassLoops = src.match(/for \(const binary of \[false, true\]\)/g)?.length ?? 0;
const tupleTwoPassLoops = src.match(/for \(const \[[^\]]+\] of \[\[[^\]]+\], \[[^\]]+\]\]\)/g)?.length ?? 0;
const worstCasePasses = binaryTwoPassLoops * 2 + tupleTwoPassLoops * 2;

assert.equal(worstCasePasses, 10, "critical fallback OCR must stay within the 10-pass worst-case budget");
assert.ok(src.includes("if (!needTopRight && !needEngine && !needReg && !needChassis && !needProfile && !needOutput)"), "zero-pass fast path must remain in place");
assert.ok(
  src.includes('if ((fieldValue("記録年月日") || patch.recordDate) && (fieldValue("記録事項番号") || patch.documentNumber)) break;'),
  "top-right OCR must stop after one pass when the already-filled date plus newly recovered document number satisfy both fields"
);

console.log("photo OCR pass-budget regression: ok");
