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
  const maxCandidates = Math.max(6, Math.min(24, Number(options.maxCandidates) || 16));
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


/**
 * Collapse 2D density peaks into physical QR candidates without assuming a
 * fixed Y coordinate. The dominant row is chosen from the candidate geometry
 * and scores, then near-identical XY peaks are merged.
 */
export function clusterCertificateQrCandidates2D(candidates, options = {}) {
  const input = (Array.isArray(candidates) ? candidates : [])
    .map((item) => ({
      x: Number(item?.x),
      y: Number(item?.y),
      score: Math.max(0.0001, Number(item?.score) || 0),
      windowWidth: Number(item?.windowWidth) || 0,
      windowHeight: Number(item?.windowHeight) || 0,
    }))
    .filter((item) =>
      Number.isFinite(item.x) && item.x >= 0 && item.x <= 1 &&
      Number.isFinite(item.y) && item.y >= 0 && item.y <= 1
    );

  if (!input.length) {
    return {
      dominantRowY: null,
      inputCandidateCount: 0,
      rowClusterCount: 0,
      candidatePositionDuplicateRemovedCount: 0,
      discardedOffRowCount: 0,
      candidates: [],
    };
  }

  const rowTolerance = Math.max(.025, Math.min(.09, Number(options.rowTolerance) || .06));
  const xTolerance = Math.max(.025, Math.min(.07, Number(options.xTolerance) || .045));
  const maxCandidates = Math.max(2, Math.min(10, Number(options.maxCandidates) || 8));

  const rows = [];
  for (const point of [...input].sort((a, b) => b.score - a.score)) {
    let best = null;
    let bestDistance = Infinity;
    for (const row of rows) {
      const distance = Math.abs(point.y - row.y);
      if (distance <= rowTolerance && distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
    }
    if (!best) {
      rows.push({ y: point.y, weight: point.score, scoreSum: point.score, points: [point] });
      continue;
    }
    best.points.push(point);
    best.scoreSum += point.score;
    best.y = (best.y * best.weight + point.y * point.score) / (best.weight + point.score);
    best.weight += point.score;
  }

  const uniqueXCount = (points) => {
    const selected = [];
    for (const point of [...points].sort((a, b) => b.score - a.score)) {
      if (selected.some((known) => Math.abs(known.x - point.x) <= xTolerance)) continue;
      selected.push(point);
    }
    return selected.length;
  };

  rows.forEach((row) => {
    row.uniqueXCount = uniqueXCount(row.points);
    const xs = row.points.map((p) => p.x);
    row.xSpan = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    // QR rows have several distinct X positions and meaningful horizontal span.
    row.rank = row.uniqueXCount * 100 + Math.min(.6, row.xSpan) * 20 + row.scoreSum;
  });
  rows.sort((a, b) => b.rank - a.rank || b.scoreSum - a.scoreSum);
  const dominant = rows[0];

  const xClusters = [];
  for (const point of [...dominant.points].sort((a, b) => a.x - b.x || b.score - a.score)) {
    let cluster = xClusters.find((item) => Math.abs(item.x - point.x) <= xTolerance);
    if (!cluster) {
      xClusters.push({
        x: point.x,
        y: point.y,
        weight: point.score,
        scoreSum: point.score,
        points: [point],
      });
      continue;
    }
    cluster.points.push(point);
    cluster.scoreSum += point.score;
    cluster.x = (cluster.x * cluster.weight + point.x * point.score) / (cluster.weight + point.score);
    cluster.y = (cluster.y * cluster.weight + point.y * point.score) / (cluster.weight + point.score);
    cluster.weight += point.score;
  }

  const merged = xClusters
    .map((cluster) => {
      const strongest = [...cluster.points].sort((a, b) => b.score - a.score)[0];
      return {
        x: Number(cluster.x.toFixed(4)),
        y: Number(cluster.y.toFixed(4)),
        score: Number(strongest.score.toFixed(4)),
        windowWidth: Number(strongest.windowWidth.toFixed(4)),
        windowHeight: Number(strongest.windowHeight.toFixed(4)),
        mergedPeakCount: cluster.points.length,
      };
    })
    .sort((a, b) => a.x - b.x)
    .slice(0, maxCandidates);

  const discardedOffRowCount = input.length - dominant.points.length;
  const duplicateRemovedInRow = dominant.points.length - merged.length;

  return {
    dominantRowY: Number(dominant.y.toFixed(4)),
    inputCandidateCount: input.length,
    rowClusterCount: rows.length,
    candidatePositionDuplicateRemovedCount: Math.max(0, duplicateRemovedInRow),
    discardedOffRowCount: Math.max(0, discardedOffRowCount),
    candidates: merged,
  };
}
