import type { LabelAnchor } from "./document-layout-recognition";
import type { RelativeRegion } from "./document-recognition-v2";

export type GridValueRegion = {
  region: RelativeRegion;
  direction: "right" | "below";
  geometryScore: number;
};

function centerX(anchor: LabelAnchor) {
  return (anchor.bbox.x0 + anchor.bbox.x1) / 2;
}

function centerY(anchor: LabelAnchor) {
  return (anchor.bbox.y0 + anchor.bbox.y1) / 2;
}

function labelStartX(anchor: LabelAnchor) {
  return anchor.bbox.x0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toRegion(x0: number, y0: number, x1: number, y1: number, pageWidth: number, pageHeight: number): RelativeRegion | null {
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
 * Important detail: many form headers are left-aligned inside cells. Therefore label
 * centres are NOT reliable column centres when labels have different text lengths
 * (e.g. 車両総重量 / 長さ / 幅 / 高さ). We infer column starts from each label's x0
 * and place boundaries halfway between neighbouring starts. This generalises to parts
 * slips too, where column header lengths also vary widely.
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

  // Keep row matching conservative. A loose tolerance can accidentally treat the
  // next ruled row as a horizontal neighbour and collapse the current cell width.
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

  const inferredSpacingLeft = previous ? targetStart - labelStartX(previous) : 0;
  const inferredSpacingRight = next ? labelStartX(next) - targetStart : 0;

  const leftBoundary = previous
    ? (labelStartX(previous) + targetStart) / 2
    : Math.max(0, targetStart - Math.max(pageWidth * 0.018, inferredSpacingRight * 0.42));
  const rightBoundary = next
    ? (targetStart + labelStartX(next)) / 2
    : Math.min(
        pageWidth,
        targetStart + Math.max(pageWidth * 0.11, inferredSpacingLeft || targetHeight * 8),
      );

  // The next label row limits how far a value cell may extend vertically.
  const overlappingBelow = all
    .filter(item => item !== target)
    .filter(item => item.bbox.y0 > target.bbox.y1 + targetHeight * 0.45)
    .filter(item => {
      const x = labelStartX(item);
      return x >= leftBoundary - pageWidth * 0.012 && x <= rightBoundary + pageWidth * 0.012;
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const nextRowTop = overlappingBelow[0]?.bbox.y0 ?? Infinity;
  const marginX = Math.max(2, targetHeight * 0.14);
  const marginY = Math.max(2, targetHeight * 0.10);
  const maxBelowBottom = target.bbox.y1 + Math.max(targetHeight * 4.2, pageHeight * 0.046);
  const belowBottom = Math.min(
    maxBelowBottom,
    Number.isFinite(nextRowTop) ? nextRowTop - marginY : maxBelowBottom,
  );

  const out: GridValueRegion[] = [];

  // Value printed in the same ruled column below the header.
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
    out.push({ region: below, direction: "below", geometryScore: 0.68 + boundarySupport * 0.09 });
  }

  // Key/value forms sometimes put the value on the same baseline to the right.
  const rightLimit = next
    ? Math.max(target.bbox.x1 + marginX * 2, next.bbox.x0 - marginX)
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
