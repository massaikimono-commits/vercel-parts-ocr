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

function lineCompatible(a: OcrToken, b: OcrToken) {
  const ah = a.bbox.y1 - a.bbox.y0;
  const bh = b.bbox.y1 - b.bbox.y0;
  const cyA = (a.bbox.y0 + a.bbox.y1) / 2;
  const cyB = (b.bbox.y0 + b.bbox.y1) / 2;
  return Math.abs(cyA - cyB) <= Math.max(ah, bh) * 0.78;
}

function mergeBox(tokens: OcrToken[]) {
  return {
    x0: Math.min(...tokens.map(token => token.bbox.x0)),
    y0: Math.min(...tokens.map(token => token.bbox.y0)),
    x1: Math.max(...tokens.map(token => token.bbox.x1)),
    y1: Math.max(...tokens.map(token => token.bbox.y1)),
  };
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

  for (let start = 0; start < tokens.length; start += 1) {
    const group: OcrToken[] = [];
    for (let end = start; end < Math.min(tokens.length, start + maxTokens); end += 1) {
      if (group.length && !lineCompatible(group[group.length - 1], tokens[end])) break;
      group.push(tokens[end]);
      const raw = group.map(token => token.text).join("");
      if (!allowed(raw, rule)) continue;
      const text = compact(raw);
      if (!text) continue;

      for (const label of labels) {
        const target = compact(label);
        if (!target) continue;
        const similarity = ocrTextSimilarity(text, target);
        if (similarity < minSimilarity) continue;
        const avgConfidence = group.reduce((sum, token) => sum + token.confidence, 0) / group.length / 100;
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
 *
 * Unlike a "pick best then reject" strategy, semantic requirements are applied before
 * spatial consensus. If 車両番号 is the most visually similar OCR string while the
 * requested field is 車台番号, that wrong candidate is removed and the next valid
 * 車台番号 candidate can still win. The API is generic so parts-slip headers can use
 * the same mechanism for labels such as 定価 / 仕入 / 数量.
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
