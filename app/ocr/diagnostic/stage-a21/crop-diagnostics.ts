"use client";

export type CropDiagnostic = {
  width: number;
  height: number;
  darkOccupancy: number;
  inkBBox: { x1: number; y1: number; x2: number; y2: number; width: number; height: number } | null;
  edgeTouch: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  marginsPx: { left: number | null; right: number | null; top: number | null; bottom: number | null };
  strongVerticalLines: Array<{ x: number; ratio: number }>;
  strongHorizontalLines: Array<{ y: number; ratio: number }>;
  tableLineLikely: boolean;
  truncationLikely: boolean;
  centroidSlope: number | null;
  skewLikeResidual: number | null;
  signal: boolean;
};

function gray(r: number, g: number, b: number) {
  return r * 0.20 + g * 0.72 + b * 0.08;
}

export function analyzeCellCrop(canvas: HTMLCanvasElement): CropDiagnostic {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("crop diagnostic canvas unavailable");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const inkThreshold = 205;
  const lineThreshold = 170;
  let dark = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const rowDark = new Uint32Array(height);
  const colDark = new Uint32Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = gray(data[i], data[i + 1], data[i + 2]);
      if (v < inkThreshold) {
        dark++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (v < lineThreshold) {
        rowDark[y]++;
        colDark[x]++;
      }
    }
  }

  const bbox = maxX >= 0 ? {
    x1: minX, y1: minY, x2: maxX, y2: maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  } : null;
  const margins = bbox ? {
    left: bbox.x1,
    right: width - 1 - bbox.x2,
    top: bbox.y1,
    bottom: height - 1 - bbox.y2,
  } : { left: null, right: null, top: null, bottom: null };
  const edgeAllowanceX = Math.max(2, Math.round(width * 0.015));
  const edgeAllowanceY = Math.max(2, Math.round(height * 0.04));
  const edgeTouch = bbox ? {
    left: bbox.x1 <= edgeAllowanceX,
    right: bbox.x2 >= width - 1 - edgeAllowanceX,
    top: bbox.y1 <= edgeAllowanceY,
    bottom: bbox.y2 >= height - 1 - edgeAllowanceY,
  } : { left: false, right: false, top: false, bottom: false };

  const strongVerticalLines = Array.from(colDark)
    .map((n, x) => ({ x, ratio: height ? n / height : 0 }))
    .filter((v) => v.ratio >= 0.72)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 12);
  const strongHorizontalLines = Array.from(rowDark)
    .map((n, y) => ({ y, ratio: width ? n / width : 0 }))
    .filter((v) => v.ratio >= 0.72)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 12);

  // Estimate residual text-line slope from dark-pixel centroids in x bins.
  const bins = 12;
  const points: Array<{ x: number; y: number }> = [];
  for (let b = 0; b < bins; b++) {
    const x1 = Math.floor(width * b / bins);
    const x2 = Math.max(x1 + 1, Math.floor(width * (b + 1) / bins));
    let sy = 0, n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = x1; x < x2; x++) {
        const i = (y * width + x) * 4;
        if (gray(data[i], data[i + 1], data[i + 2]) < inkThreshold) { sy += y; n++; }
      }
    }
    if (n >= 4) points.push({ x: (x1 + x2 - 1) / 2, y: sy / n });
  }
  let centroidSlope: number | null = null;
  let skewLikeResidual: number | null = null;
  if (points.length >= 3) {
    const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const my = points.reduce((s, p) => s + p.y, 0) / points.length;
    const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (den > 0) {
      centroidSlope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den;
      const mse = points.reduce((s, p) => s + (p.y - (my + centroidSlope! * (p.x - mx))) ** 2, 0) / points.length;
      skewLikeResidual = Math.sqrt(mse);
    }
  }

  const occupancy = width && height ? dark / (width * height) : 0;
  const truncationLikely = Boolean(bbox && (edgeTouch.left || edgeTouch.right || edgeTouch.top || edgeTouch.bottom));
  return {
    width,
    height,
    darkOccupancy: occupancy,
    inkBBox: bbox,
    edgeTouch,
    marginsPx: margins,
    strongVerticalLines,
    strongHorizontalLines,
    tableLineLikely: strongVerticalLines.length > 0 || strongHorizontalLines.length > 0,
    truncationLikely,
    centroidSlope,
    skewLikeResidual,
    signal: occupancy >= 0.0025,
  };
}
