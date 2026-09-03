import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

const width = 1200;
const height = 1697;
const centers = [0.511, 0.567, 0.617, 0.733, 0.789];
const rgba = new Uint8ClampedArray(width * height * 4);

for (let p = 0; p < rgba.length; p += 4) {
  rgba[p] = rgba[p + 1] = rgba[p + 2] = 245;
  rgba[p + 3] = 255;
}

// Reproduce the low-density failure mode seen in softened phone photos without
// embedding any real certificate image or identifier.  Each synthetic target
// has only two sampled horizontal transitions, so valid peaks stay below the
// old 0.05 score threshold that previously forced maxCenters=3.
const cy = Math.round(height * 0.90);
for (const center of centers) {
  const cx = Math.round(width * center);
  for (let y = cy; y < cy + 2; y += 1) {
    for (let x = cx - 12; x <= cx + 12; x += 1) {
      const p = (y * width + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 20;
    }
  }
}

const actual = detectCertificateQrDensityCenters(rgba, width, height);
const soft = actual.filter((item) => item.score < 0.05);

if (soft.length < centers.length) {
  throw new Error(`soft-cap: expected >=${centers.length} sub-0.05 candidates, got ${soft.length}; actual=${actual.map((item) => `${item.x}:${item.score}`).join(",")}`);
}
for (const expectedX of centers) {
  if (!soft.some((item) => Math.abs(item.x - expectedX) <= 0.035)) {
    throw new Error(`soft-cap: missed center ${expectedX}; actual=${soft.map((item) => `${item.x}:${item.score}`).join(",")}`);
  }
}

console.log(`PASS soft 5QR candidate-cap guard: ${soft.map((item) => `${item.x}:${item.score}`).join(" | ")}`);
