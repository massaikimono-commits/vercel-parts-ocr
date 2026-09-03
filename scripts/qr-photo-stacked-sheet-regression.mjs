import { performance } from "node:perf_hooks";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

const width = 1200;
const height = 1697;
const centers = [0.511, 0.567, 0.617, 0.733, 0.789];
const rgba = new Uint8ClampedArray(width * height * 4);

for (let p = 0; p < rgba.length; p += 4) {
  rgba[p] = rgba[p + 1] = rgba[p + 2] = 244;
  rgba[p + 3] = 255;
}

function paintQr(centerX, centerY = 0.90, shade = 18, size = 62) {
  const cell = 4;
  const cx = Math.round(width * centerX);
  const cy = Math.round(height * centerY);
  const left = cx - Math.floor(size / 2);
  const top = cy - Math.floor(size / 2);
  for (let yy = 0; yy < size; yy += 1) {
    for (let xx = 0; xx < size; xx += 1) {
      const gx = Math.floor(xx / cell);
      const gy = Math.floor(yy / cell);
      const finder = (gx < 5 && gy < 5) || (gx >= 10 && gy < 5) || (gx < 5 && gy >= 10);
      const dark = finder
        ? gx % 3 === 0 || gy % 3 === 0 || (gx + gy) % 2 === 0
        : ((gx * 3 + gy * 5 + gx * gy) % 7) < 3;
      if (!dark) continue;
      const x = left + xx;
      const y = top + yy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const p = (y * width + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = shade;
    }
  }
}

for (const center of centers) paintQr(center);

// Model a second sheet remaining visible beside/behind the certificate. The
// extra dense block may be surfaced, but must not crowd out the primary five QR
// targets belonging to the photographed registered-vehicle certificate.
paintQr(0.945, 0.915, 28, 68);

// Model an upper-right hand/shadow occlusion. It must not affect lower-band QR
// targeting or detector speed.
const shadowLeft = Math.round(width * 0.76);
const shadowTop = Math.round(height * 0.12);
const shadowBottom = Math.round(height * 0.42);
for (let y = shadowTop; y < shadowBottom; y += 1) {
  for (let x = shadowLeft; x < width; x += 1) {
    const p = (y * width + x) * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = Math.min(rgba[p], 205);
  }
}

detectCertificateQrDensityCenters(rgba, width, height);

const runs = 3;
const started = performance.now();
let actual = [];
for (let i = 0; i < runs; i += 1) actual = detectCertificateQrDensityCenters(rgba, width, height);
const averageMs = (performance.now() - started) / runs;

if (actual.length < centers.length) {
  throw new Error(`stacked-sheet-photo: expected >=${centers.length} QR targets, got ${actual.length}`);
}
if (actual.length > centers.length + 2) {
  throw new Error(`stacked-sheet-photo: too many QR candidates (${actual.length}); expected at most ${centers.length + 2}`);
}
for (const expectedX of centers) {
  if (!actual.some((item) => Math.abs(item.x - expectedX) <= 0.025)) {
    throw new Error(`stacked-sheet-photo: missed primary QR center ${expectedX}; actual=${actual.map((item) => item.x).join(",")}`);
  }
}
if (averageMs > 750) {
  throw new Error(`stacked-sheet-photo: QR detector too slow: ${averageMs.toFixed(1)}ms average > 750ms budget`);
}

console.log(`PASS QR stacked-sheet precision: candidates=${actual.length}; average=${averageMs.toFixed(1)}ms`);
