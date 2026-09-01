import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

function syntheticQrImage(
  width,
  height,
  centers,
  foreground,
  background,
  horizontalShade = 0,
  verticalShade = 0,
  blurRadius = 0,
) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const xShade = horizontalShade * (x / Math.max(1, width - 1));
      const yShade = verticalShade * (y / Math.max(1, height - 1));
      const localShade = Math.round(xShade + yShade);
      const value = Math.max(0, background - localShade);
      rgba[p] = rgba[p + 1] = rgba[p + 2] = value;
      rgba[p + 3] = 255;
    }
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
        const xShade = horizontalShade * (x / Math.max(1, width - 1));
        const yShade = verticalShade * (y / Math.max(1, height - 1));
        const localShade = Math.round(xShade + yShade);
        const value = Math.max(0, foreground - localShade);
        rgba[p] = rgba[p + 1] = rgba[p + 2] = value;
      }
    }
  }

  // Camera focus/motion softness matters most around the QR row. Keep the
  // synthetic blur deterministic and local so this remains a fast CI guard.
  if (blurRadius > 0) {
    const source = new Uint8ClampedArray(rgba);
    const yMin = Math.max(0, Math.floor(height * 0.84));
    const yMax = Math.min(height, Math.ceil(height * 0.96));
    for (let y = yMin; y < yMax; y += 1) {
      for (let x = blurRadius; x < width - blurRadius; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dx = -blurRadius; dx <= blurRadius; dx += 1) {
          sum += source[(y * width + x + dx) * 4];
          count += 1;
        }
        const value = Math.round(sum / count);
        const p = (y * width + x) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = value;
      }
    }
  }

  return rgba;
}

const width = 1200;
const height = 1697;
const centers = [0.511, 0.567, 0.617, 0.733, 0.789];
const cases = [
  { name: "normal-photo", foreground: 20, background: 250, horizontalShade: 0, verticalShade: 0, blurRadius: 0 },
  { name: "washed-photo", foreground: 150, background: 245, horizontalShade: 0, verticalShade: 0, blurRadius: 0 },
  { name: "low-contrast-photo", foreground: 190, background: 240, horizontalShade: 0, verticalShade: 0, blurRadius: 0 },
  { name: "uneven-light-photo", foreground: 120, background: 245, horizontalShade: 30, verticalShade: 0, blurRadius: 0 },
  { name: "lower-edge-shadow-photo", foreground: 115, background: 245, horizontalShade: 0, verticalShade: 34, blurRadius: 0 },
  { name: "combined-uneven-lower-shadow-photo", foreground: 115, background: 245, horizontalShade: 24, verticalShade: 28, blurRadius: 0 },
  { name: "slight-horizontal-blur-photo", foreground: 45, background: 248, horizontalShade: 0, verticalShade: 0, blurRadius: 1 },
];

for (const test of cases) {
  const rgba = syntheticQrImage(
    width,
    height,
    centers,
    test.foreground,
    test.background,
    test.horizontalShade,
    test.verticalShade,
    test.blurRadius,
  );
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
