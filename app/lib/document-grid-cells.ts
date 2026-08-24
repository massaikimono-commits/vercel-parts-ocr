import type { LabelAnchor } from "./document-layout-recognition";
import type { RelativeRegion } from "./document-recognition-v2";

export type GridValueRegion = {
  region: RelativeRegion;
  direction: "right" | "below";
  geometryScore: number;
};

function centerY(anchor: LabelAnchor) {
  return (anchor.bbox.y0 + anchor.bbox.y1) / 2;
}

function labelStartX(anchor: LabelAnchor) {
  return anchor.bbox.x0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  x1 = clamp(x1, x0 + 1, pageWidth);
  y0 = clamp(y0, 0, pageHeight - 1);
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
 * Generic ruled-form cell inference.
 *
 * Labels in Japanese forms are commonly left-aligned inside each cell. The left edge
 * of a label is therefore a better approximation of the column start than the label
 * centre. A previous version used midpoints between label starts, which could leak the
 * previous column's numeric value into a short header such as 長さ / 幅 / 高さ.
 *
 * This helper contains no certificate-specific coordinates or values and is also used
 * by parts-slip table recognition.
 */
export function inferGridValueRegions(
  target: LabelAnchor,
  anchors: Record<string, LabelAnchor | null>,
  pageWidth: number,
  pageHeight: number,
): GridValueRegion[] {
  const all = Object.values(anchors).filter((item): item is LabelAnchor => !!item);
  const targetHeight = Math.max(1, target.bbox.y1 - target.bbox.y0);
  const targetCy = centerY(target);
  const rowTolerance = Math.max(targetHeight * 0.95, pageHeight * 0.009);

  const sameRow = all
    .filter(item => item !== target)
    .filter(item => Math.abs(centerY(item) - targetCy) <= rowTolerance)
    .sort((a, b) => labelStartX(a) - labelStartX(b));

  const targetStart = labelStartX(target);
  const previous = [...sameRow]
    .filter(item => labelStartX(item) < targetStart)
    .sort((a, b) => labelStartX(b) - labelStartX(a))[0] || null;
  const next = sameRow
    .filter(item => labelStartX(item) > targetStart)
    .sort((a, b) => labelStartX(a) - labelStartX(b))[0] || null;

  const spacingLeft = previous ? targetStart - labelStartX(previous) : 0;
  const spacingRight = next ? labelStartX(next) - targetStart : 0;
  const smallPad = Math.max(2, Math.min(pageWidth * 0.008, targetHeight * 0.35));

  // A left-aligned header starts close to the true cell start. Do not open the region
  // halfway into the previous column; only allow a small OCR-placement tolerance.
  const leftBoundary = Math.max(
    0,
    targetStart - Math.min(smallPad, spacingLeft ? spacingLeft * 0.12 : smallPad),
  );

  // The next label start is the strongest horizontal boundary available. Keep a small
  // gap so glyphs belonging to the next header/value cannot leak into this cell.
  const rightBoundary = next
    ? Math.max(target.bbox.x1 + smallPad, labelStartX(next) - smallPad)
    : Math.min(
        pageWidth,
        targetStart + Math.max(
          pageWidth * 0.11,
          spacingLeft ? spacingLeft * 0.94 : targetHeight * 8,
        ),
      );

  const overlappingBelow = all
    .filter(item => item !== target)
    .filter(item => item.bbox.y0 > target.bbox.y1 + targetHeight * 0.45)
    .filter(item => {
      const x = labelStartX(item);
      return x >= leftBoundary - pageWidth * 0.010 && x <= rightBoundary + pageWidth * 0.010;
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const nextRowTop = overlappingBelow[0]?.bbox.y0 ?? Infinity;
  const marginX = Math.max(2, targetHeight * 0.12);
  const marginY = Math.max(2, targetHeight * 0.10);
  const maxBelowBottom = target.bbox.y1 + Math.max(targetHeight * 4.2, pageHeight * 0.046);
  const belowBottom = Math.min(
    maxBelowBottom,
    Number.isFinite(nextRowTop) ? nextRowTop - marginY : maxBelowBottom,
  );

  const out: GridValueRegion[] = [];

  const below = toRegion(
    leftBoundary + marginX,
    target.bbox.y1 + marginY,
    rightBoundary - marginX,
    belowBottom,
    pageWidth,
    pageHeight,
  );
  if (below) {
    const boundarySupport = (previous ? 1 : 0) + (next ? 1 : 0) + (Number.isFinite(nextRowTop) ? 1 : 0);
    out.push({ region: below, direction: "below", geometryScore: 0.74 + boundarySupport * 0.08 });
  }

  const rightLimit = next
    ? Math.max(target.bbox.x1 + marginX * 2, labelStartX(next) - marginX)
    : Math.min(pageWidth, target.bbox.x1 + Math.max(pageWidth * 0.20, targetHeight * 11));
  const right = toRegion(
    target.bbox.x1 + marginX,
    target.bbox.y0 - targetHeight * 0.24,
    rightLimit,
    target.bbox.y1 + targetHeight * 0.34,
    pageWidth,
    pageHeight,
  );
  if (right) {
    out.push({
      region: right,
      direction: "right",
      geometryScore: next ? 0.88 : 0.72,
    });
  }

  return out.sort((a, b) => b.geometryScore - a.geometryScore);
}
