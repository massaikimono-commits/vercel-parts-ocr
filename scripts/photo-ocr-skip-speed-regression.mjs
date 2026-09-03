import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

const qrGuard = src.indexOf('const haveCriticalQr = hasQr("0") || hasQr("2");');
const needReg = src.indexOf('const needReg = !fieldValue("自動車登録番号又は車両番号") && !haveCriticalQr;');
const needChassis = src.indexOf('const needChassis = !haveCriticalQr');
const skipGuard = src.indexOf('if (!needTopRight && !needEngine && !needReg && !needChassis && !needProfile && !needOutput)');
const workerCreate = src.indexOf('createWorker("jpn+eng"');

assert.ok(qrGuard >= 0, "critical QR guard must exist");
assert.ok(needReg > qrGuard, "registration OCR must be suppressed by critical QR data");
assert.ok(needChassis > qrGuard, "chassis OCR must be suppressed by critical QR data");
assert.ok(skipGuard > needChassis, "all critical-field needs must be evaluated before the skip guard");
assert.ok(workerCreate > skipGuard, "Tesseract worker must not be created before the no-extra-OCR fast path");

console.log("photo OCR skip/speed regression: ok");
