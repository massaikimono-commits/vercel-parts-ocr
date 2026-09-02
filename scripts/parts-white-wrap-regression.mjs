// Synthetic regression for photographed white parts lists.
// No customer, vehicle, real part number, or real price data is stored here.

function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[，、]/g, ",")
    .replace(/\r/g, "");
}

function parseWhiteRows(text) {
  const lines = normalize(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const rows = [];
  let pendingName = "";

  for (const line of lines) {
    if (/部\s*品\s*名|数\s*量|単\s*価/.test(line) && !/\d/.test(line)) continue;
    if (/^(背景|作業|備考|メモ)/.test(line)) continue;

    const priceMatch = line.match(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{3,7})(?=\s|$)/);
    if (!priceMatch) {
      if (!/\d/.test(line)) pendingName = pendingName ? `${pendingName} ${line}` : line;
      continue;
    }

    const before = line.slice(0, priceMatch.index ?? 0).trim();
    const qtyMatch = before.match(/(?:^|\s)(\d{1,3})(?=\s*$)/);
    const qty = qtyMatch ? String(Number(qtyMatch[1])) : "1";
    const inlineName = before.replace(/(?:^|\s)\d{1,3}(?=\s*$)/, "").trim();
    const name = [pendingName, inlineName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    rows.push({ name, qty, retail: priceMatch[1].replace(/,/g, ""), cost: "" });
    pendingName = "";
  }

  return rows;
}

const cases = [
  {
    name: "wrapped-name",
    text: "部品名 数量 単価\n匿名フィルター\nキット 1 1,800\n匿名ラバー 2 950",
    expected: [
      { name: "匿名フィルター キット", qty: "1", retail: "1800", cost: "" },
      { name: "匿名ラバー", qty: "2", retail: "950", cost: "" },
    ],
  },
  {
    name: "fullwidth-and-background",
    text: "背景メモ\n部 品 名\n数 量\n単 価\n匿名ガスケット\nセット １ １，２００\n作業指示",
    expected: [
      { name: "匿名ガスケット セット", qty: "1", retail: "1200", cost: "" },
    ],
  },
];

for (const test of cases) {
  const actual = parseWhiteRows(test.text);
  if (JSON.stringify(actual) !== JSON.stringify(test.expected)) {
    throw new Error(`${test.name}: expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(actual)}`);
  }
  if (actual.some((row) => row.cost !== "")) {
    throw new Error(`${test.name}: single-price white list must not populate cost/仕入れ`);
  }
}

console.log("PASS white photographed-list wrap regression: wrapped names, full-width digits, background text, and single-price=>定価 semantics");
