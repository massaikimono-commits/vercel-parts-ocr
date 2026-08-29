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

// White lists also arrive photographed rather than scanned. Pin routing under harmless OCR
// spacing/order noise and background words, without committing any customer or vehicle data.
const whiteStressCases = [
  // Canonical three-column list, with unrelated background text around it.
  "背景メモ\n部品名 数量 単価\n交換予定 作業指示",
  // OCR can insert spaces inside Japanese headers after perspective correction.
  "部 品 名\n数 量\n単 価\n品番 ABC",
  // Reading order can be right-to-left or row-first on a rotated/tilted photo.
  "1,260 単価\n2 数量\nフィルター 部品名称",
  // One incidental yellow-table word must not steal a normal white list.
  "倉庫 メモ\n商品名 個数 希望小売価格\n備考",
  // Same white list photographed farther away can split all three headers onto separate rows.
  "作業票\n部 品 名\n数 量\n単 価\n交換部品一覧",
  // Full-width characters from Japanese OCR must normalize to the same routing result.
  "部品名\n数量\n単価\nフィルター ２ １，８００",
];

for (const [index, sample] of whiteStressCases.entries()) {
  const mode = semanticClassify(sample);
  if (mode !== "general") {
    throw new Error(`White stress regression ${index + 1}: expected general, got ${mode}`);
  }
}

// Proxy the important extraction contract of a white parts list: a single price column is
// retail/定価, never cost/仕入れ. These are anonymous OCR-like rows derived from the photographed
// layout, not real parts, prices, customers or vehicles.
function whiteSinglePriceRows(text) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/[，、]/g, ",")
    .replace(/\r/g, "");
  const rows = [];
  for (const raw of normalized.split(/\n+/)) {
    const line = raw.trim();
    if (!line || /部\s*品\s*名|数\s*量|単\s*価/.test(line) && !/\d/.test(line)) continue;
    const priceMatch = line.match(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{3,7})(?=\s|$)/);
    if (!priceMatch) continue;
    const before = line.slice(0, priceMatch.index ?? 0).trim();
    const qtyMatch = before.match(/(?:^|\s)(\d{1,3})(?=\s*$)/);
    const qty = qtyMatch ? String(Number(qtyMatch[1])) : "1";
    const name = before.replace(/(?:^|\s)\d{1,3}(?=\s*$)/, "").trim();
    rows.push({ name, qty, retail: priceMatch[1].replace(/,/g, ""), cost: "" });
  }
  return rows;
}

const whiteCaptureVariants = [
  "部品名 数量 単価\nエアフィルター 1 1,800\nワイパーゴム 2 950",
  "部 品 名\n数 量\n単 価\nエアフィルター １ １，８００\nワイパーゴム ２ ９５０",
  "背景メモ\n部品名 数量 単価\nエアフィルター    1    1800\nワイパーゴム 2 950\n作業指示",
];

const expectedWhiteRows = [
  { name: "エアフィルター", qty: "1", retail: "1800", cost: "" },
  { name: "ワイパーゴム", qty: "2", retail: "950", cost: "" },
];

for (const [index, sample] of whiteCaptureVariants.entries()) {
  const actual = whiteSinglePriceRows(sample);
  if (JSON.stringify(actual) !== JSON.stringify(expectedWhiteRows)) {
    throw new Error(`White extraction proxy ${index + 1}: expected ${JSON.stringify(expectedWhiteRows)}, got ${JSON.stringify(actual)}`);
  }
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
  // Repeated captures of the same yellow layout can move headers and row text around vertically.
  "棚番 C3\n匿名部品 2 1,500 900\n受注数\n背景メモ\n標準価格\n出庫数\n受注残 0",
  // A farther/tilted capture may preserve only the strongest dedicated headers plus generic words.
  "部品名 数量 単価\n受注数 出庫数\n標準価格\n別紙メモ",
];

for (const [index, sample] of yellowStressCases.entries()) {
  const mode = semanticClassify(sample);
  if (mode !== "dedicated") {
    throw new Error(`Yellow stress regression ${index + 1}: expected dedicated, got ${mode}`);
  }
}

console.log("PASS parts layout semantics: white generic routing and single-price=>定価 extraction proxies survive repeated-photo spacing/full-width/background noise; yellow dedicated markers keep priority under anonymized rotation/background/noise/multi-slip/repeated-capture stress");
