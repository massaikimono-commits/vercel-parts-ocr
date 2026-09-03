export const TOP_HEADER_CROPS = [
  [0.52, 0.02, 0.46, 0.14],
  [0.58, 0.035, 0.39, 0.10],
];

export function normalizeTopHeaderText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function repairTopHeaderText(value = "") {
  return normalizeTopHeaderText(value)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和|伶和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");
}

function eraGregorianYear(era, yearText) {
  const year = yearText === "元" ? 1 : Number(yearText);
  if (!Number.isInteger(year) || year < 1 || year > 99) return 0;
  if (era === "令和") return 2018 + year;
  if (era === "平成") return 1988 + year;
  if (era === "昭和") return 1925 + year;
  return 0;
}

function isInsideEra(era, year, month, day) {
  const key = year * 10000 + month * 100 + day;
  if (era === "令和") return key >= 20190501;
  if (era === "平成") return key >= 19890108 && key <= 20190430;
  if (era === "昭和") return key >= 19261225 && key <= 19890107;
  return false;
}

function isValidEraDate(era, yearText, month, day) {
  const year = eraGregorianYear(era, yearText);
  if (!year || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return false;
  return isInsideEra(era, year, month, day);
}

export function parseTopHeaderDate(value = "") {
  const text = repairTopHeaderText(value);
  const m = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!isValidEraDate(m[1], m[2], month, day)) return "";
  const year = m[2] === "元" ? "元" : String(Number(m[2]));
  return `${m[1]}${year}年${month}月${day}日`;
}

export function parseTopHeaderDocumentNumber(value = "") {
  const text = normalizeTopHeaderText(value);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const labeled = lines.find((line) => /記録事項番号/.test(line));
  const candidates = [];
  if (labeled) candidates.push(labeled);
  candidates.push(...lines);
  for (const line of candidates) {
    const digits = line.replace(/[^0-9]/g, "");
    if (digits.length === 13) return digits;
    const direct = line.match(/(?:^|\D)(\d{13})(?:\D|$)/)?.[1];
    if (direct) return direct;
  }
  return "";
}

export function parseTopHeaderText(value = "") {
  return {
    recordDate: parseTopHeaderDate(value),
    documentNumber: parseTopHeaderDocumentNumber(value),
  };
}
