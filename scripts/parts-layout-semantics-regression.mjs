import fs from "node:fs";

const general = fs.readFileSync(new URL("../app/ocr/general/page.tsx", import.meta.url), "utf8");
const auto = fs.readFileSync(new URL("../app/ocr/auto/page.tsx", import.meta.url), "utf8");

function extractLabels(key) {
  const m = general.match(new RegExp(`${key}: \\[([^\\]]+)\\]`));
  if (!m) throw new Error(`Could not find ${key} labels in general OCR source`);
  return m[1];
}

function extractAutoHeaders(key) {
  const m = auto.match(new RegExp(`const ${key} = \\[([^\\]]+)\\]`));
  if (!m) throw new Error(`Could not find ${key} in auto OCR classifier source`);
  return m[1];
}

function parseQuotedItems(source) {
  return [...source.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function normalize(text) {
  return text.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

const retail = extractLabels("retail");
const cost = extractLabels("cost");
const genericHeaders = extractAutoHeaders("genericHeaders");
const dedicatedFormatHeaders = extractAutoHeaders("dedicatedFormatHeaders");

if (!retail.includes('"単価"')) {
  throw new Error("White/general parts list regression: 単価 must map to retail/定価");
}
if (cost.includes('"単価"')) {
  throw new Error("White/general parts list regression: 単価 must not map to cost/仕入れ");
}
if (!genericHeaders.includes('"単価"')) {
  throw new Error("White parts list classifier regression: 単価 must be a generic header signal");
}
for (const marker of ["部品名", "数量", "単価"]) {
  if (!genericHeaders.includes(`"${marker}"`)) {
    throw new Error(`White parts list classifier regression: missing ${marker}`);
  }
}

const dedicatedIndex = auto.indexOf("const dedicatedFormatHeaders");
const genericIndex = auto.indexOf("const genericHeaders");
if (dedicatedIndex < 0 || genericIndex < 0 || dedicatedIndex >= genericIndex) {
  throw new Error("Yellow dedicated slip regression: dedicated classifier must run before generic classifier");
}

for (const marker of ["受注数", "出庫数", "標準価格", "倉庫", "棚番", "受注残"]) {
  if (!dedicatedFormatHeaders.includes(`"${marker}"`)) {
    throw new Error(`Yellow dedicated slip regression: missing classifier marker ${marker}`);
  }
}

// Uploaded yellow-slip photos include rotation, wrinkles, background notes and cases where
// multiple slips/other text are visible. Do not store those real images in this public repo.
// Instead, pin the classifier semantics with anonymized OCR-like strings whose reading order
// is intentionally scrambled and whose background contains generic white-list headers.
const dedicatedMarkers = parseQuotedItems(dedicatedFormatHeaders);
const genericMarkers = parseQuotedItems(genericHeaders);

function semanticClassify(text) {
  const t = normalize(text);
  const dedicatedHits = dedicatedMarkers.filter((x) => t.includes(normalize(x)));
  if (dedicatedHits.length >= 3) return "dedicated";
  const genericHits = genericMarkers.filter((x) => t.includes(normalize(x)));
  if (genericHits.length >= 3) return "general";
  return "unknown";
}

const yellowStressCases = [
  // Rotated/reading-order-scrambled OCR: rows may arrive before the table header.
  "品番A 1 900 405\n倉庫 0001\n標準価格\n出庫数\n棚番 X1\n受注残 0",
  // Background notes/A4 text must not steal priority from a dedicated yellow slip.
  "部品名 数量 単価 定価 仕入れ\n背景メモ\n受注数 出庫数 標準価格 倉庫 棚番",
  // Wrinkles/partial OCR can lose some columns; three dedicated markers are enough by design.
  "雑音 1234\n標準価格 2,100\n出庫数 1\n倉庫 0001\n手書きメモ",
  // Two yellow slips can appear in one photo. Duplicate/scrambled headers must stay dedicated.
  "受注残 0 棚番 A1\n標準価格 900 出庫数 1\n別伝票\n倉庫 0002 受注数 2 標準価格 1,200",
  // OCR may split a header across lines because of folds or perspective; surviving dedicated
  // markers still need to dominate generic-looking background words.
  "部品名 数量 単価\n受注数\n出庫数\n標準価格\n背景の定価 仕入れ\n棚番 B2",
];

for (const [index, sample] of yellowStressCases.entries()) {
  const mode = semanticClassify(sample);
  if (mode !== "dedicated") {
    throw new Error(`Yellow stress regression ${index + 1}: expected dedicated, got ${mode}`);
  }
}

console.log("PASS parts layout semantics: white 部品名+数量+単価 routes generic and 単価=>定価; yellow dedicated markers keep priority under anonymized rotation/background/noise/multi-slip stress");
