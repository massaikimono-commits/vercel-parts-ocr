export type CropBox = { x: number; y: number; w: number; h: number };
export type RowBand = { top: number; bottom: number; center: number; source: "rules" | "tsv" };

type TsvWord = { text: string; left: number; top: number; width: number; height: number; conf: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function luminance(r: number, g: number, b: number) {
  return r * 0.20 + g * 0.72 + b * 0.08;
}

/**
 * Detect long dark horizontal structures inside the already-oriented, color-preserving paper image.
 * This intentionally does not assume firstRowY/rowStep. The thresholds are ratios of the detected
 * paper box so they scale with different camera distances/resolutions.
 */
export function detectHorizontalRuleBands(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  paper: CropBox,
) {
  const left = clamp(Math.round(paper.x + paper.w * 0.015), 0, imageWidth - 1);
  const right = clamp(Math.round(paper.x + paper.w * 0.985), left + 1, imageWidth);
  const top = clamp(Math.round(paper.y + paper.h * 0.18), 0, imageHeight - 1);
  const bottom = clamp(Math.round(paper.y + paper.h * 0.96), top + 1, imageHeight);
  const xStep = Math.max(1, Math.floor(paper.w / 900));
  const rowScores: Array<{ y: number; score: number }> = [];

  for (let y = top; y < bottom; y += 1) {
    let dark = 0;
    let sampled = 0;
    for (let x = left; x < right; x += xStep) {
      const p = (y * imageWidth + x) * 4;
      if (p < 0 || p + 2 >= rgba.length) continue;
      const l = luminance(rgba[p], rgba[p + 1], rgba[p + 2]);
      if (l < 118) dark += 1;
      sampled += 1;
    }
    rowScores.push({ y, score: sampled ? dark / sampled : 0 });
  }

  // A printed rule usually spans a substantial portion of the table width. We deliberately keep
  // this looser than a single-form hard threshold, then group adjacent scanlines into one rule.
  const minScore = 0.26;
  const active = rowScores.filter((item) => item.score >= minScore);
  const groups: Array<{ start: number; end: number; peak: number }> = [];
  for (const item of active) {
    const last = groups[groups.length - 1];
    if (!last || item.y > last.end + 2) groups.push({ start: item.y, end: item.y, peak: item.score });
    else {
      last.end = item.y;
      last.peak = Math.max(last.peak, item.score);
    }
  }

  const maxThickness = Math.max(2, Math.round(paper.h * 0.018));
  return groups
    .filter((group) => group.end - group.start + 1 <= maxThickness)
    .map((group) => ({
      start: group.start,
      end: group.end,
      center: Math.round((group.start + group.end) / 2),
      peak: group.peak,
    }));
}

/** Build candidate detail rows from gaps between detected horizontal rules. */
export function rowBandsFromRules(
  rules: Array<{ start: number; end: number; center: number }>,
  paper: CropBox,
): RowBand[] {
  if (rules.length < 2) return [];
  const sorted = [...rules].sort((a, b) => a.center - b.center);
  const minGap = Math.max(16, Math.round(paper.h * 0.018));
  const maxGap = Math.max(minGap + 1, Math.round(paper.h * 0.14));
  const candidates: RowBand[] = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const gap = b.start - a.end - 1;
    if (gap < minGap || gap > maxGap) continue;
    const top = a.end + 1;
    const bottom = b.start - 1;
    candidates.push({ top, bottom, center: Math.round((top + bottom) / 2), source: "rules" });
  }

  if (!candidates.length) return [];

  // Remove isolated large/small gaps using the median of this image, not a fixed pixel step.
  const heights = candidates.map((row) => row.bottom - row.top + 1).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  return candidates.filter((row) => {
    const h = row.bottom - row.top + 1;
    return h >= median * 0.50 && h <= median * 1.85;
  });
}

function parseTsvWords(tsv: string): TsvWord[] {
  const lines = String(tsv || "").split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const idx = (name: string) => header.indexOf(name);
  const textIdx = idx("text");
  const leftIdx = idx("left");
  const topIdx = idx("top");
  const widthIdx = idx("width");
  const heightIdx = idx("height");
  const confIdx = idx("conf");
  if ([textIdx, leftIdx, topIdx, widthIdx, heightIdx].some((x) => x < 0)) return [];

  const out: TsvWord[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    const text = String(c[textIdx] || "").trim();
    if (!text) continue;
    const left = Number(c[leftIdx]);
    const top = Number(c[topIdx]);
    const width = Number(c[widthIdx]);
    const height = Number(c[heightIdx]);
    const conf = confIdx >= 0 ? Number(c[confIdx]) : 0;
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    if (Number.isFinite(conf) && conf < 0) continue;
    out.push({ text, left, top, width, height, conf: Number.isFinite(conf) ? conf : 0 });
  }
  return out;
}

/**
 * TSV fallback/secondary evidence. Groups recognized word centers into text rows using each image's
 * median word height, so a row can still be discovered when a photographed rule is faint/broken.
 */
export function rowBandsFromTSV(tsv: string, paper: CropBox): RowBand[] {
  const words = parseTsvWords(tsv).filter((word) => {
    const cx = word.left + word.width / 2;
    const cy = word.top + word.height / 2;
    return cx >= paper.x && cx <= paper.x + paper.w && cy >= paper.y && cy <= paper.y + paper.h;
  });
  if (!words.length) return [];
  const heights = words.map((word) => word.height).sort((a, b) => a - b);
  const medianHeight = Math.max(4, heights[Math.floor(heights.length / 2)] || 4);
  const tolerance = Math.max(5, medianHeight * 0.75);
  const rows: Array<{ words: TsvWord[]; center: number }> = [];

  for (const word of words.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const center = word.top + word.height / 2;
    let best = rows.find((row) => Math.abs(row.center - center) <= tolerance);
    if (!best) {
      best = { words: [], center };
      rows.push(best);
    }
    best.words.push(word);
    best.center = best.words.reduce((sum, w) => sum + w.top + w.height / 2, 0) / best.words.length;
  }

  const minWords = 2;
  return rows
    .filter((row) => row.words.length >= minWords)
    .map((row) => {
      const top = Math.max(paper.y, Math.min(...row.words.map((w) => w.top)) - Math.round(medianHeight * 0.45));
      const bottom = Math.min(paper.y + paper.h - 1, Math.max(...row.words.map((w) => w.top + w.height)) + Math.round(medianHeight * 0.45));
      return { top, bottom, center: Math.round((top + bottom) / 2), source: "tsv" as const };
    })
    .sort((a, b) => a.center - b.center);
}

/** Merge rule-derived rows and TSV-derived rows without reintroducing a fixed rowStep. */
export function mergeDynamicRows(ruleRows: RowBand[], tsvRows: RowBand[], paper: CropBox): RowBand[] {
  const combined = [...ruleRows];
  const mergeDistance = Math.max(8, Math.round(paper.h * 0.018));
  for (const row of tsvRows) {
    const existing = combined.find((candidate) => Math.abs(candidate.center - row.center) <= mergeDistance);
    if (!existing) combined.push(row);
  }
  return combined
    .filter((row) => row.center >= paper.y + paper.h * 0.20 && row.center <= paper.y + paper.h * 0.96)
    .sort((a, b) => a.center - b.center);
}
