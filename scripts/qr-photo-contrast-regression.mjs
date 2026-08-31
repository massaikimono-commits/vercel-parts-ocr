import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

function syntheticQrImage(width, height, centers, foreground, background) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < rgba.length; p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = background;
    rgba[p + 3] = 255;
  }

  const size = Math.max(42, Math.round(width * 0.052));
  const cell = Math.max(3, Math.floor(size / 13));
  const cy = Math.floor(height * 0.90);
  for (const center of centers) {
    const cx = Math.round(width * center);
    const left = cx - Math.floor(size / 2);
    const top = cy - Math.floor(size / 2);
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
        rgba[p] = rgba[p + 1] = rgba[p + 2] = foreground;
      }
    }
  }
  return rgba;
}

const width = 1200;
const height = 1697;
const centers = [0.511, 0.567, 0.617, 0.733, 0.789];
const cases = [
  { name: "normal-photo", foreground: 20, background: 250 },
  { name: "washed-photo", foreground: 150, background: 245 },
  { name: "low-contrast-photo", foreground: 190, background: 240 },
];

for (const test of cases) {
  const rgba = syntheticQrImage(width, height, centers, test.foreground, test.background);
  const actual = detectCertificateQrDensityCenters(rgba, width, height);
  if (actual.length < centers.length) {
    throw new Error(`${test.name}: expected >=${centers.length} QR targets, got ${actual.length}`);
  }
  for (const expectedX of centers) {
    if (!actual.some((item) => Math.abs(item.x - expectedX) <= 0.025)) {
      throw new Error(`${test.name}: missed QR center ${expectedX}; actual=${actual.map((item) => item.x).join(",")}`);
    }
  }
}

console.log(`PASS QR photo contrast coverage: ${cases.map((test) => test.name).join(" | ")}`);
