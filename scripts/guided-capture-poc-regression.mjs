import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/guided-capture/page.tsx");
const certificateTransfer = read("app/guided-capture/certificate-transfer.ts");
const certificateConsumer = read("app/guided-certificate-transfer-consumer.tsx");
const certificateEnhancers = read("app/vehicle-certificate-route-enhancers.tsx");
const certificatePage = read("app/vehicle-workflow-v2/page.tsx");
const partsLayout = read("app/ocr/layout.tsx");

assert.match(page, /navigator\.mediaDevices\.getUserMedia/, "guided capture must open a real MediaStream camera");
assert.match(page, /facingMode: \{ ideal: "environment" \}/, "guided capture must prefer the rear camera on iPhone");
assert.match(page, /<video ref=\{videoRef\} playsInline muted autoPlay/, "camera video must be inline-compatible with iPhone Safari");
assert.match(page, /paperGuide/, "parts capture must expose a document guide frame");
assert.match(page, /qrGuide/, "certificate capture must expose a QR guide frame");
assert.match(page, /setStatus\("撮影OK"\)/, "guided capture must expose real-time capture status");
assert.match(page, /canvas\.toBlob\(resolve, "image\/jpeg", 0\.95\)/, "guided capture must produce a still JPEG frame");
assert.match(page, /autoCapture/, "guided capture must keep an auto-capture foundation");
assert.match(page, /saveOCRTransferImage\(capturedFile\)/, "parts capture must hand the still image to the existing parts OCR transfer path");
assert.match(page, /location\.assign\("\/ocr"\)/, "parts capture must return to the existing parts OCR screen");
assert.match(page, /saveCertificateTransferImage\(capturedFile\)/, "certificate capture must stage the still image for the existing certificate workflow");
assert.match(page, /location\.assign\("\/vehicle-workflow-v2"\)/, "certificate capture must return to the current certificate workflow");
assert.match(certificateConsumer, /new DataTransfer\(\)/, "certificate bridge must attach the captured File without changing OCR recognition functions");
assert.match(certificateConsumer, /dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/, "certificate bridge must enter through the existing file-input change path");
assert.match(certificateEnhancers, /GuidedCertificateTransferConsumer/, "certificate transfer consumer must stay route-scoped to certificate workflows");
assert.match(certificatePage, /\/guided-capture\?mode=certificate/, "certificate OCR screen must expose the guided live entry");
assert.match(partsLayout, /\/guided-capture\?mode=parts/, "parts OCR screen must expose the guided capture entry");
assert.match(certificateTransfer, /sessionStorage/, "certificate captured image handoff must remain temporary and browser-local");

for (const forbidden of ["supabase", "tesseract", "jsQR", "ZXing", "finder", "geometry", "row detection", "threshold"]) {
  assert.ok(!page.toLowerCase().includes(forbidden.toLowerCase()), `guided UI must not implement OCR recognition logic: ${forbidden}`);
}

console.log("guided capture PoC regression: ok");
