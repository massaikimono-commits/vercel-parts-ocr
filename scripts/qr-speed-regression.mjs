import { performance } from "node:perf_hooks";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

function syntheticQrImage(width, height, centers) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  const size = Math.max(42, Math.round(width * 0.052));
  const cell = Math.max(3, Math.floor(size / 13));
  const cy = Math.floor(height * 0.90);
  for (const center of centers) {
    const cx = Math.round(width * center);
    const left = Math.max(0, cx - Math.floor(size / 2));
    const top = Math.max(0, cy - Math.floor(size / 2));
    for (let yy = 0; yy < size; yy += 1) {
      for (let xx = 0; xx < size; xx += 1) {
        const gx = Math.floor(xx / cell);
        const gy = Math.floor(yy / cell);
        const dark = ((gx * 3 + gy * 5 + gx * gy) % 7) < 3 || (gx < 4 && gy < 4);
        if (!dark) continue;
        const x = left + xx;
        const y = top + yy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const p = (y * width + x) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = 10;
        rgba[p + 3] = 255;
      }
    }
  }
  return rgba;
}

const width = 1200;
const height = 1697;
const rgba = syntheticQrImage(width, height, [0.485, 0.574, 0.658, 0.744, 0.829, 0.911]);

// Warm-up keeps the budget focused on steady-state detector cost, not Node startup/JIT.
detectCertificateQrDensityCenters(rgba, width, height);

const runs = 4;
const started = performance.now();
let centers = [];
for (let i = 0; i < runs; i += 1) {
  centers = detectCertificateQrDensityCenters(rgba, width, height);
}
const elapsed = performance.now() - started;
const average = elapsed / runs;

if (centers.length < 6) {
  throw new Error(`QR speed fixture lost targets: expected >=6, got ${centers.length}`);
}

// This is deliberately generous to avoid flaky CI while catching accidental multi-second regressions.
const maxAverageMs = 750;
if (average > maxAverageMs) {
  throw new Error(`QR density detector too slow: ${average.toFixed(1)}ms average > ${maxAverageMs}ms budget`);
}

console.log(`PASS QR density speed: ${average.toFixed(1)}ms average across ${runs} runs (${centers.length} targets)`);
