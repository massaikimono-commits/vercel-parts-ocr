import type { CropBox, RowBand } from "../dynamic-rows";
import { applyProfileCostRule, detectSlipColumnProfile, profileHeaderTarget } from "../general/slip-profiles";

type Word = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
};

export type DiagnosticPartCandidate = {
  row: RowBand;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  amount: string;
  sourceWords: string[];
  accepted: boolean;
  reason: string;
};

function normalize(text: string) {
  return String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function digits(text: string) {
  return normalize(text).replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^0-9]/g, "");
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

  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const c = line.split("\t");
    const text = normalize(c[ti]);
    const left = Number(c[li]);
    const top = Number(c[yi]);
    const width = Number(c[wi]);
    const height = Number(c[hi]);
    const conf = ci >= 0 ? Number(c[ci]) : 0;
    if (!text || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
    if (Number.isFinite(conf) && conf < 0) return [];
    return [{ text, left, top, width, height, conf: Number.isFinite(conf) ? conf : 0 }];
  });
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
    if (Number.isFinite(value) && value >= 1 && value <= 999) return String(value);
  }
  return "";
}

function isHeaderOrTotal(text: string) {
  return /部品名称|部品名|品名|数量|個数|受注数|出庫数|定価|標準価格|単価|仕入|原価|仕切|金額|合計|小計|消費税/.test(normalize(text));
}

/**
 * Diagnostic-only TSV parser. It uses OCR word positions inside already-detected dynamic rows.
 * It does not change production parsing or fixed-row OCR. Columns are relative to the detected
 * paper box, so camera resolution does not become a fixed pixel dependency.
 */
export function parseDynamicDetailCandidates(tsv: string, rawText: string, paper: CropBox, rows: RowBand[]): DiagnosticPartCandidate[] {
  const words = parseWords(tsv);
  const profile = detectSlipColumnProfile(rawText);

  // Yellow dedicated-slip broad column bands. These are deliberately broad evidence windows,
  // not row locations. Row Y positions come only from rule/TSV dynamic detection.
  const yellowBands = {
    name: [0.02, 0.42],
    qty: [0.41, 0.48],
    retail: [0.47, 0.58],
    cost: [0.58, 0.70],
    amount: [0.70, 0.84],
  } as const;

  // Known white profile uses semantic header mapping. Its visible table is name / qty / unit / total.
  // The ratios are intentionally broad and only activated when the profile is positively detected.
  const whiteBands = {
    name: [0.02, 0.58],
    qty: [0.55, 0.67],
    retail: [0.64, 0.80],
    amount: [0.78, 0.98],
  } as const;

  const pick = (rowWords: Word[], range: readonly [number, number]) => rowWords
    .filter((word) => {
      const cx = word.left + word.width / 2;
      const rx = (cx - paper.x) / Math.max(1, paper.w);
      return rx >= range[0] && rx <= range[1];
    })
    .sort((a, b) => a.left - b.left)
    .map((word) => word.text);

  return rows.map((row) => {
    const rowWords = wordsInRow(words, row, paper).sort((a, b) => a.left - b.left);
    const sourceWords = rowWords.map((word) => word.text);
    const combined = sourceWords.join(" ");

    if (profile) {
      // Assert the profile semantics are the intended known-white definition before applying it.
      const unitTarget = profileHeaderTarget(profile, "単価");
      const nameTexts = pick(rowWords, whiteBands.name);
      const qtyTexts = pick(rowWords, whiteBands.qty);
      const retailTexts = pick(rowWords, whiteBands.retail);
      const amountTexts = pick(rowWords, whiteBands.amount);
      const name = normalize(nameTexts.join(" ")).replace(/^[-|｜\s]+|[-|｜\s]+$/g, "");
      const qty = quantity(qtyTexts);
      const retail = unitTarget === "retail" ? money(retailTexts) : "";
      const cost = applyProfileCostRule(profile, "");
      const amount = money(amountTexts);
      const accepted = Boolean(name && !isHeaderOrTotal(name) && (qty || retail || amount));
      return {
        row,
        name,
        qty,
        retail,
        cost,
        amount,
        sourceWords,
        accepted,
        reason: accepted ? "white-profile row evidence" : `white-profile rejected: ${combined || "empty"}`,
      };
    }

    const nameTexts = pick(rowWords, yellowBands.name);
    const qtyTexts = pick(rowWords, yellowBands.qty);
    const retailTexts = pick(rowWords, yellowBands.retail);
    const costTexts = pick(rowWords, yellowBands.cost);
    const amountTexts = pick(rowWords, yellowBands.amount);
    const name = normalize(nameTexts.join(" ")).replace(/^[-|｜\s]+|[-|｜\s]+$/g, "");
    const qty = quantity(qtyTexts);
    const retail = money(retailTexts);
    const cost = money(costTexts);
    const amount = money(amountTexts);
    const hasNumericEvidence = Boolean(qty || retail || cost || amount);
    const accepted = Boolean(name && !isHeaderOrTotal(name) && hasNumericEvidence);
    return {
      row,
      name,
      qty,
      retail,
      cost,
      amount,
      sourceWords,
      accepted,
      reason: accepted ? "dynamic row + positioned TSV evidence" : `rejected: ${combined || "empty"}`,
    };
  });
}
