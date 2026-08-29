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

const retail = extractLabels("retail");
const cost = extractLabels("cost");
const genericHeaders = extractAutoHeaders("genericHeaders");

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
  if (!auto.includes(`"${marker}"`)) {
    throw new Error(`Yellow dedicated slip regression: missing classifier marker ${marker}`);
  }
}

console.log("PASS parts layout semantics: white 部品名+数量+単価 routes generic and 単価=>定価; yellow dedicated markers stay higher priority");
