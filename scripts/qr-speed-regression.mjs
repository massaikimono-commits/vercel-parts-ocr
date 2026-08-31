import { performance } from "node:perf_hooks";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

function syntheticQrImage(width, height, centers, yCenter = 0.90) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  const size = Math.max(42, Math.round(width * 0.052));
  const cell = Math.max(3, Math.floor(size / 13));
  const cy = Math.floor(height * yCenter);
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
const cases = [
  { name: "kei-six", expected: 6, centers: [0.485, 0.574, 0.658, 0.744, 0.829, 0.911], yCenter: 0.90 },
  { name: "registered-five-left", expected: 5, centers: [0.511, 0.567, 0.617, 0.733, 0.789], yCenter: 0.90 },
  { name: "registered-five-right", expected: 5, centers: [0.538, 0.598, 0.651, 0.789, 0.853], yCenter: 0.90 },
  { name: "legacy-two", expected: 2, centers: [0.703, 0.928], yCenter: 0.90 },
  // Photo captures can shift the normalized certificate vertically. Keep the
  // density detector effective near both ends of its lower-page scan band.
  { name: "photo-shift-up", expected: 5, centers: [0.511, 0.567, 0.617, 0.733, 0.789], yCenter: 0.84 },
  // The production scan starts at 80% page height. A handheld photo can place
  // QR symbols just inside that edge, so keep a synthetic near-boundary target.
  { name: "photo-shift-up-edge", expected: 5, centers: [0.511, 0.567, 0.617, 0.733, 0.789], yCenter: 0.815 },
  { name: "photo-shift-down", expected: 5, centers: [0.538, 0.598, 0.651, 0.789, 0.853], yCenter: 0.955 },
  // Stronger downward framing still occurs in handheld photos. Pin useful QR
  // targeting close to the lower scan edge without widening the production band.
  { name: "photo-shift-down-edge", expected: 5, centers: [0.538, 0.598, 0.651, 0.789, 0.853], yCenter: 0.97 },
  // Horizontal framing can push symbols close to either side of the active scan window.
  // Keep these fully synthetic so no certificate content or personal data is stored.
  { name: "photo-shift-left-edge", expected: 1, centers: [0.435], yCenter: 0.90 },
  { name: "photo-shift-right-edge", expected: 1, centers: [0.965], yCenter: 0.90 },
  // Handheld framing can combine horizontal and vertical shifts. Pin all four
  // extreme in-window corners so boundary interactions cannot drop targets.
  { name: "photo-shift-upper-left-corner", expected: 1, centers: [0.435], yCenter: 0.815 },
  { name: "photo-shift-upper-right-corner", expected: 1, centers: [0.965], yCenter: 0.815 },
  { name: "photo-shift-lower-left-corner", expected: 1, centers: [0.435], yCenter: 0.97 },
  { name: "photo-shift-lower-right-corner", expected: 1, centers: [0.965], yCenter: 0.97 },
  // QR-like patches outside the lower/right scan window must not expand the
  // search area or create false candidates. These pin both scan boundaries.
  { name: "upper-page-decoy", expected: 0, centers: [0.72], yCenter: 0.50 },
  { name: "upper-boundary-decoy", expected: 0, centers: [0.72], yCenter: 0.77 },
  { name: "lower-left-decoy", expected: 0, centers: [0.22], yCenter: 0.90 },
  // Pin the left edge of the lower/right scan window. Keep the synthetic patch
  // fully before the 40% boundary so the regression tests the window itself,
  // rather than a patch whose pixels physically extend into the scan region.
  { name: "lower-left-boundary-decoy", expected: 0, centers: [0.37], yCenter: 0.90 },
];

const runs = 4;
// Deliberately generous to avoid flaky CI while catching accidental multi-second regressions.
const maxAverageMs = 750;
const results = [];

for (const test of cases) {
  const rgba = syntheticQrImage(width, height, test.centers, test.yCenter);

  // Warm-up keeps the budget focused on steady-state detector cost, not Node startup/JIT.
  detectCertificateQrDensityCenters(rgba, width, height);

  const started = performance.now();
  let centers = [];
  for (let i = 0; i < runs; i += 1) {
    centers = detectCertificateQrDensityCenters(rgba, width, height);
  }
  const elapsed = performance.now() - started;
  const average = elapsed / runs;

  if (test.expected === 0) {
    if (centers.length !== 0) {
      throw new Error(`QR speed fixture ${test.name} produced false targets: expected 0, got ${centers.length}`);
    }
  } else {
    if (centers.length < test.expected) {
      throw new Error(`QR speed fixture ${test.name} lost targets: expected >=${test.expected}, got ${centers.length}`);
    }
    for (const expectedX of test.centers) {
      if (!centers.some((item) => Math.abs(item.x - expectedX) <= 0.025)) {
        throw new Error(`QR speed fixture ${test.name} missed center ${expectedX}; actual=${centers.map((x) => x.x).join(",")}`);
      }
    }
  }
  if (average > maxAverageMs) {
    throw new Error(`QR density detector ${test.name} too slow: ${average.toFixed(1)}ms average > ${maxAverageMs}ms budget`);
  }
  results.push(`${test.name}=${average.toFixed(1)}ms/${centers.length}`);
}

console.log(`PASS QR density speed/layout coverage: ${results.join(" | ")}`);
