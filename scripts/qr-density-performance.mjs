import { performance } from "node:perf_hooks";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

function syntheticQrImage(width, height, centers) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;

  const size = Math.max(42, Math.round(width * .052));
  const cell = Math.max(3, Math.floor(size / 13));
  const cy = Math.floor(height * .90);
  for (const center of centers) {
    const cx = Math.round(width * center);
    const left = Math.max(0, cx - Math.floor(size / 2));
    const top = Math.max(0, cy - Math.floor(size / 2));
    for (let yy = 0; yy < size; yy += 1) {
      for (let xx = 0; xx < size; xx += 1) {
        const gx = Math.floor(xx / cell);
        const gy = Math.floor(yy / cell);
        const finder = (gx < 4 && gy < 4) || (gx >= 9 && gy < 4) || (gx < 4 && gy >= 9);
        const dark = finder
          ? (gx + gy) % 2 === 0 || gx % 3 === 0 || gy % 3 === 0
          : ((gx * 3 + gy * 5 + gx * gy) % 7) < 3;
        if (!dark) continue;
        const x = left + xx;
        const y = top + yy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const p = (y * width + x) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = 10;
      }
    }
  }
  return rgba;
}

const width = 1200;
const height = 1697;
const layouts = [
  [.485, .574, .658, .744, .829, .911],
  [.511, .567, .617, .733, .789],
  [.538, .598, .651, .789, .853],
  [.703, .928],
];
const images = layouts.map((centers) => syntheticQrImage(width, height, centers));

// Warm-up avoids treating module/JIT startup as algorithm time.
for (const image of images) detectCertificateQrDensityCenters(image, width, height);

const rounds = 12;
const start = performance.now();
let detections = 0;
for (let round = 0; round < rounds; round += 1) {
  for (const image of images) {
    detections += detectCertificateQrDensityCenters(image, width, height).length;
  }
}
const elapsedMs = performance.now() - start;
const calls = rounds * images.length;
const averageMs = elapsedMs / calls;

if (!detections) {
  console.error("FAIL QR density performance: detector returned no centers");
  process.exit(1);
}

// This is intentionally generous for shared GitHub runners. It catches accidental
// order-of-magnitude slowdowns without making normal runner variance flaky.
const budgetMsPerCall = 350;
if (averageMs > budgetMsPerCall) {
  console.error(`FAIL QR density performance: ${averageMs.toFixed(1)} ms/call exceeds ${budgetMsPerCall} ms budget`);
  process.exit(1);
}

console.log(`PASS QR density performance: ${calls} calls, ${averageMs.toFixed(1)} ms/call average, ${detections} centers total`);
