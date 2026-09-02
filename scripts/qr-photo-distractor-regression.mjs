import { performance } from "node:perf_hooks";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

const width = 1200;
const height = 1697;
const centers = [0.511, 0.567, 0.617, 0.733, 0.789];
const rgba = new Uint8ClampedArray(width * height * 4);

for (let p = 0; p < rgba.length; p += 4) {
  rgba[p] = rgba[p + 1] = rgba[p + 2] = 242;
  rgba[p + 3] = 255;
}

function paintQr(centerX) {
  const size = 62;
  const cell = 4;
  const cx = Math.round(width * centerX);
  const cy = Math.round(height * 0.90);
  const left = cx - Math.floor(size / 2);
  const top = cy - Math.floor(size / 2);

  for (let yy = 0; yy < size; yy += 1) {
    for (let xx = 0; xx < size; xx += 1) {
      const gx = Math.floor(xx / cell);
      const gy = Math.floor(yy / cell);
      const dark = ((gx * 3 + gy * 5 + gx * gy) % 7) < 3 || (gx < 5 && gy < 5);
      if (!dark) continue;
      const x = left + xx;
      const y = top + yy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const p = (y * width + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 176;
    }
  }
}

for (const center of centers) paintQr(center);

// Add a deterministic footer distractor that looks like dense printed/barcode
// material but is not a QR symbol. This guards final candidate precision: a
// noisy footer must not crowd the real five QR targets out of the crop list.
const distractorLeft = Math.round(width * 0.425);
const distractorTop = Math.round(height * 0.872);
const distractorWidth = Math.round(width * 0.045);
const distractorHeight = Math.round(height * 0.055);
for (let y = distractorTop; y < distractorTop + distractorHeight; y += 1) {
  for (let x = distractorLeft; x < distractorLeft + distractorWidth; x += 1) {
    if (((x - distractorLeft) % 7) > 2 || ((y - distractorTop) % 11) < 2) continue;
    const p = (y * width + x) * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 165;
  }
}

// Add a second, visually different footer distractor: a compact sparse
// text/label-sized block close to the QR band. Keep it below roughly one
// detector separation window so one printed label does not manufacture two
// independent QR-like peaks in the synthetic fixture.
const textLeft = Math.round(width * 0.845);
const textTop = Math.round(height * 0.878);
const textWidth = Math.round(width * 0.050);
const textHeight = Math.round(height * 0.040);
for (let y = textTop; y < textTop + textHeight; y += 1) {
  for (let x = textLeft; x < textLeft + textWidth; x += 1) {
    const rx = x - textLeft;
    const ry = y - textTop;
    const gx = rx % 19;
    const gy = ry % 14;
    const verticalStroke = gx < 2 && gy >= 3 && gy <= 10;
    const horizontalStroke = (gy === 3 || gy === 10) && gx >= 2 && gx <= 10;
    if (!verticalStroke && !horizontalStroke) continue;
    const p = (y * width + x) * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 196;
  }
}

// Warm up once so startup/JIT does not dominate the timing guard.
detectCertificateQrDensityCenters(rgba, width, height);

const runs = 3;
const started = performance.now();
let actual = [];
for (let i = 0; i < runs; i += 1) {
  actual = detectCertificateQrDensityCenters(rgba, width, height);
}
const averageMs = (performance.now() - started) / runs;

if (actual.length < centers.length) {
  throw new Error(`distractor-photo: expected >=${centers.length} QR targets, got ${actual.length}`);
}
// There are two deliberately separate non-QR distractor regions. Allow at most
// one extra candidate per region while still requiring all five true centers.
if (actual.length > centers.length + 2) {
  throw new Error(`distractor-photo: too many QR candidates (${actual.length}); expected at most ${centers.length + 2}`);
}
for (const expectedX of centers) {
  if (!actual.some((item) => Math.abs(item.x - expectedX) <= 0.025)) {
    throw new Error(`distractor-photo: missed QR center ${expectedX}; actual=${actual.map((item) => item.x).join(",")}`);
  }
}
if (averageMs > 750) {
  throw new Error(`distractor-photo: QR detector too slow: ${averageMs.toFixed(1)}ms average > 750ms budget`);
}

console.log(`PASS QR distractor precision: candidates=${actual.length}; average=${averageMs.toFixed(1)}ms`);
