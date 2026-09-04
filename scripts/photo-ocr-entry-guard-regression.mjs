import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

const imageGate = 'if (!file || !file.type.startsWith("image/")) return;';
const fastPath = 'if (!needTopRight && !needEngine && !needReg && !needChassis && !needProfile && !needOutput) {';
const sourceMarker = "const source = await sourceCanvas(file);";
const tesseractMarker = 'const t = await import("tesseract.js");';

assert.ok(src.includes(imageGate), "photo fallback must reject PDF/non-image inputs before OCR work");
assert.ok(src.includes(fastPath), "photo fallback must keep the no-missing-fields fast path");

const imageGatePos = src.indexOf(imageGate);
const fastPathPos = src.indexOf(fastPath);
const sourcePos = src.indexOf(sourceMarker);
const tesseractPos = src.indexOf(tesseractMarker);

assert.ok(imageGatePos >= 0 && imageGatePos < sourcePos, "image/PDF gate must run before source canvas allocation");
assert.ok(fastPathPos >= 0 && fastPathPos < sourcePos, "missing-field decision must run before image expansion");
assert.ok(sourcePos >= 0 && sourcePos < tesseractPos, "Tesseract must not load before a photo fallback is actually required");

console.log("photo OCR entry-guard regression: ok");
