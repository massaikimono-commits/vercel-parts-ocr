/**
 * Experimental browser-only QR candidate locator for vehicle-certificate photos.
 * Returns geometry only. It never decodes or logs QR payloads.
 */
export function detectCertificateQrDensityCandidates2D(rgba, width, height, options = {}) {
  const data = rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array ? rgba : null;
  const w = Math.max(1, Number(width) || 0);
  const h = Math.max(1, Number(height) || 0);
  if (!data || data.length < w * h * 4 || w < 240 || h < 360) return [];

  const sampleStep = Math.max(2, Number(options.sampleStep) || Math.round(Math.max(w, h) / 1100));
  const xStart = Math.max(0, Math.floor(w * (Number(options.xStart) || 0.34)));
  const xEnd = Math.min(w, Math.ceil(w * (Number(options.xEnd) || 0.99)));
  const yStart = Math.max(0, Math.floor(h * (Number(options.yStart) || 0.68)));
  const yEnd = Math.min(h, Math.ceil(h * (Number(options.yEnd) || 0.99)));

  const sw = Math.max(1, Math.ceil((xEnd - xStart) / sampleStep));
  const sh = Math.max(1, Math.ceil((yEnd - yStart) / sampleStep));
  const luma = new Uint8Array(sw * sh);

  for (let gy = 0; gy < sh; gy += 1) {
    const y = Math.min(h - 1, yStart + gy * sampleStep);
    for (let gx = 0; gx < sw; gx += 1) {
      const x = Math.min(w - 1, xStart + gx * sampleStep);
      const p = (y * w + x) * 4;
      luma[gy * sw + gx] = Math.round(data[p] * .22 + data[p + 1] * .70 + data[p + 2] * .08);
    }
  }

  const edge = new Uint8Array(sw * sh);
  const diffThreshold = Math.max(18, Number(options.diffThreshold) || 32);
  for (let gy = 0; gy < sh; gy += 1) {
    for (let gx = 0; gx < sw; gx += 1) {
      const here = luma[gy * sw + gx];
      let hits = 0;
      if (gx + 1 < sw && Math.abs(here - luma[gy * sw + gx + 1]) >= diffThreshold) hits += 1;
      if (gy + 1 < sh && Math.abs(here - luma[(gy + 1) * sw + gx]) >= diffThreshold) hits += 1;
      if (gx + 1 < sw && gy + 1 < sh && Math.abs(here - luma[(gy + 1) * sw + gx + 1]) >= diffThreshold) hits += 1;
      edge[gy * sw + gx] = hits ? 1 : 0;
    }
  }

  const integral = new Uint32Array((sw + 1) * (sh + 1));
  for (let gy = 0; gy < sh; gy += 1) {
    let row = 0;
    for (let gx = 0; gx < sw; gx += 1) {
      row += edge[gy * sw + gx];
      integral[(gy + 1) * (sw + 1) + gx + 1] = integral[gy * (sw + 1) + gx + 1] + row;
    }
  }
  const rectSum = (x0, y0, x1, y1) =>
    integral[y1 * (sw + 1) + x1]
    - integral[y0 * (sw + 1) + x1]
    - integral[y1 * (sw + 1) + x0]
    + integral[y0 * (sw + 1) + x0];

  const qrPixel = Math.max(24, w * (Number(options.windowWidthRel) || .055));
  const wx = Math.max(6, Math.round(qrPixel / sampleStep));
  const wy = Math.max(6, Math.round(qrPixel / sampleStep));
  const strideX = Math.max(2, Math.floor(wx / 5));
  const strideY = Math.max(2, Math.floor(wy / 5));
  const scored = [];

  for (let y0 = 0; y0 + wy <= sh; y0 += strideY) {
    for (let x0 = 0; x0 + wx <= sw; x0 += strideX) {
      const sum = rectSum(x0, y0, x0 + wx, y0 + wy);
      const density = sum / Math.max(1, wx * wy);
      if (density < .05) continue;
      const cxPx = xStart + (x0 + wx / 2) * sampleStep;
      const cyPx = yStart + (y0 + wy / 2) * sampleStep;
      scored.push({
        x: cxPx / w,
        y: cyPx / h,
        score: density,
        windowWidth: qrPixel / w,
        windowHeight: qrPixel / h,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const maxCandidates = Math.max(4, Math.min(12, Number(options.maxCandidates) || 8));
  const selected = [];
  for (const item of scored) {
    if (selected.some((p) =>
      Math.abs(p.x - item.x) < .038 &&
      Math.abs(p.y - item.y) < .028
    )) continue;
    selected.push(item);
    if (selected.length >= maxCandidates) break;
  }

  return selected
    .sort((a, b) => a.x - b.x)
    .map((item) => ({
      x: Number(item.x.toFixed(4)),
      y: Number(item.y.toFixed(4)),
      score: Number(item.score.toFixed(4)),
      windowWidth: Number(item.windowWidth.toFixed(4)),
      windowHeight: Number(item.windowHeight.toFixed(4)),
    }));
}
