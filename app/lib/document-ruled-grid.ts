import type { LabelAnchor } from "./document-layout-recognition";
import type { RelativeRegion } from "./document-recognition-v2";

export type RuledValueRegion = {
  region: RelativeRegion;
  direction: "cell" | "right" | "below";
  geometryScore: number;
  lineConfidence: number;
};

type LineHit = { position: number; score: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function makeAnalysisCanvas(source: HTMLCanvasElement, maxWidth = 1800) {
  const scale = Math.min(1, maxWidth / Math.max(1, source.width));
  if (scale >= 0.999) return { canvas: source, scale: 1 };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

function clusterHits(hits: LineHit[], maxGap = 3) {
  const groups: LineHit[][] = [];
  for (const hit of hits.sort((a, b) => a.position - b.position)) {
    const current = groups[groups.length - 1];
    if (!current || hit.position - current[current.length - 1].position > maxGap) groups.push([hit]);
    else current.push(hit);
  }
  return groups.map(group => [...group].sort((a, b) => b.score - a.score)[0]);
}

function toRegion(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pageWidth: number,
  pageHeight: number,
): RelativeRegion | null {
  x0 = clamp(x0, 0, pageWidth - 1);
  y0 = clamp(y0, 0, pageHeight - 1);
  x1 = clamp(x1, x0 + 1, pageWidth);
  y1 = clamp(y1, y0 + 1, pageHeight);
  if (x1 - x0 < pageWidth * 0.008 || y1 - y0 < pageHeight * 0.006) return null;
  return {
    x: x0 / pageWidth,
    y: y0 / pageHeight,
    width: (x1 - x0) / pageWidth,
    height: (y1 - y0) / pageHeight,
  };
}

/**
 * Generic ruled-form detector.
 *
 * It does not know certificate coordinates. For each OCR label it finds the nearest
 * strong horizontal/vertical rules in the image and returns the current ruled cell,
 * its right neighbour and its lower neighbour. The same primitive can be reused for
 * parts slips and other tabular forms.
 */
export function createRuledGridDetector(source: HTMLCanvasElement) {
  const { canvas, scale } = makeAnalysisCanvas(source);
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, width, height).data;

  const isDark = (x: number, y: number) => {
    x = Math.round(clamp(x, 0, width - 1));
    y = Math.round(clamp(y, 0, height - 1));
    const index = (y * width + x) * 4;
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    return gray < 128;
  };

  const horizontalScore = (y: number, x0: number, x1: number) => {
    let dark = 0;
    let total = 0;
    let run = 0;
    let longest = 0;
    const step = Math.max(1, Math.round((x1 - x0) / 520));
    for (let x = x0; x <= x1; x += step) {
      const hit = isDark(x, y) || isDark(x, y - 1) || isDark(x, y + 1);
      total += 1;
      if (hit) {
        dark += 1;
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    if (!total) return 0;
    return Math.max(dark / total, (longest / total) * 1.08);
  };

  const verticalScore = (x: number, y0: number, y1: number) => {
    let dark = 0;
    let total = 0;
    let run = 0;
    let longest = 0;
    const step = Math.max(1, Math.round((y1 - y0) / 240));
    for (let y = y0; y <= y1; y += step) {
      const hit = isDark(x, y) || isDark(x - 1, y) || isDark(x + 1, y);
      total += 1;
      if (hit) {
        dark += 1;
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    if (!total) return 0;
    return Math.max(dark / total, longest / total);
  };

  const horizontalHits = (x0: number, x1: number, y0: number, y1: number, threshold = 0.30) => {
    const hits: LineHit[] = [];
    for (let y = Math.round(y0); y <= Math.round(y1); y += 1) {
      const score = horizontalScore(y, x0, x1);
      if (score >= threshold) hits.push({ position: y, score });
    }
    return clusterHits(hits, 3);
  };

  const verticalHits = (x0: number, x1: number, y0: number, y1: number, threshold = 0.58) => {
    const hits: LineHit[] = [];
    for (let x = Math.round(x0); x <= Math.round(x1); x += 1) {
      const score = verticalScore(x, y0, y1);
      if (score >= threshold) hits.push({ position: x, score });
    }
    return clusterHits(hits, 3);
  };

  const detect = (anchor: LabelAnchor, pageWidth: number, pageHeight: number): RuledValueRegion[] => {
    const ax0 = anchor.bbox.x0 * scale;
    const ax1 = anchor.bbox.x1 * scale;
    const ay0 = anchor.bbox.y0 * scale;
    const ay1 = anchor.bbox.y1 * scale;
    const anchorHeight = Math.max(4, ay1 - ay0);

    const scanX0 = Math.max(0, ax0 - width * 0.06);
    const scanX1 = Math.min(width - 1, ax1 + width * 0.34);
    const scanY0 = Math.max(0, ay0 - Math.max(anchorHeight * 4.0, height * 0.030));
    const scanY1 = Math.min(height - 1, ay1 + Math.max(anchorHeight * 8.0, height * 0.065));
    const hLines = horizontalHits(scanX0, scanX1, scanY0, scanY1);

    const top = [...hLines]
      .filter(line => line.position <= ay0 - Math.max(1, anchorHeight * 0.08))
      .sort((a, b) => b.position - a.position)[0] || null;
    const bottom = [...hLines]
      .filter(line => line.position >= ay1 + Math.max(1, anchorHeight * 0.08))
      .sort((a, b) => a.position - b.position)[0] || null;
    if (!top || !bottom || bottom.position - top.position < anchorHeight * 1.15) return [];

    const verticalScanX0 = Math.max(0, ax0 - width * 0.16);
    const verticalScanX1 = Math.min(width - 1, ax1 + width * 0.46);
    const vLines = verticalHits(verticalScanX0, verticalScanX1, top.position, bottom.position);
    const left = [...vLines]
      .filter(line => line.position <= ax0 - 1)
      .sort((a, b) => b.position - a.position)[0] || null;
    const right = [...vLines]
      .filter(line => line.position >= ax1 + 1)
      .sort((a, b) => a.position - b.position)[0] || null;
    if (!left || !right || right.position - left.position < Math.max(8, anchorHeight * 1.2)) return [];

    const nextRight = [...vLines]
      .filter(line => line.position >= right.position + Math.max(4, anchorHeight * 0.4))
      .sort((a, b) => a.position - b.position)[0] || null;

    const localH = horizontalHits(
      left.position,
      right.position,
      bottom.position + Math.max(3, anchorHeight * 0.25),
      Math.min(height - 1, bottom.position + Math.max(anchorHeight * 7.0, height * 0.055)),
      0.34,
    );
    const nextBelow = [...localH].sort((a, b) => a.position - b.position)[0] || null;

    const sx = pageWidth / width;
    const sy = pageHeight / height;
    const padX = Math.max(2, anchorHeight * 0.18) * sx;
    const padY = Math.max(2, anchorHeight * 0.14) * sy;
    const regions: RuledValueRegion[] = [];
    const baseConfidence = Math.min(top.score, bottom.score, left.score, right.score);

    const cell = toRegion(
      left.position * sx + padX,
      top.position * sy + padY,
      right.position * sx - padX,
      bottom.position * sy - padY,
      pageWidth,
      pageHeight,
    );
    if (cell) regions.push({
      region: cell,
      direction: "cell",
      geometryScore: 1.18 + baseConfidence * 0.28,
      lineConfidence: baseConfidence,
    });

    if (nextRight) {
      const rightConfidence = Math.min(baseConfidence, nextRight.score);
      const region = toRegion(
        right.position * sx + padX,
        top.position * sy + padY,
        nextRight.position * sx - padX,
        bottom.position * sy - padY,
        pageWidth,
        pageHeight,
      );
      if (region) regions.push({
        region,
        direction: "right",
        geometryScore: 1.08 + rightConfidence * 0.26,
        lineConfidence: rightConfidence,
      });
    }

    if (nextBelow) {
      const belowConfidence = Math.min(baseConfidence, nextBelow.score);
      const region = toRegion(
        left.position * sx + padX,
        bottom.position * sy + padY,
        right.position * sx - padX,
        nextBelow.position * sy - padY,
        pageWidth,
        pageHeight,
      );
      if (region) regions.push({
        region,
        direction: "below",
        geometryScore: 1.06 + belowConfidence * 0.24,
        lineConfidence: belowConfidence,
      });
    }

    return regions.sort((a, b) => b.geometryScore - a.geometryScore);
  };

  return { detect };
}
