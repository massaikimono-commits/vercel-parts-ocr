import fs from "node:fs";
import assert from "node:assert/strict";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

const qrPriority = src.indexOf('const qrPriority = window.__vehicleCertificateQrPriority || {};');
const needReg = src.indexOf('const needReg = !fieldValue("自動車登録番号又は車両番号") && !qrPriority.registrationNumber;');
const needChassis = src.indexOf('const needChassis = !qrPriority.chassisNumber && (!currentChassis || (fam && currentPrefix && currentPrefix !== fam));');
const skipGuard = src.indexOf('if (!needTopRight && !needEngine && !needReg && !needChassis && !needProfile && !needOutput)');
const sourceCanvas = src.indexOf('const source = await sourceCanvas(file);');
const workerCreate = src.indexOf('createWorker("jpn+eng"');

assert.ok(qrPriority >= 0, "parsed QR priority state must exist");
assert.ok(needReg > qrPriority, "registration OCR must stop only when parsed QR registration data exists");
assert.ok(needChassis > qrPriority, "chassis OCR must stop only when parsed QR chassis data exists");
assert.ok(skipGuard > needChassis, "all critical-field needs must be evaluated before the skip guard");
assert.ok(sourceCanvas > skipGuard, "source image expansion must not happen before the no-extra-OCR fast path");
assert.ok(workerCreate > sourceCanvas, "Tesseract worker must not be created before the no-extra-OCR fast path");

console.log("photo OCR skip/speed regression: ok");
