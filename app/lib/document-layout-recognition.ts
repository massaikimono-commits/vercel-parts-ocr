import { normalizeForOcrProfile, ocrTextSimilarity } from "./ocr-ensemble";

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrToken = {
  text: string;
  confidence: number;
  bbox: OcrBox;
};

export type LabelAnchor = {
  label: string;
  matchedText: string;
  confidence: number;
  bbox: OcrBox;
  tokens: OcrToken[];
};

function number(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tokenFromWord(word: any): OcrToken | null {
  const text = String(word?.text || "").trim();
  if (!text) return null;
  const box = word?.bbox || word?.boundingBox || {};
  const x0 = number(box.x0 ?? box.left ?? box.x, 0);
  const y0 = number(box.y0 ?? box.top ?? box.y, 0);
  const x1 = number(box.x1 ?? (box.left != null && box.width != null ? Number(box.left) + Number(box.width) : undefined), x0);
  const y1 = number(box.y1 ?? (box.top != null && box.height != null ? Number(box.top) + Number(box.height) : undefined), y0);
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    text,
    confidence: Math.max(0, Math.min(100, number(word?.confidence ?? word?.conf, 50))),
    bbox: { x0, y0, x1, y1 },
  };
}

function recursiveWords(node: any, out: any[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) recursiveWords(item, out);
    return;
  }
  if (typeof node !== "object") return;
  if (typeof node.text === "string" && node.bbox) out.push(node);
  for (const key of ["blocks", "paragraphs", "lines", "words", "symbols", "children"]) {
    if (node[key]) recursiveWords(node[key], out);
  }
}

/** Works with both Tesseract.js data.words and the nested blocks format. */
export function extractOcrTokens(data: any): OcrToken[] {
  const raw: any[] = [];
  if (Array.isArray(data?.words)) raw.push(...data.words);
  if (data?.blocks) recursiveWords(data.blocks, raw);
  const seen = new Set<string>();
  const out: OcrToken[] = [];
  for (const word of raw) {
    const token = tokenFromWord(word);
    if (!token) continue;
    const key = `${token.text}|${Math.round(token.bbox.x0)}|${Math.round(token.bbox.y0)}|${Math.round(token.bbox.x1)}|${Math.round(token.bbox.y1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out.sort((a, b) => {
    const ah = a.bbox.y1 - a.bbox.y0;
    const bh = b.bbox.y1 - b.bbox.y0;
    const tolerance = Math.max(4, Math.min(ah, bh) * 0.55);
    if (Math.abs(a.bbox.y0 - b.bbox.y0) <= tolerance) return a.bbox.x0 - b.bbox.x0;
    return a.bbox.y0 - b.bbox.y0;
  });
}

function mergeBox(tokens: OcrToken[]): OcrBox {
  return {
    x0: Math.min(...tokens.map(x => x.bbox.x0)),
    y0: Math.min(...tokens.map(x => x.bbox.y0)),
    x1: Math.max(...tokens.map(x => x.bbox.x1)),
    y1: Math.max(...tokens.map(x => x.bbox.y1)),
  };
}

function compactLabel(value = "") {
  return normalizeForOcrProfile(value, "japanese")
    .replace(/[\s\n:：・･.。()（）\[\]【】]/g, "")
    .replace(/[|｜]/g, "");
}

function sequenceText(tokens: OcrToken[]) {
  return compactLabel(tokens.map(x => x.text).join(""));
}

function lineCompatible(a: OcrToken, b: OcrToken) {
  const ah = a.bbox.y1 - a.bbox.y0;
  const bh = b.bbox.y1 - b.bbox.y0;
  const cyA = (a.bbox.y0 + a.bbox.y1) / 2;
  const cyB = (b.bbox.y0 + b.bbox.y1) / 2;
  return Math.abs(cyA - cyB) <= Math.max(ah, bh) * 0.8;
}

export function findLabelAnchor(
  tokens: OcrToken[],
  labels: string[],
  options: { minSimilarity?: number; maxTokens?: number } = {},
): LabelAnchor | null {
  const minSimilarity = options.minSimilarity ?? 0.58;
  const maxTokens = options.maxTokens ?? 8;
  let best: LabelAnchor | null = null;
  let bestScore = -Infinity;

  for (let start = 0; start < tokens.length; start++) {
    const group: OcrToken[] = [];
    for (let end = start; end < Math.min(tokens.length, start + maxTokens); end++) {
      if (group.length && !lineCompatible(group[group.length - 1], tokens[end])) break;
      group.push(tokens[end]);
      const text = sequenceText(group);
      if (!text) continue;
      for (const label of labels) {
        const target = compactLabel(label);
        if (!target) continue;
        const similarity = ocrTextSimilarity(text, target);
        const avgConfidence = group.reduce((sum, x) => sum + x.confidence, 0) / group.length / 100;
        const lengthPenalty = Math.abs(text.length - target.length) / Math.max(text.length, target.length, 1);
        const score = similarity * 0.78 + avgConfidence * 0.18 - lengthPenalty * 0.12;
        if (similarity < minSimilarity || score <= bestScore) continue;
        bestScore = score;
        best = {
          label,
          matchedText: group.map(x => x.text).join(""),
          confidence: Math.max(0, Math.min(1, score)),
          bbox: mergeBox(group),
          tokens: [...group],
        };
      }
    }
  }
  return best;
}

export function findAllLabelAnchors(
  tokens: OcrToken[],
  definitions: Record<string, string[]>,
  options: { minSimilarity?: number; maxTokens?: number } = {},
) {
  const out: Record<string, LabelAnchor | null> = {};
  for (const [key, labels] of Object.entries(definitions)) {
    out[key] = findLabelAnchor(tokens, labels, options);
  }
  return out;
}

export function relativeRegionFromAnchor(
  anchor: LabelAnchor,
  pageWidth: number,
  pageHeight: number,
  options: {
    direction?: "right" | "below";
    gap?: number;
    width?: number;
    height?: number;
    padY?: number;
  } = {},
) {
  const direction = options.direction ?? "right";
  const gap = options.gap ?? 0.008;
  const box = anchor.bbox;
  const labelHeight = Math.max(1, box.y1 - box.y0);

  let x0: number;
  let y0: number;
  let x1: number;
  let y1: number;
  if (direction === "right") {
    x0 = box.x1 / pageWidth + gap;
    y0 = box.y0 / pageHeight - (options.padY ?? 0.004);
    x1 = Math.min(0.99, x0 + (options.width ?? 0.40));
    y1 = Math.min(0.99, y0 + (options.height ?? Math.max(0.025, labelHeight / pageHeight * 1.45)));
  } else {
    x0 = box.x0 / pageWidth;
    y0 = box.y1 / pageHeight + gap;
    x1 = Math.min(0.99, x0 + (options.width ?? Math.max(0.20, (box.x1 - box.x0) / pageWidth * 1.8)));
    y1 = Math.min(0.99, y0 + (options.height ?? 0.055));
  }

  return {
    x: Math.max(0, Math.min(0.99, x0)),
    y: Math.max(0, Math.min(0.99, y0)),
    width: Math.max(0.01, x1 - x0),
    height: Math.max(0.01, y1 - y0),
  };
}

export function inferColumnRegions(
  anchors: Array<LabelAnchor | null>,
  pageWidth: number,
  pageHeight: number,
  options: { topPadding?: number; bottom?: number } = {},
) {
  const valid = anchors.filter((x): x is LabelAnchor => !!x).sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (!valid.length) return [];
  const top = Math.max(...valid.map(x => x.bbox.y1)) / pageHeight + (options.topPadding ?? 0.008);
  const bottom = options.bottom ?? 0.96;
  return valid.map((anchor, index) => {
    const center = (anchor.bbox.x0 + anchor.bbox.x1) / 2;
    const leftCenter = index > 0 ? (valid[index - 1].bbox.x0 + valid[index - 1].bbox.x1) / 2 : 0;
    const rightCenter = index + 1 < valid.length ? (valid[index + 1].bbox.x0 + valid[index + 1].bbox.x1) / 2 : pageWidth;
    const x0 = index > 0 ? (leftCenter + center) / 2 : Math.max(0, anchor.bbox.x0 - pageWidth * 0.04);
    const x1 = index + 1 < valid.length ? (center + rightCenter) / 2 : Math.min(pageWidth, anchor.bbox.x1 + pageWidth * 0.08);
    return {
      anchor,
      region: {
        x: x0 / pageWidth,
        y: top,
        width: Math.max(0.02, (x1 - x0) / pageWidth),
        height: Math.max(0.02, bottom - top),
      },
    };
  });
}
