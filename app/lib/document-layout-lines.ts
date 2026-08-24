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
    });
  }

  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

/**
 * Tesseract already knows where its words and lines are. On ruled forms, using that
 * geometry is much more reliable than trying to find text rows from dark-pixel density,
 * because horizontal table rules otherwise look like very strong "text bands".
 *
 * We normally try contrast first because it preserves thin Japanese strokes while
 * reducing background variation. Original is only used if contrast yields too few rows.
 */
export async function recognizeDocumentLayoutLines(
  session: DocumentRecognitionSession,
  worker: any,
  options: LayoutLineRecognitionOptions = {},
): Promise<LayoutTextLine[]> {
  return serial(async () => {
    const variants = options.variants?.length
      ? options.variants
      : (["contrast", "original"] as DocumentVariantName[]);
    const psm = options.psm ?? "11";
    const minConfidence = Math.max(0, Math.min(95, options.minConfidence ?? 18));
    const minTextLength = Math.max(1, options.minTextLength ?? 2);
    const maxLines = Math.max(4, Math.min(240, options.maxLines ?? 120));
    let best: LayoutTextLine[] = [];

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
      const lines = parseTsvLines(
        String(raw?.data?.tsv || ""),
        variant,
        psm,
        minConfidence,
        minTextLength,
      );
      if (lines.length > best.length) best = lines;
      if (lines.length >= 8) return lines.slice(0, maxLines);
    }

    return best.slice(0, maxLines);
  });
}
