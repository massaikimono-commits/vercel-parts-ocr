import { normalizeForOcrProfile, ocrTextSimilarity } from "./ocr-ensemble";
import type { LabelAnchor, OcrToken } from "./document-layout-recognition";

export type SemanticLabelRule = {
  all?: string[];
  any?: string[];
  none?: string[];
};

type TokenSet = { name: string; tokens: OcrToken[] };

type Options = {
  pageWidth: number;
  pageHeight: number;
  minSimilarity?: number;
  maxTokens?: number;
  xToleranceRatio?: number;
  yToleranceRatio?: number;
  maxCandidatesPerVariant?: number;
};

function compact(value = "") {
  return normalizeForOcrProfile(value, "japanese")
    .replace(/[\s\n:：・･.。()（）\[\]【】]/g, "")
    .replace(/[|｜]/g, "");
}

function semanticText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\s\u3000:：・･.。()（）\[\]【】|｜]/g, "");
}

function allowed(value: string, rule?: SemanticLabelRule) {
  if (!rule) return true;
  const text = semanticText(value);
  if (rule.all?.some(fragment => !text.includes(fragment))) return false;
  if (rule.any?.length && !rule.any.some(fragment => text.includes(fragment))) return false;
  if (rule.none?.some(fragment => text.includes(fragment))) return false;
  return true;
}

function mergeBox(tokens: OcrToken[]) {
  return {
    x0: Math.min(...tokens.map(token => token.bbox.x0)),
    y0: Math.min(...tokens.map(token => token.bbox.y0)),
    x1: Math.max(...tokens.map(token => token.bbox.x1)),
    y1: Math.max(...tokens.map(token => token.bbox.y1)),
  };
}

function tokenCenterY(token: OcrToken) {
  return (token.bbox.y0 + token.bbox.y1) / 2;
}

function tokenHeight(token: OcrToken) {
  return Math.max(1, token.bbox.y1 - token.bbox.y0);
}

/**
 * Rebuild visual text lines from OCR geometry instead of trusting Tesseract's token order.
 * Ruled forms frequently return neighbouring cells out of reading order; reconstructing
 * lines by Y/X position lets split labels such as 車台 + 番号 become candidates again.
 */
function spatialLines(tokens: OcrToken[], options: Options) {
  const sorted = [...tokens]
    .filter(token => String(token.text || "").trim())
    .sort((a, b) => tokenCenterY(a) - tokenCenterY(b) || a.bbox.x0 - b.bbox.x0);

  const lines: Array<{ cy: number; height: number; tokens: OcrToken[] }> = [];
  for (const token of sorted) {
    const cy = tokenCenterY(token);
    const height = tokenHeight(token);
    let best: typeof lines[number] | null = null;
    let bestDistance = Infinity;

    for (const line of lines) {
      const tolerance = Math.max(height, line.height) * 0.72;
      const distance = Math.abs(cy - line.cy);
      if (distance <= tolerance && distance < bestDistance) {
        best = line;
        bestDistance = distance;
      }
    }

    if (!best) {
      lines.push({ cy, height, tokens: [token] });
      continue;
    }

    best.tokens.push(token);
    const count = best.tokens.length;
    best.cy = (best.cy * (count - 1) + cy) / count;
    best.height = Math.max(best.height, height);
  }

  return lines
    .sort((a, b) => a.cy - b.cy)
    .map(line => ({
      ...line,
      tokens: line.tokens.sort((a, b) => a.bbox.x0 - b.bbox.x0),
    }));
}

function averageAnchor(group: LabelAnchor[]) {
  const strongest = [...group].sort((a, b) => b.confidence - a.confidence)[0];
  const total = group.reduce((sum, anchor) => sum + Math.max(0.1, anchor.confidence), 0);
  const weighted = (pick: (anchor: LabelAnchor) => number) =>
    group.reduce((sum, anchor) => sum + pick(anchor) * Math.max(0.1, anchor.confidence), 0) / total;
  return {
    ...strongest,
    confidence: Math.min(
      1,
      group.reduce((sum, anchor) => sum + anchor.confidence, 0) / group.length
        + Math.min(0.18, (group.length - 1) * 0.07),
    ),
    bbox: {
      x0: weighted(anchor => anchor.bbox.x0),
      y0: weighted(anchor => anchor.bbox.y0),
      x1: weighted(anchor => anchor.bbox.x1),
      y1: weighted(anchor => anchor.bbox.y1),
    },
  } satisfies LabelAnchor;
}

function center(anchor: LabelAnchor) {
  return {
    x: (anchor.bbox.x0 + anchor.bbox.x1) / 2,
    y: (anchor.bbox.y0 + anchor.bbox.y1) / 2,
  };
}

function enumerateCandidates(
  tokens: OcrToken[],
  labels: string[],
  rule: SemanticLabelRule | undefined,
  options: Options,
) {
  const minSimilarity = options.minSimilarity ?? 0.58;
  const maxTokens = options.maxTokens ?? 8;
  const candidates: Array<LabelAnchor & { _score: number }> = [];
  const maxGap = Math.max(8, options.pageWidth * 0.022);

  for (const line of spatialLines(tokens, options)) {
    const lineTokens = line.tokens;
    for (let start = 0; start < lineTokens.length; start += 1) {
      const group: OcrToken[] = [];
      for (let end = start; end < Math.min(lineTokens.length, start + maxTokens); end += 1) {
        const token = lineTokens[end];
        if (group.length) {
          const previous = group[group.length - 1];
          const gap = token.bbox.x0 - previous.bbox.x1;
          const localHeight = Math.max(tokenHeight(previous), tokenHeight(token));
          if (gap > Math.max(maxGap, localHeight * 3.2)) break;
        }
        group.push(token);

        const raw = group.map(item => item.text).join("");
        if (!allowed(raw, rule)) continue;
        const text = compact(raw);
        if (!text) continue;

        for (const label of labels) {
          const target = compact(label);
          if (!target) continue;
          const similarity = ocrTextSimilarity(text, target);
          if (similarity < minSimilarity) continue;
          const avgConfidence = group.reduce((sum, item) => sum + item.confidence, 0) / group.length / 100;
          const lengthPenalty = Math.abs(text.length - target.length) / Math.max(text.length, target.length, 1);
          const score = similarity * 0.80 + avgConfidence * 0.18 - lengthPenalty * 0.14;
          candidates.push({
            label,
            matchedText: raw,
            confidence: Math.max(0, Math.min(1, score)),
            bbox: mergeBox(group),
            tokens: [...group],
            _score: score,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b._score - a._score);
  const deduped: Array<LabelAnchor & { _score: number }> = [];
  for (const candidate of candidates) {
    const c = center(candidate);
    const duplicate = deduped.some(existing => {
      const e = center(existing);
      const h = Math.max(1, candidate.bbox.y1 - candidate.bbox.y0, existing.bbox.y1 - existing.bbox.y0);
      return Math.abs(c.x - e.x) <= h * 0.7 && Math.abs(c.y - e.y) <= h * 0.7;
    });
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= (options.maxCandidatesPerVariant ?? 5)) break;
  }
  return deduped;
}

/**
 * Semantic-first label consensus.
 * Semantic requirements are applied before spatial consensus, then candidates from
 * different image variants are clustered by physical position.
 */
export function findSemanticConsensusLabelAnchors(
  tokenSets: TokenSet[],
  definitions: Record<string, string[]>,
  rules: Record<string, SemanticLabelRule>,
  options: Options,
) {
  const perVariant = tokenSets.map(set => {
    const candidates: Record<string, LabelAnchor[]> = {};
    for (const [key, labels] of Object.entries(definitions)) {
      candidates[key] = enumerateCandidates(set.tokens, labels, rules[key], options).map(({ _score, ...anchor }) => anchor);
    }
    return { name: set.name, candidates };
  });

  const out: Record<string, LabelAnchor | null> = {};
  const support: Record<string, number> = {};
  const xTolerance = options.pageWidth * (options.xToleranceRatio ?? 0.045);
  const yTolerance = options.pageHeight * (options.yToleranceRatio ?? 0.022);

  for (const key of Object.keys(definitions)) {
    const groups: Array<Array<{ variant: string; anchor: LabelAnchor }>> = [];

    for (const variant of perVariant) {
      for (const anchor of variant.candidates[key] || []) {
        const point = center(anchor);
        let bestGroup: Array<{ variant: string; anchor: LabelAnchor }> | null = null;
        let bestDistance = Infinity;

        for (const group of groups) {
          if (group.some(item => item.variant === variant.name)) continue;
          const reference = averageAnchor(group.map(item => item.anchor));
          const other = center(reference);
          const dx = Math.abs(point.x - other.x);
          const dy = Math.abs(point.y - other.y);
          if (dx > xTolerance || dy > yTolerance) continue;
          const distance = dx / Math.max(1, xTolerance) + dy / Math.max(1, yTolerance);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestGroup = group;
          }
        }

        if (bestGroup) bestGroup.push({ variant: variant.name, anchor });
        else groups.push([{ variant: variant.name, anchor }]);
      }
    }

    if (!groups.length) {
      out[key] = null;
      support[key] = 0;
      continue;
    }

    groups.sort((a, b) => {
      const score = (group: Array<{ variant: string; anchor: LabelAnchor }>) =>
        group.length * 1.55 + group.reduce((sum, item) => sum + item.anchor.confidence, 0);
      return score(b) - score(a);
    });

    const winner = groups[0];
    out[key] = averageAnchor(winner.map(item => item.anchor));
    support[key] = winner.length;
  }

  return { anchors: out, support, variants: perVariant };
}
