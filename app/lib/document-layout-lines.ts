import type { DocumentVariantName } from "./document-image-pipeline";
import type { DocumentRecognitionSession } from "./document-recognition-v2";

export type LayoutTextLine = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  wordCount: number;
  variant: DocumentVariantName;
  psm: string | number;
  variantSupport?: number;
};

export type LayoutLineRecognitionOptions = {
  variants?: DocumentVariantName[];
  psm?: string | number;
  minConfidence?: number;
  minTextLength?: number;
  maxLines?: number;
};

type TsvWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
};

const globalState = globalThis as typeof globalThis & {
  __icbOcrQueue?: Promise<void>;
};

async function serial<T>(job: () => Promise<T>): Promise<T> {
  const previous = globalState.__icbOcrQueue || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  globalState.__icbOcrQueue = previous.catch(() => {}).then(() => next);
  await previous.catch(() => {});
  try {
    return await job();
  } finally {
    release();
  }
}

function cleanText(text = "") {
  return String(text)
    .normalize("NFKC")
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function parseTsvLines(
  tsv: string,
  variant: DocumentVariantName,
  psm: string | number,
  minConfidence: number,
  minTextLength: number,
): LayoutTextLine[] {
  const groups = new Map<string, TsvWord[]>();
  const rows = String(tsv || "").split(/\n/);

  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i].split("\t");
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue;

    const confidence = Number(cols[10]);
    const text = cleanText(cols.slice(11).join("\t"));
    if (!text || !Number.isFinite(confidence) || confidence < 0) continue;

    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;

    const key = `${cols[1]}-${cols[2]}-${cols[3]}-${cols[4]}`;
    const list = groups.get(key) || [];
    list.push({ text, left, top, width, height, confidence });
    groups.set(key, list);
  }

  const lines: LayoutTextLine[] = [];
  for (const words of groups.values()) {
    const sorted = [...words].sort((a, b) => a.left - b.left);
    const text = cleanText(sorted.map(word => word.text).join(" "));
    const compactLength = [...text.replace(/\s/g, "")].length;
    if (compactLength < minTextLength) continue;

    let weightedConfidence = 0;
    let totalChars = 0;
    for (const word of sorted) {
      const chars = Math.max(1, [...word.text.replace(/\s/g, "")].length);
      weightedConfidence += word.confidence * chars;
      totalChars += chars;
    }
    const confidence = totalChars ? weightedConfidence / totalChars : 0;
    if (confidence < minConfidence) continue;

    const left = Math.min(...sorted.map(word => word.left));
    const top = Math.min(...sorted.map(word => word.top));
    const right = Math.max(...sorted.map(word => word.left + word.width));
    const bottom = Math.max(...sorted.map(word => word.top + word.height));
    lines.push({
      text,
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      confidence,
      wordCount: sorted.length,
      variant,
      psm,
      variantSupport: 1,
    });
  }

  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

function compactLength(text = "") {
  return [...String(text).replace(/\s/g, "")].length;
}

function informationScore(line: LayoutTextLine) {
  const text = cleanText(line.text);
  const length = compactLength(text);
  const punctuation = [...text].filter(ch => /[-_=|｜ー―~〜.・:：,，\/\\]/.test(ch)).length;
  const punctuationRatio = length ? punctuation / length : 1;
  let score = line.confidence * 0.58 + Math.min(32, length) * 0.9;
  if (/\d/.test(text)) score += 10;
  if (/[A-Za-z]/.test(text)) score += 9;
  if (/[ぁ-んァ-ヶ一-龠]/.test(text)) score += 8;
  if (length <= 2) score -= 26;
  if (punctuationRatio > 0.55) score -= 30;
  return score;
}

function horizontalOverlap(a: LayoutTextLine, b: LayoutTextLine) {
  const overlap = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

function samePhysicalRow(a: LayoutTextLine, b: LayoutTextLine) {
  const ay = a.top + a.height / 2;
  const by = b.top + b.height / 2;
  const yTolerance = Math.max(5, Math.max(a.height, b.height) * 0.82);
  if (Math.abs(ay - by) > yTolerance) return false;
  if (horizontalOverlap(a, b) >= 0.34) return true;
  const ax = a.left + a.width / 2;
  const bx = b.left + b.width / 2;
  return Math.abs(ax - bx) <= Math.max(a.width, b.width) * 0.24;
}

function fuseVariantLines(lines: LayoutTextLine[]) {
  const groups: LayoutTextLine[][] = [];
  for (const line of lines.sort((a, b) => a.top - b.top || a.left - b.left)) {
    let best: LayoutTextLine[] | null = null;
    let bestDistance = Infinity;
    for (const group of groups) {
      const reference = [...group].sort((a, b) => informationScore(b) - informationScore(a))[0];
      if (!samePhysicalRow(reference, line)) continue;
      const dy = Math.abs((reference.top + reference.height / 2) - (line.top + line.height / 2));
      if (dy < bestDistance) {
        bestDistance = dy;
        best = group;
      }
    }
    if (best) best.push(line);
    else groups.push([line]);
  }

  return groups.map(group => {
    const strongest = [...group].sort((a, b) => informationScore(b) - informationScore(a))[0];
    const variants = new Set(group.map(item => item.variant)).size;
    const weightedConfidence = group.reduce((sum, item) => sum + item.confidence * Math.max(1, compactLength(item.text)), 0);
    const chars = group.reduce((sum, item) => sum + Math.max(1, compactLength(item.text)), 0);
    return {
      ...strongest,
      confidence: Math.max(strongest.confidence, chars ? weightedConfidence / chars : strongest.confidence),
      variantSupport: variants,
    };
  }).sort((a, b) => a.top - b.top || a.left - b.left);
}

/**
 * Rebuilds text rows from Tesseract TSV geometry. Ruled forms are hostile to
 * dark-pixel row detection, so we ask multiple preprocessing variants where words
 * are, then fuse rows that occupy the same physical place. No single variant gets
 * to end the search early: a plate number may be best in adaptive threshold while
 * an engine/model code is best in contrast.
 */
export async function recognizeDocumentLayoutLines(
  session: DocumentRecognitionSession,
  worker: any,
  options: LayoutLineRecognitionOptions = {},
): Promise<LayoutTextLine[]> {
  return serial(async () => {
    const variants = options.variants?.length
      ? options.variants
      : (["contrast", "original", "adaptiveBinary"] as DocumentVariantName[]);
    const psm = options.psm ?? "11";
    const minConfidence = Math.max(0, Math.min(95, options.minConfidence ?? 18));
    const minTextLength = Math.max(1, options.minTextLength ?? 2);
    const maxLines = Math.max(4, Math.min(240, options.maxLines ?? 120));
    const all: LayoutTextLine[] = [];

    for (const variant of variants) {
      const source = session.prepared.variants[variant];
      if (!source) continue;
      await worker.setParameters({
        tessedit_pageseg_mode: String(psm),
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_char_whitelist: "",
      });
      const raw = await worker.recognize(source, {}, { text: true, tsv: true });
      all.push(...parseTsvLines(
        String(raw?.data?.tsv || ""),
        variant,
        psm,
        minConfidence,
        minTextLength,
      ));
    }

    return fuseVariantLines(all)
      .sort((a, b) => informationScore(b) - informationScore(a))
      .slice(0, maxLines)
      .sort((a, b) => a.top - b.top || a.left - b.left);
  });
}
