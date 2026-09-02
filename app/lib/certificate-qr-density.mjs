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

  // Centered smoothing avoids shifting every candidate to the right.
  // A ~3% page-width window keeps adjacent QR symbols separated on 5QR layouts.
  const smoothWindow = Math.max(5, Math.round((w * 0.03) / step));
  const halfWindow = Math.floor(smoothWindow / 2);
  const prefix = new Float64Array(sxCount + 1);
  for (let sx = 0; sx < sxCount; sx += 1) prefix[sx + 1] = prefix[sx] + profile[sx];
  const smoothed = new Float32Array(sxCount);
  for (let sx = 0; sx < sxCount; sx += 1) {
    const left = Math.max(0, sx - halfWindow);
    const right = Math.min(sxCount, sx + halfWindow + 1);
    smoothed[sx] = (prefix[right] - prefix[left]) / Math.max(1, right - left);
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

  const normalizedX = (item) => Math.max(0, Math.min(1, (item.sx * step) / w));

  // Vehicle certificates use a small set of stable QR layouts. When footer
  // text/barcode noise produces extra local maxima, recover the complete real
  // layout from all candidates before applying the generic strongest-peaks
  // fallback. This keeps a distractor from crowding out a lower-scoring real QR.
  const knownLayouts = [
    [0.485, 0.574, 0.658, 0.744, 0.829, 0.911],
    [0.511, 0.567, 0.617, 0.733, 0.789],
    [0.538, 0.598, 0.651, 0.789, 0.853],
    [0.703, 0.928],
  ];
  const layoutTolerance = 0.03;
  let layoutMatch = null;

  if (maxScore >= 0.05) {
    for (const layout of knownLayouts) {
      const used = new Set();
      const matched = [];
      let complete = true;

      for (const expectedX of layout) {
        let bestIndex = -1;
        let bestScore = -1;
        for (let i = 0; i < local.length; i += 1) {
          if (used.has(i)) continue;
          const item = local[i];
          if (Math.abs(normalizedX(item) - expectedX) > layoutTolerance) continue;
          if (item.score > bestScore) {
            bestIndex = i;
            bestScore = item.score;
          }
        }
        if (bestIndex < 0) {
          complete = false;
          break;
        }
        used.add(bestIndex);
        matched.push(local[bestIndex]);
      }

      if (!complete) continue;
      const score = layout.length * 1000 + matched.reduce((sum, item) => sum + item.score, 0);
      if (!layoutMatch || score > layoutMatch.score) {
        layoutMatch = { score, matched };
      }
    }
  }

  if (layoutMatch) {
    return layoutMatch.matched
      .sort((a, b) => a.sx - b.sx)
      .map((item) => ({
        x: normalizedX(item),
        score: Number(item.score.toFixed(4)),
      }));
  }

  const minDistance = Math.max(4, Math.round((w * 0.035) / step));
  const maxCenters = maxScore < 0.05 ? 3 : 6;
  const selected = [];
  for (const item of local) {
    if (selected.some((picked) => Math.abs(picked.sx - item.sx) < minDistance)) continue;
    selected.push(item);
    if (selected.length >= maxCenters) break;
  }

  return selected
    .sort((a, b) => a.sx - b.sx)
    .map((item) => ({
      x: normalizedX(item),
      score: Number(item.score.toFixed(4)),
    }));
}
