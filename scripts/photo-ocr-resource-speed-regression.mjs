import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

const skipGuard = src.indexOf('if (!needTopRight && !needEngine && !needReg && !needChassis && !needProfile && !needOutput)');
const sourceCreate = src.indexOf("const source = await sourceCanvas(file);");
const workerCreate = src.indexOf('createWorker("jpn+eng"');
const sourceRelease = src.indexOf("source.width = 1;");
const workerTerminate = src.indexOf("await worker.terminate().catch(() => {});");
const inputScaleCap = src.indexOf("4000 / Math.max(iw, ih)");
const cropScaleCap = src.indexOf("Math.min(8, target / Math.max(1, sw))");

assert.ok(skipGuard >= 0, "no-extra-OCR fast path must exist");
assert.ok(sourceCreate > skipGuard, "image decoding must not start before the no-extra-OCR fast path");
assert.ok(workerCreate > sourceCreate, "Tesseract worker must be created only after the source image is needed");
assert.equal(src.match(/createWorker\("jpn\+eng"/g)?.length, 1, "critical fallback must reuse a single Tesseract worker");
assert.ok(inputScaleCap >= 0, "source image must remain capped before fallback OCR");
assert.ok(cropScaleCap >= 0, "OCR crop upscale must remain capped");
assert.ok(sourceRelease > workerCreate, "source canvas must be released after fallback OCR");
assert.ok(workerTerminate > workerCreate, "Tesseract worker must always be terminated");

console.log("photo OCR resource/speed regression: ok");
