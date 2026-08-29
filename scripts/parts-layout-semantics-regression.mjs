import fs from "node:fs";

const general = fs.readFileSync(new URL("../app/ocr/general/page.tsx", import.meta.url), "utf8");
const auto = fs.readFileSync(new URL("../app/ocr/auto/page.tsx", import.meta.url), "utf8");

function extractLabels(key) {
  const m = general.match(new RegExp(`${key}: \\[([^\\]]+)\\]`));
  if (!m) throw new Error(`Could not find ${key} labels in general OCR source`);
  return m[1];
}

const retail = extractLabels("retail");
const cost = extractLabels("cost");

if (!retail.includes('"単価"')) {
  throw new Error("White/general parts list regression: 単価 must map to retail/定価");
}
if (cost.includes('"単価"')) {
  throw new Error("White/general parts list regression: 単価 must not map to cost/仕入れ");
}

for (const marker of ["受注数", "出庫数", "標準価格", "倉庫", "棚番", "受注残"]) {
  if (!auto.includes(`"${marker}"`)) {
    throw new Error(`Yellow dedicated slip regression: missing classifier marker ${marker}`);
  }
}

console.log("PASS parts layout semantics: white 単価=>定価, yellow dedicated markers preserved");
