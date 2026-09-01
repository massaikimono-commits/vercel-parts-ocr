export type RegistrationNumberParts = {
  raw: string;
  place: string;
  classification: string;
  kana: string;
  serial: string;
  serialDisplay: string;
  canonical: string;
};

const PLACE_DOT = /[・･·•]/g;

function normalizeText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRegistrationSerial(value = "") {
  const compact = normalizeText(value)
    .replace(PLACE_DOT, "")
    .replace(/[.]/g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "");

  if (!/^\d{1,4}$/.test(compact)) return "";
  // 一連指定番号は「4桁固定」ではなく4桁以下。先頭不足分は0ではなく中点表示。
  return compact.replace(/^0+(?=\d)/, "") || "0";
}

export function formatRegistrationSerial(serial = "") {
  const value = normalizeRegistrationSerial(serial);
  if (!value) return "";
  return `${"・".repeat(Math.max(0, 4 - value.length))}${value}`;
}

/**
 * 日本の一般的なナンバープレートを構造化する。
 *
 * 例:
 *   なにわ 330 あ ・・・1
 *   品川 30A さ ・・12
 *   大阪 500 わ ・123
 *   練馬 480 り 12-34
 *
 * 一連指定番号は国交省上「4けた以下」なので、1〜4桁を許容する。
 * 分類番号は旧様式やローマ字導入後も扱えるよう、1〜3文字の数字/英字を許容する。
 */
export function parseRegistrationNumber(value = ""): RegistrationNumberParts | null {
  const raw = normalizeText(value);
  if (!raw) return null;

  const re = /([一-龠々ぁ-んァ-ヶ]{1,12})\s*([0-9A-Z]{1,3})\s*([ぁ-ん])\s*([・･·•.\d\s-]{1,12})/gi;
  const matches = [...raw.matchAll(re)];
  for (const match of matches) {
    const place = (match[1] || "").trim();
    const classification = (match[2] || "").toUpperCase();
    const kana = match[3] || "";
    const serial = normalizeRegistrationSerial(match[4] || "");
    if (!place || !classification || !kana || !serial) continue;

    const serialDisplay = formatRegistrationSerial(serial);
    return {
      raw,
      place,
      classification,
      kana,
      serial,
      serialDisplay,
      // アプリ内の正規形は中点を除いた実値を保存。画面表示はserialDisplayを必要に応じて使う。
      canonical: `${place} ${classification} ${kana} ${serial}`,
    };
  }

  return null;
}

export function registrationSearchKeys(value = "") {
  const parsed = parseRegistrationNumber(value);
  if (!parsed) return [];
  const padded = parsed.serial.padStart(4, "0");
  return [...new Set([
    parsed.canonical,
    `${parsed.place} ${parsed.classification} ${parsed.kana} ${parsed.serialDisplay}`,
    parsed.serial,
    padded,
    parsed.serialDisplay,
  ])];
}
