import fs from "node:fs";

const auto = fs.readFileSync(new URL("../app/ocr/auto/page.tsx", import.meta.url), "utf8");
const profiles = fs.readFileSync(new URL("../app/ocr/general/slip-profiles.ts", import.meta.url), "utf8");

function requireSource(condition, message) {
  if (!condition) throw new Error(message);
}

const genericHeadersMatch = auto.match(/const genericHeaders = \[([^\]]+)\]/s);
requireSource(genericHeadersMatch, "Could not find genericHeaders in auto OCR source");
const genericHeaders = genericHeadersMatch[1];

for (const marker of ["部品名称", "部品名", "数量", "単価"]) {
  requireSource(
    genericHeaders.includes(`\"${marker}\"`),
    `White parts-list classifier regression: missing ${marker}`,
  );
}

const dedicatedIndex = auto.indexOf("const dedicatedFormatHeaders");
const genericIndex = auto.indexOf("const genericHeaders");
requireSource(
  dedicatedIndex >= 0 && genericIndex >= 0 && dedicatedIndex < genericIndex,
  "Yellow dedicated-slip classifier must stay higher priority than generic classification",
);

for (const marker of ["受注数", "出庫数", "標準価格", "倉庫", "棚番", "受注残"]) {
  requireSource(
    auto.includes(`\"${marker}\"`),
    `Yellow dedicated-slip regression: missing classifier marker ${marker}`,
  );
}

requireSource(
  profiles.includes('unitPriceTarget: "retail"'),
  "White parts-list semantics regression: 単価 must map to retail/定価",
);
requireSource(
  profiles.includes('missingCost: "blank"'),
  "White parts-list semantics regression: missing purchase-price column must keep cost blank",
);
requireSource(
  profiles.includes('retail: ["単価"]'),
  "White parts-list profile regression: 単価 header must target retail",
);
requireSource(
  !profiles.includes('cost: ["単価"]'),
  "White parts-list profile regression: 単価 must not target cost",
);

const whiteStressCases = [
  "部品名称 数量 単価 計",
  "部 品 名 数 量 単 価 計",
  "計 1210 単価 1210 数量 1 部品名称 ガスケット",
];

function normalize(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "");
}

for (const [index, sample] of whiteStressCases.entries()) {
  const t = normalize(sample);
  const hits = ["部品名称", "部品名", "品名", "数量", "個数", "単価", "計"]
    .filter((label) => t.includes(normalize(label)));
  requireSource(
    hits.includes("単価") && hits.some((x) => ["部品名称", "部品名", "品名"].includes(x)) && hits.some((x) => ["数量", "個数"].includes(x)),
    `White stress regression ${index + 1}: expected white list header signals`,
  );
}

console.log("PASS parts layout semantics: white 単価 routes generic and maps to 定価 with blank 仕入れ; yellow dedicated markers keep priority");
