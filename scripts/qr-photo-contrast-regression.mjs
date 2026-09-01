import { performance } from "node:perf_hooks";
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
  verticalBlurRadius = 0,
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

  if (verticalBlurRadius > 0) {
    const source = new Uint8ClampedArray(rgba);
    const yMin = Math.max(verticalBlurRadius, Math.floor(height * 0.84));
    const yMax = Math.min(height - verticalBlurRadius, Math.ceil(height * 0.96));
    for (let y = yMin; y < yMax; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -verticalBlurRadius; dy <= verticalBlurRadius; dy += 1) {
          sum += source[((y + dy) * width + x) * 4];
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
  { name: "normal-photo", foreground: 20, background: 250, horizontalShade: 0, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "washed-photo", foreground: 150, background: 245, horizontalShade: 0, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "low-contrast-photo", foreground: 190, background: 240, horizontalShade: 0, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "low-contrast-slight-blur-photo", foreground: 185, background: 240, horizontalShade: 0, verticalShade: 0, blurRadius: 1, verticalBlurRadius: 0 },
  { name: "low-contrast-slight-vertical-blur-photo", foreground: 185, background: 240, horizontalShade: 0, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 1 },
  { name: "low-contrast-soft-focus-photo", foreground: 180, background: 240, horizontalShade: 0, verticalShade: 0, blurRadius: 1, verticalBlurRadius: 1 },
  { name: "low-contrast-uneven-light-soft-focus-photo", foreground: 175, background: 240, horizontalShade: 22, verticalShade: 0, blurRadius: 1, verticalBlurRadius: 1 },
  { name: "low-contrast-lower-shadow-photo", foreground: 175, background: 240, horizontalShade: 0, verticalShade: 20, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "uneven-light-photo", foreground: 120, background: 245, horizontalShade: 30, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "uneven-light-slight-vertical-blur-photo", foreground: 120, background: 245, horizontalShade: 30, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 1 },
  { name: "lower-edge-shadow-photo", foreground: 115, background: 245, horizontalShade: 0, verticalShade: 34, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "combined-uneven-lower-shadow-photo", foreground: 115, background: 245, horizontalShade: 24, verticalShade: 28, blurRadius: 0, verticalBlurRadius: 0 },
  { name: "slight-horizontal-blur-photo", foreground: 45, background: 248, horizontalShade: 0, verticalShade: 0, blurRadius: 1, verticalBlurRadius: 0 },
  { name: "slight-vertical-blur-photo", foreground: 45, background: 248, horizontalShade: 0, verticalShade: 0, blurRadius: 0, verticalBlurRadius: 1 },
  { name: "slight-blur-lower-shadow-photo", foreground: 55, background: 248, horizontalShade: 0, verticalShade: 24, blurRadius: 1, verticalBlurRadius: 0 },
  { name: "slight-vertical-blur-lower-shadow-photo", foreground: 55, background: 248, horizontalShade: 0, verticalShade: 24, blurRadius: 0, verticalBlurRadius: 1 },
];

const speedRuns = 3;
// Keep the same deliberately generous ceiling as the layout speed regression.
// This catches accidental multi-second slowdowns under degraded photo conditions
// without making CI sensitive to normal shared-runner variance.
const maxAverageMs = 750;
const speedResults = [];

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
    test.verticalBlurRadius,
  );

  // Warm up before measuring so Node startup/JIT does not dominate the budget.
  detectCertificateQrDensityCenters(rgba, width, height);

  const started = performance.now();
  let actual = [];
  for (let i = 0; i < speedRuns; i += 1) {
    actual = detectCertificateQrDensityCenters(rgba, width, height);
  }
  const averageMs = (performance.now() - started) / speedRuns;

  if (actual.length < centers.length) {
    throw new Error(`${test.name}: expected >=${centers.length} QR targets, got ${actual.length}`);
  }
  for (const expectedX of centers) {
    if (!actual.some((item) => Math.abs(item.x - expectedX) <= 0.025)) {
      throw new Error(`${test.name}: missed QR center ${expectedX}; actual=${actual.map((item) => item.x).join(",")}`);
    }
  }
  if (averageMs > maxAverageMs) {
    throw new Error(`${test.name}: QR detector too slow under degraded photo conditions: ${averageMs.toFixed(1)}ms average > ${maxAverageMs}ms budget`);
  }
  speedResults.push(`${test.name}=${averageMs.toFixed(1)}ms`);
}

console.log(`PASS QR photo contrast coverage: ${cases.map((test) => test.name).join(" | ")}`);
console.log(`PASS QR degraded-photo speed coverage: ${speedResults.join(" | ")}`);
