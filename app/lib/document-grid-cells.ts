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
 * It never knows sample values, addresses, vehicle models, or suppliers. Instead it
 * treats neighboring labels on the same row as horizontal cell boundaries and the
 * next label row as a vertical boundary. This prevents a valid value in the next cell
 * from being mistaken for the current field.
 */
export function inferGridValueRegions(
  target: LabelAnchor,
  anchors: Record<string, LabelAnchor | null>,
  pageWidth: number,
  pageHeight: number,
): GridValueRegion[] {
  const all = Object.values(anchors).filter((item): item is LabelAnchor => !!item);
  const targetHeight = Math.max(1, target.bbox.y1 - target.bbox.y0);
  const targetCx = centerX(target);
  const targetCy = centerY(target);
  const rowTolerance = Math.max(targetHeight * 2.0, pageHeight * 0.018);

  const sameRow = all
    .filter(item => item !== target)
    .filter(item => Math.abs(centerY(item) - targetCy) <= rowTolerance)
    .sort((a, b) => centerX(a) - centerX(b));

  const previous = [...sameRow].filter(item => centerX(item) < targetCx).sort((a, b) => centerX(b) - centerX(a))[0] || null;
  const next = sameRow.filter(item => centerX(item) > targetCx).sort((a, b) => centerX(a) - centerX(b))[0] || null;

  const leftBoundary = previous
    ? (centerX(previous) + targetCx) / 2
    : Math.max(0, target.bbox.x0 - pageWidth * 0.035);
  const rightBoundary = next
    ? (targetCx + centerX(next)) / 2
    : Math.min(pageWidth, Math.max(target.bbox.x1 + pageWidth * 0.16, target.bbox.x1 + targetHeight * 8));

  const overlappingBelow = all
    .filter(item => item !== target)
    .filter(item => item.bbox.y0 > target.bbox.y1 + targetHeight * 0.55)
    .filter(item => centerX(item) >= leftBoundary - pageWidth * 0.015 && centerX(item) <= rightBoundary + pageWidth * 0.015)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const nextRowTop = overlappingBelow[0]?.bbox.y0 ?? Infinity;
  const marginX = Math.max(3, targetHeight * 0.20);
  const marginY = Math.max(2, targetHeight * 0.12);
  const maxBelowBottom = target.bbox.y1 + Math.max(targetHeight * 4.8, pageHeight * 0.052);
  const belowBottom = Math.min(
    maxBelowBottom,
    Number.isFinite(nextRowTop) ? nextRowTop - marginY : maxBelowBottom,
  );

  const out: GridValueRegion[] = [];

  // Values printed inside a box below a small header label.
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
    out.push({ region: below, direction: "below", geometryScore: 0.62 + boundarySupport * 0.10 });
  }

  // Values printed on the same baseline immediately to the right of a label.
  const rightLimit = next
    ? Math.max(target.bbox.x1 + marginX * 2, next.bbox.x0 - marginX)
    : Math.min(rightBoundary, target.bbox.x1 + pageWidth * 0.24);
  const right = toRegion(
    target.bbox.x1 + marginX,
    target.bbox.y0 - targetHeight * 0.32,
    rightLimit,
    target.bbox.y1 + targetHeight * 0.42,
    pageWidth,
    pageHeight,
  );
  if (right) {
    out.push({
      region: right,
      direction: "right",
      geometryScore: next ? 0.86 : 0.70,
    });
  }

  return out.sort((a, b) => b.geometryScore - a.geometryScore);
}
