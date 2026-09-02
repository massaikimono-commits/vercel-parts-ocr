import { performance } from "node:perf_hooks";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

const width = 1200;
const height = 1697;
const targets = [
  { x: 0.511, y: 0.855, size: 56 },
  { x: 0.567, y: 0.872, size: 58 },
  { x: 0.617, y: 0.889, size: 60 },
  { x: 0.733, y: 0.906, size: 62 },
  { x: 0.789, y: 0.923, size: 64 },
];
const rgba = new Uint8ClampedArray(width * height * 4);

for (let p = 0; p < rgba.length; p += 4) {
  rgba[p] = rgba[p + 1] = rgba[p + 2] = 242;
  rgba[p + 3] = 255;
}

function paintQr({ x: centerX, y: centerY, size }) {
  const cell = 4;
  const cx = Math.round(width * centerX);
  const cy = Math.round(height * centerY);
  const left = cx - Math.floor(size / 2);
  const top = cy - Math.floor(size / 2);

  for (let yy = 0; yy < size; yy += 1) {
    for (let xx = 0; xx < size; xx += 1) {
      const gx = Math.floor(xx / cell);
      const gy = Math.floor(yy / cell);
      const dark = ((gx * 3 + gy * 5 + gx * gy) % 7) < 3 || (gx < 5 && gy < 5);
      if (!dark) continue;
      const px = left + xx;
      const py = top + yy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const p = (py * width + px) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 172;
    }
  }
}

for (const target of targets) paintQr(target);

// Warm up once so startup/JIT does not dominate the timing guard.
detectCertificateQrDensityCenters(rgba, width, height);

const runs = 3;
const started = performance.now();
let actual = [];
for (let i = 0; i < runs; i += 1) {
  actual = detectCertificateQrDensityCenters(rgba, width, height);
}
const averageMs = (performance.now() - started) / runs;

if (actual.length < targets.length) {
  throw new Error(`perspective-photo: expected >=${targets.length} QR targets, got ${actual.length}`);
}
if (actual.length > targets.length + 1) {
  throw new Error(`perspective-photo: too many QR candidates (${actual.length}); expected at most ${targets.length + 1}`);
}
// The detector intentionally returns horizontal crop centers only. The targets
// are painted at progressively different Y positions, so matching every X
// center verifies those slanted/perspective placements remain detectable
// without inventing a Y-coordinate contract the production detector does not expose.
for (const target of targets) {
  if (!actual.some((item) => Math.abs(item.x - target.x) <= 0.025)) {
    throw new Error(`perspective-photo: missed QR center x=${target.x} (painted y=${target.y}); actual=${actual.map((item) => item.x).join(",")}`);
  }
}
if (averageMs > 750) {
  throw new Error(`perspective-photo: QR detector too slow: ${averageMs.toFixed(1)}ms average > 750ms budget`);
}

console.log(`PASS QR perspective regression: candidates=${actual.length}; average=${averageMs.toFixed(1)}ms`);
