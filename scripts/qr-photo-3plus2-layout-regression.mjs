import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

const width = 1200;
const height = 1697;
const rgba = new Uint8ClampedArray(width * height * 4);

for (let p = 0; p < rgba.length; p += 4) {
  rgba[p] = rgba[p + 1] = rgba[p + 2] = 246;
  rgba[p + 3] = 255;
}

// Synthetic registered-vehicle 5QR geometry: three symbols on one row and
// two slightly lower on the right. No real certificate image/data is embedded.
const targets = [
  { x: 0.505, y: 0.875 },
  { x: 0.575, y: 0.875 },
  { x: 0.645, y: 0.875 },
  { x: 0.755, y: 0.925 },
  { x: 0.825, y: 0.925 },
];

function drawQrLike(cxNorm, cyNorm) {
  const cx = Math.round(width * cxNorm);
  const cy = Math.round(height * cyNorm);
  const module = 3;
  const modules = 13;
  const half = Math.floor((module * modules) / 2);

  for (let my = 0; my < modules; my += 1) {
    for (let mx = 0; mx < modules; mx += 1) {
      // Dense QR-like checker pattern with finder-like dark corners.
      const finder =
        (mx < 4 && my < 4) ||
        (mx >= modules - 4 && my < 4) ||
        (mx < 4 && my >= modules - 4);
      const dark = finder || ((mx + my) % 2 === 0);
      if (!dark) continue;
      for (let py = 0; py < module; py += 1) {
        const y = cy - half + my * module + py;
        if (y < 0 || y >= height) continue;
        for (let px = 0; px < module; px += 1) {
          const x = cx - half + mx * module + px;
          if (x < 0 || x >= width) continue;
          const p = (y * width + x) * 4;
          rgba[p] = rgba[p + 1] = rgba[p + 2] = 18;
        }
      }
    }
  }
}

for (const target of targets) drawQrLike(target.x, target.y);

// Add harmless lower-band clutter left of the official QR area. It must not
// steal enough candidate slots to make five-symbol recovery impossible.
for (let y = Math.round(height * 0.84); y < Math.round(height * 0.96); y += 11) {
  for (let x = 70; x < 420; x += 19) {
    const p = (y * width + x) * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 80;
  }
}

const actual = detectCertificateQrDensityCenters(rgba, width, height);
if (actual.length < 5) {
  throw new Error(`3+2-layout: expected >=5 QR candidates, got ${actual.length}; actual=${actual.map((v) => `${v.x}:${v.score}`).join(",")}`);
}

for (const target of targets) {
  if (!actual.some((item) => Math.abs(item.x - target.x) <= 0.035)) {
    throw new Error(`3+2-layout: missed x=${target.x}; actual=${actual.map((v) => `${v.x}:${v.score}`).join(",")}`);
  }
}

console.log(`PASS synthetic 5QR 3+2 layout guard: ${actual.map((v) => `${v.x}:${v.score}`).join(" | ")}`);
