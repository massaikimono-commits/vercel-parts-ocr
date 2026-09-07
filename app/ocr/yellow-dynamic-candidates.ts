import {
  detectHorizontalRuleBands,
  mergeDynamicRows,
  rowBandsFromRules,
  rowBandsFromTSV,
  type CropBox,
  type RowBand,
} from "./dynamic-rows";

type Word = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
};

export type YellowDynamicCandidate = {
  row: RowBand;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  amount: string;
  sourceWords: string[];
  retailOk: boolean;
  costOk: boolean;
  hasNameEvidence: boolean;
  acceptedBeforeNameScore: boolean;
  reason: string;
};

export type YellowDynamicAnalysis = {
  rules: Array<{ start: number; end: number; center: number; peak: number }>;
  ruleRows: RowBand[];
  tsvRows: RowBand[];
  rows: RowBand[];
  candidates: YellowDynamicCandidate[];
};

function normalize(text: string) {
  return String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function digits(text: string) {
  return normalize(text)
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[^0-9]/g, "");
}

function parseWords(tsv: string): Word[] {
  const lines = String(tsv || "").split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const index = (name: string) => header.indexOf(name);
  const ti = index("text");
  const li = index("left");
  const yi = index("top");
  const wi = index("width");
  const hi = index("height");
  const ci = index("conf");
  if ([ti, li, yi, wi, hi].some((i) => i < 0)) return [];

  const words: Word[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    const text = normalize(c[ti]);
    const left = Number(c[li]);
    const top = Number(c[yi]);
    const width = Number(c[wi]);
    const height = Number(c[hi]);
    const conf = ci >= 0 ? Number(c[ci]) : 0;
    if (!text || ![left, top, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    if (Number.isFinite(conf) && conf < 0) continue;
    words.push({ text, left, top, width, height, conf: Number.isFinite(conf) ? conf : 0 });
  }
  return words;
}

function wordsInRow(words: Word[], row: RowBand, paper: CropBox) {
  return words.filter((word) => {
    const cx = word.left + word.width / 2;
    const cy = word.top + word.height / 2;
    return cx >= paper.x && cx <= paper.x + paper.w && cy >= row.top && cy <= row.bottom;
  });
}

function money(texts: string[]) {
  for (const text of texts) {
    const value = Number(digits(text));
    if (Number.isFinite(value) && value >= 100 && value <= 5000000) return String(value);
  }
  return "";
}

function quantity(texts: string[]) {
  for (const text of texts) {
    const value = Number(digits(text));
    if (Number.isFinite(value) && value >= 1 && value <= 99) return String(value);
  }
  return "";
}

function cleanName(text: string) {
  const value = normalize(text)
    .replace(/^[-|｜:：・.,\s]+|[-|｜:：・.,\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/品番|品名|部品名称|受注|出庫|標準価格|単価|金額|倉庫|棚番|受注残|合計|小計/.test(value)) return "";
  return value;
}

/**
 * Convert already-oriented, color-preserving geometry plus OCR TSV into dynamic yellow-slip
 * detail-row candidates. Y positions come only from detected rules / TSV word positions.
 * There is intentionally no firstRowY, rowStep, fixed row count, or two-empty-row early stop.
 *
 * Column ranges remain broad relative X bands for this known yellow slip family. They do not
 * determine row Y positions, and can later be replaced by detected vertical/header geometry.
 */
export function analyzeYellowDynamicCandidates(args: {
  rgba: Uint8ClampedArray;
  imageWidth: number;
  imageHeight: number;
  paper: CropBox;
  tsv: string;
}): YellowDynamicAnalysis {
  const { rgba, imageWidth, imageHeight, paper, tsv } = args;
  const rules = detectHorizontalRuleBands(rgba, imageWidth, imageHeight, paper);
  const ruleRows = rowBandsFromRules(rules, paper);
  const tsvRows = rowBandsFromTSV(tsv, paper);
  const rows = mergeDynamicRows(ruleRows, tsvRows, paper);
  const words = parseWords(tsv);

  const bands = {
    name: [0.02, 0.42],
    qty: [0.41, 0.48],
    retail: [0.47, 0.58],
    cost: [0.58, 0.70],
    amount: [0.70, 0.84],
  } as const;

  const pick = (rowWords: Word[], range: readonly [number, number]) => rowWords
    .filter((word) => {
      const cx = word.left + word.width / 2;
      const rx = (cx - paper.x) / Math.max(1, paper.w);
      return rx >= range[0] && rx <= range[1];
    })
    .sort((a, b) => a.left - b.left)
    .map((word) => word.text);

  const candidates = rows.map((row): YellowDynamicCandidate => {
    const rowWords = wordsInRow(words, row, paper).sort((a, b) => a.left - b.left);
    const sourceWords = rowWords.map((word) => word.text);
    const name = cleanName(pick(rowWords, bands.name).join(" "));
    const qty = quantity(pick(rowWords, bands.qty));
    const retail = money(pick(rowWords, bands.retail));
    const cost = money(pick(rowWords, bands.cost));
    const amount = money(pick(rowWords, bands.amount));
    const retailOk = Number(retail || 0) >= 100;
    const costOk = Number(cost || 0) >= 100;
    const hasNameEvidence = name.length >= 3;

    // This is intentionally only a pre-name-score gate. Production /ocr still owns the stronger
    // nameScore/dictionary decision until real-photo diagnostics prove the dynamic path.
    const acceptedBeforeNameScore = (retailOk && costOk) || (hasNameEvidence && (retailOk || costOk));
    const reason = acceptedBeforeNameScore
      ? "dynamic row has sufficient positioned TSV evidence"
      : `dynamic row rejected before nameScore: ${sourceWords.join(" ") || "empty"}`;

    return {
      row,
      name,
      qty,
      retail,
      cost,
      amount,
      sourceWords,
      retailOk,
      costOk,
      hasNameEvidence,
      acceptedBeforeNameScore,
      reason,
    };
  });

  return { rules, ruleRows, tsvRows, rows, candidates };
}
