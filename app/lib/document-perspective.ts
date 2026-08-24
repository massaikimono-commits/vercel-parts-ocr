export type PerspectiveGeometry = {
  applied: boolean;
  confidence: number;
  severity: number;
  topWidthRatio: number;
  bottomWidthRatio: number;
};

export type PerspectiveResult = PerspectiveGeometry & {
  canvas: HTMLCanvasElement;
};

type EdgePoint = { y: number; x: number };
type LineFit = { a: number; b: number; rmse: number; count: number };

function createCanvas(width: number, height: number) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width));
  out.height = Math.max(1, Math.round(height));
  return out;
}

function sampleCanvas(source: HTMLCanvasElement, maxSide = 720) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const out = createCanvas(source.width * scale, source.height * scale);
  out.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function paperMask(source: HTMLCanvasElement) {
  const ctx = source.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, source.width, source.height);
  const mask = new Uint8Array(source.width * source.height);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p++) {
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    // Generic paper cue: reasonably bright and not extremely saturated.
    if (luma >= 122 && max - min <= 92) mask[p] = 1;
  }
  return mask;
}

function runAt(mask: Uint8Array, width: number, height: number, x: number, y: number, direction: 1 | -1) {
  let hits = 0;
  for (let k = 0; k < 5; k++) {
    const xx = x + k * direction;
    if (xx < 0 || xx >= width || y < 0 || y >= height) continue;
    hits += mask[y * width + xx];
  }
  return hits >= 4;
}

function edgePoints(source: HTMLCanvasElement) {
  const mask = paperMask(source);
  const { width, height } = source;
  const left: EdgePoint[] = [];
  const right: EdgePoint[] = [];
  const rows: Array<{ y: number; left: number; right: number }> = [];

  for (let y = 2; y < height - 2; y += 2) {
    let lx = -1;
    let rx = -1;
    for (let x = 0; x < width - 5; x++) {
      if (runAt(mask, width, height, x, y, 1)) { lx = x; break; }
    }
    for (let x = width - 1; x >= 4; x--) {
      if (runAt(mask, width, height, x, y, -1)) { rx = x; break; }
    }
    if (lx < 0 || rx <= lx || rx - lx < width * 0.38) continue;
    rows.push({ y, left: lx, right: rx });
  }

  if (rows.length < Math.max(24, height * 0.18)) return { left, right, rows };

  // Use the central span of valid rows for edge fitting. Top/bottom borders often
  // contain rounded corners, clips, shadows, or background that would bias a line fit.
  const start = Math.floor(rows.length * 0.08);
  const end = Math.ceil(rows.length * 0.92);
  for (const row of rows.slice(start, end)) {
    left.push({ y: row.y, x: row.left });
    right.push({ y: row.y, x: row.right });
  }
  return { left, right, rows };
}

function fitLine(points: EdgePoint[]): LineFit | null {
  if (points.length < 12) return null;
  const fit = (items: EdgePoint[]) => {
    const n = items.length;
    let sumY = 0;
    let sumX = 0;
    let sumYY = 0;
    let sumYX = 0;
    for (const point of items) {
      sumY += point.y;
      sumX += point.x;
      sumYY += point.y * point.y;
      sumYX += point.y * point.x;
    }
    const denominator = n * sumYY - sumY * sumY;
    const a = Math.abs(denominator) < 1e-6 ? 0 : (n * sumYX - sumY * sumX) / denominator;
    const b = (sumX - a * sumY) / n;
    let error = 0;
    for (const point of items) {
      const residual = point.x - (a * point.y + b);
      error += residual * residual;
    }
    return { a, b, rmse: Math.sqrt(error / Math.max(1, n)), count: n };
  };

  const first = fit(points);
  const residuals = points
    .map(point => Math.abs(point.x - (first.a * point.y + first.b)))
    .sort((a, b) => a - b);
  const median = residuals[Math.floor(residuals.length / 2)] || 0;
  const limit = Math.max(3, median * 2.8);
  const filtered = points.filter(point => Math.abs(point.x - (first.a * point.y + first.b)) <= limit);
  return filtered.length >= 12 ? fit(filtered) : first;
}

function interpolateX(line: LineFit, y: number) {
  return line.a * y + line.b;
}

function warpHorizontalKeystone(
  source: HTMLCanvasElement,
  topY: number,
  bottomY: number,
  left: LineFit,
  right: LineFit,
) {
  const topLeft = interpolateX(left, topY);
  const topRight = interpolateX(right, topY);
  const bottomLeft = interpolateX(left, bottomY);
  const bottomRight = interpolateX(right, bottomY);
  const topWidth = topRight - topLeft;
  const bottomWidth = bottomRight - bottomLeft;
  const outWidth = Math.max(1, Math.round(Math.max(topWidth, bottomWidth)));
  const outHeight = Math.max(1, Math.round(bottomY - topY));
  const out = createCanvas(outWidth, outHeight);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Strip warping is much cheaper than a full per-pixel homography on iPhone and
  // directly fixes the common document-photo keystone: top and bottom widths differ.
  const step = 3;
  for (let dy = 0; dy < outHeight; dy += step) {
    const dh = Math.min(step, outHeight - dy);
    const t0 = dy / outHeight;
    const t1 = (dy + dh) / outHeight;
    const tm = (t0 + t1) / 2;
    const sy0 = topY + (bottomY - topY) * t0;
    const sy1 = topY + (bottomY - topY) * t1;
    const lx = topLeft + (bottomLeft - topLeft) * tm;
    const rx = topRight + (bottomRight - topRight) * tm;
    const sw = Math.max(1, rx - lx);
    const sh = Math.max(1, sy1 - sy0 + 0.75);
    ctx.drawImage(source, lx, sy0, sw, sh, 0, dy, outWidth, dh + 0.5);
  }
  return out;
}

/**
 * Conservative, generic keystone correction for photographed documents.
 * It never uses a document type or expected value. If paper edges are not clear or
 * the inferred geometry is extreme, it returns the original canvas unchanged.
 */
export function correctDocumentPerspective(source: HTMLCanvasElement): PerspectiveResult {
  const sample = sampleCanvas(source, 720);
  const edges = edgePoints(sample);
  const left = fitLine(edges.left);
  const right = fitLine(edges.right);
  if (!left || !right || edges.rows.length < 24) {
    sample.width = 1;
    sample.height = 1;
    return { canvas: source, applied: false, confidence: 0, severity: 0, topWidthRatio: 1, bottomWidthRatio: 1 };
  }

  const topY = edges.rows[Math.max(0, Math.floor(edges.rows.length * 0.025))]?.y ?? 0;
  const bottomY = edges.rows[Math.min(edges.rows.length - 1, Math.ceil(edges.rows.length * 0.975))]?.y ?? (sample.height - 1);
  const topLeft = interpolateX(left, topY);
  const topRight = interpolateX(right, topY);
  const bottomLeft = interpolateX(left, bottomY);
  const bottomRight = interpolateX(right, bottomY);
  const topWidth = topRight - topLeft;
  const bottomWidth = bottomRight - bottomLeft;
  const averageWidth = Math.max(1, (topWidth + bottomWidth) / 2);
  const severity = Math.abs(topWidth - bottomWidth) / averageWidth;
  const expectedRows = Math.max(1, sample.height / 2);
  const coverage = Math.min(1, edges.rows.length / expectedRows);
  const residualPenalty = Math.min(1, (left.rmse + right.rmse) / Math.max(1, sample.width * 0.025));
  const widthQuality = Math.min(1, Math.max(0, Math.min(topWidth, bottomWidth) / Math.max(1, sample.width * 0.55)));
  const confidence = Math.max(0, Math.min(1, coverage * 0.46 + (1 - residualPenalty) * 0.36 + widthQuality * 0.18));
  const topWidthRatio = topWidth / Math.max(1, sample.width);
  const bottomWidthRatio = bottomWidth / Math.max(1, sample.width);

  const shouldApply = confidence >= 0.70
    && severity >= 0.025
    && severity <= 0.26
    && topWidth > sample.width * 0.42
    && bottomWidth > sample.width * 0.42
    && bottomY - topY > sample.height * 0.45;

  if (!shouldApply) {
    sample.width = 1;
    sample.height = 1;
    return { canvas: source, applied: false, confidence, severity, topWidthRatio, bottomWidthRatio };
  }

  const sx = source.width / sample.width;
  const sy = source.height / sample.height;
  const scaledLeft: LineFit = { a: left.a * sx / sy, b: left.b * sx, rmse: left.rmse * sx, count: left.count };
  const scaledRight: LineFit = { a: right.a * sx / sy, b: right.b * sx, rmse: right.rmse * sx, count: right.count };
  const corrected = warpHorizontalKeystone(source, topY * sy, bottomY * sy, scaledLeft, scaledRight);
  sample.width = 1;
  sample.height = 1;
  return { canvas: corrected, applied: true, confidence, severity, topWidthRatio, bottomWidthRatio };
}
