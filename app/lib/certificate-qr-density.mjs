/**
 * Locate QR-like dense checkerboard regions before decoding.
 *
 * This is content-agnostic: it does not decode QR data. It only looks for
 * compact high-frequency square patterns in the lower part of a normalized
 * vehicle-certificate image so ZXing/jsQR can crop closer to the real symbols.
 */
export function detectCertificateQrDensityCenters(rgba, width, height, options = {}) {
  const data = rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array ? rgba : null;
  const w = Math.max(1, Number(width) || 0);
  const h = Math.max(1, Number(height) || 0);
  if (!data || data.length < w * h * 4 || w < 200 || h < 300) return [];

  const step = Math.max(1, Number(options.step) || 2);
  const yStart = Math.max(0, Math.floor(h * (Number(options.yStart) || 0.80)));
  const yEnd = Math.min(h, Math.ceil(h * (Number(options.yEnd) || 0.985)));
  const sxCount = Math.ceil(w / step);
  const syCount = Math.max(1, Math.ceil((yEnd - yStart) / step));
  const luma = new Uint8Array(sxCount * syCount);

  for (let sy = 0; sy < syCount; sy += 1) {
    const y = Math.min(h - 1, yStart + sy * step);
    for (let sx = 0; sx < sxCount; sx += 1) {
      const x = Math.min(w - 1, sx * step);
      const p = (y * w + x) * 4;
      luma[sy * sxCount + sx] = Math.round(
        data[p] * 0.22 + data[p + 1] * 0.70 + data[p + 2] * 0.08
      );
    }
  }

  const edge = new Uint8Array(sxCount * syCount);
  const diffThreshold = Math.max(18, Number(options.diffThreshold) || 35);
  for (let sy = 0; sy < syCount; sy += 1) {
    for (let sx = 0; sx < sxCount; sx += 1) {
      const here = luma[sy * sxCount + sx];
      let hit = false;
      if (sx + 1 < sxCount) {
        const right = luma[sy * sxCount + sx + 1];
        if (Math.abs(here - right) > diffThreshold) hit = true;
      }
      if (!hit && sy + 1 < syCount) {
        const down = luma[(sy + 1) * sxCount + sx];
        if (Math.abs(here - down) > diffThreshold) hit = true;
      }
      edge[sy * sxCount + sx] = hit ? 1 : 0;
    }
  }

  // QR finder/data modules create a dense edge patch. Look at overlapping
  // horizontal slices and keep the strongest density seen at each x.
  const sliceHeight = Math.max(8, Math.round((h * 0.05) / step));
  const sliceStride = Math.max(4, Math.floor(sliceHeight / 3));
  const profile = new Float32Array(sxCount);
  const colSums = new Uint16Array(sxCount);

  for (let start = 0; start + sliceHeight <= syCount; start += sliceStride) {
    colSums.fill(0);
    for (let sy = start; sy < start + sliceHeight; sy += 1) {
      const row = sy * sxCount;
      for (let sx = 0; sx < sxCount; sx += 1) colSums[sx] += edge[row + sx];
    }
    for (let sx = 0; sx < sxCount; sx += 1) {
      const density = colSums[sx] / sliceHeight;
      if (density > profile[sx]) profile[sx] = density;
    }
  }

  const smoothWindow = Math.max(5, Math.round((w * 0.045) / step));
  const smoothed = new Float32Array(sxCount);
  let rolling = 0;
  for (let sx = 0; sx < sxCount; sx += 1) {
    rolling += profile[sx];
    if (sx >= smoothWindow) rolling -= profile[sx - smoothWindow];
    const count = Math.min(sx + 1, smoothWindow);
    smoothed[sx] = rolling / Math.max(1, count);
  }

  const leftLimit = Math.floor(sxCount * 0.40);
  let maxScore = 0;
  for (let sx = leftLimit; sx < sxCount; sx += 1) {
    if (smoothed[sx] > maxScore) maxScore = smoothed[sx];
  }
  if (maxScore < 0.008) return [];

  const threshold = Math.max(0.008, maxScore * 0.35);
  const local = [];
  for (let sx = Math.max(1, leftLimit); sx < sxCount - 1; sx += 1) {
    const score = smoothed[sx];
    if (score < threshold) continue;
    if (score >= smoothed[sx - 1] && score >= smoothed[sx + 1]) local.push({ sx, score });
  }
  local.sort((a, b) => b.score - a.score);

  const minDistance = Math.max(4, Math.round((w * 0.045) / step));
  const maxCenters = maxScore < 0.05 ? 3 : 8;
  const selected = [];
  for (const item of local) {
    if (selected.some((picked) => Math.abs(picked.sx - item.sx) < minDistance)) continue;
    selected.push(item);
    if (selected.length >= maxCenters) break;
  }

  return selected
    .sort((a, b) => a.sx - b.sx)
    .map((item) => ({
      x: Math.max(0, Math.min(1, (item.sx * step) / w)),
      score: Number(item.score.toFixed(4)),
    }));
}
