import type { LabelAnchor, OcrToken } from "./document-layout-recognition";
import type { RelativeRegion } from "./document-recognition-v2";

export type TokenSet = { name: string; tokens: OcrToken[] };
export type InferredValueRegion = {
  region: RelativeRegion;
  direction: "right" | "below";
  support: number;
  sources: string[];
};

type PixelBox = { x0: number; y0: number; x1: number; y1: number };

function centerY(box: PixelBox) {
  return (box.y0 + box.y1) / 2;
}

function height(box: PixelBox) {
  return Math.max(1, box.y1 - box.y0);
}

function horizontalOverlap(a: PixelBox, b: PixelBox) {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  return overlap / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
}

function toRelative(box: PixelBox, pageWidth: number, pageHeight: number, padX: number, padY: number): RelativeRegion {
  const x0 = Math.max(0, box.x0 - padX);
  const y0 = Math.max(0, box.y0 - padY);
  const x1 = Math.min(pageWidth, box.x1 + padX);
  const y1 = Math.min(pageHeight, box.y1 + padY);
  return {
    x: x0 / pageWidth,
    y: y0 / pageHeight,
    width: Math.max(0.01, (x1 - x0) / pageWidth),
    height: Math.max(0.01, (y1 - y0) / pageHeight),
  };
}

function inferRight(anchor: LabelAnchor, tokens: OcrToken[], pageWidth: number, pageHeight: number) {
  const anchorHeight = height(anchor.bbox);
  const sameRow = tokens
    .filter(token => token.bbox.x0 >= anchor.bbox.x1 - anchorHeight * 0.15)
    .filter(token => Math.abs(centerY(token.bbox) - centerY(anchor.bbox)) <= Math.max(anchorHeight, height(token.bbox)) * 1.05)
    .filter(token => horizontalOverlap(token.bbox, anchor.bbox) < 0.25)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (!sameRow.length) return null;

  const first = sameRow[0];
  const chosen = [first];
  const maxGap = Math.max(anchorHeight * 3.6, pageWidth * 0.045);
  const maxWidth = pageWidth * 0.48;
  let right = first.bbox.x1;
  for (const token of sameRow.slice(1)) {
    const gap = token.bbox.x0 - right;
    if (gap > maxGap) break;
    if (token.bbox.x1 - first.bbox.x0 > maxWidth) break;
    chosen.push(token);
    right = Math.max(right, token.bbox.x1);
  }

  const box = {
    x0: Math.min(...chosen.map(token => token.bbox.x0)),
    y0: Math.min(...chosen.map(token => token.bbox.y0)),
    x1: Math.max(...chosen.map(token => token.bbox.x1)),
    y1: Math.max(...chosen.map(token => token.bbox.y1)),
  };
  return toRelative(box, pageWidth, pageHeight, Math.max(8, anchorHeight * 0.5), Math.max(4, anchorHeight * 0.45));
}

function inferBelow(anchor: LabelAnchor, tokens: OcrToken[], pageWidth: number, pageHeight: number) {
  const anchorHeight = height(anchor.bbox);
  const maxDistance = Math.max(anchorHeight * 4.2, pageHeight * 0.045);
  const below = tokens
    .filter(token => token.bbox.y0 >= anchor.bbox.y1 - anchorHeight * 0.10)
    .filter(token => token.bbox.y0 - anchor.bbox.y1 <= maxDistance)
    .filter(token => horizontalOverlap(token.bbox, anchor.bbox) >= 0.20 || Math.abs(token.bbox.x0 - anchor.bbox.x0) <= pageWidth * 0.05)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  if (!below.length) return null;

  const firstY = below[0].bbox.y0;
  const row = below.filter(token => Math.abs(centerY(token.bbox) - centerY(below[0].bbox)) <= Math.max(anchorHeight, height(token.bbox)) * 1.15);
  if (!row.length) return null;
  const box = {
    x0: Math.min(...row.map(token => token.bbox.x0)),
    y0: Math.min(firstY, ...row.map(token => token.bbox.y0)),
    x1: Math.max(...row.map(token => token.bbox.x1)),
    y1: Math.max(...row.map(token => token.bbox.y1)),
  };
  return toRelative(box, pageWidth, pageHeight, Math.max(8, anchorHeight * 0.55), Math.max(4, anchorHeight * 0.45));
}

function regionDistance(a: RelativeRegion, b: RelativeRegion) {
  const acx = a.x + a.width / 2;
  const acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2;
  const bcy = b.y + b.height / 2;
  return Math.abs(acx - bcx) + Math.abs(acy - bcy) + Math.abs(a.width - b.width) * 0.35 + Math.abs(a.height - b.height) * 0.35;
}

function cluster(
  candidates: Array<{ region: RelativeRegion; direction: "right" | "below"; source: string }>,
) {
  const groups: typeof candidates[] = [];
  for (const candidate of candidates) {
    let best: typeof candidates | null = null;
    let bestDistance = Infinity;
    for (const group of groups) {
      if (group[0].direction !== candidate.direction) continue;
      const distance = Math.min(...group.map(item => regionDistance(item.region, candidate.region)));
      if (distance <= 0.085 && distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    }
    if (best) best.push(candidate);
    else groups.push([candidate]);
  }

  return groups.map(group => {
    const support = new Set(group.map(item => item.source)).size;
    const average = (pick: (region: RelativeRegion) => number) => group.reduce((sum, item) => sum + pick(item.region), 0) / group.length;
    return {
      region: {
        x: average(region => region.x),
        y: average(region => region.y),
        width: average(region => region.width),
        height: average(region => region.height),
      },
      direction: group[0].direction,
      support,
      sources: [...new Set(group.map(item => item.source))],
    } satisfies InferredValueRegion;
  }).sort((a, b) => b.support - a.support || (a.region.width * a.region.height) - (b.region.width * b.region.height));
}

/**
 * Generic label-to-value geometry inference. It does not know vehicle models,
 * suppliers, addresses, or sample values. It only follows OCR token positions:
 * first same-row tokens to the right, then the first nearby row below.
 */
export function inferValueRegionsFromTokens(
  anchor: LabelAnchor,
  tokenSets: TokenSet[],
  pageWidth: number,
  pageHeight: number,
): InferredValueRegion[] {
  const candidates: Array<{ region: RelativeRegion; direction: "right" | "below"; source: string }> = [];
  for (const set of tokenSets) {
    const right = inferRight(anchor, set.tokens, pageWidth, pageHeight);
    if (right) candidates.push({ region: right, direction: "right", source: set.name });
    const below = inferBelow(anchor, set.tokens, pageWidth, pageHeight);
    if (below) candidates.push({ region: below, direction: "below", source: set.name });
  }
  return cluster(candidates);
}
