import assert from "node:assert/strict";
import { reconstructTokenGrid } from "../app/ocr/bakeoff/p5-token-grid-core.mjs";

const token = (text, x1, y1, x2, y2) => ({ text, x1, y1, x2, y2 });

function normalCase() {
  return [
    token("部品名称", 10, 10, 110, 30), token("個数", 150, 10, 190, 30), token("定価", 240, 10, 285, 30), token("仕入", 340, 10, 385, 30),
    token("オイルフィルタ", 10, 60, 115, 80), token("2", 160, 60, 175, 80), token("1800", 240, 60, 285, 80), token("1200", 340, 60, 385, 80),
    token("ブレーキパッド", 10, 100, 120, 120), token("1", 160, 100, 175, 120), token("8200", 240, 100, 285, 120), token("6100", 340, 100, 385, 120),
  ];
}

const normal = reconstructTokenGrid(normalCase());
assert.equal(normal.stageDiagnostics.mappedHeaderFieldCount, 4);
assert.equal(normal.stageDiagnostics.reconstructedRowCount, 2);
assert.deepEqual(normal.rows[0].fields, { name: "オイルフィルタ", qty: "2", retail: "1800", cost: "1200" });
assert.deepEqual(normal.rows[1].fields, { name: "ブレーキパッド", qty: "1", retail: "8200", cost: "6100" });
assert.equal(normal.wrongAutoConfirm, 0);
assert.equal(normal.manualReviewRequired, true);

const shifted = reconstructTokenGrid(normalCase().map((t) => ({ ...t, x1: t.x1 + 77, x2: t.x2 + 77, y1: t.y1 + 25, y2: t.y2 + 25 })));
assert.deepEqual(shifted.rows.map((r) => r.fields), normal.rows.map((r) => r.fields));

const partialHeader = reconstructTokenGrid([
  token("部品名称", 10, 10, 110, 30), token("個数", 150, 10, 190, 30), token("オイル", 10, 60, 80, 80), token("1", 160, 60, 175, 80),
]);
assert.equal(partialHeader.manualReviewRequired, true);
assert.match(partialHeader.abstainReason, /header-mapping-incomplete/);
assert.equal(partialHeader.wrongAutoConfirm, 0);

const rowJitter = reconstructTokenGrid(normalCase().map((t, i) => ({ ...t, y1: t.y1 + (i % 3) - 1, y2: t.y2 + (i % 3) - 1 })));
assert.equal(rowJitter.stageDiagnostics.reconstructedRowCount, 2);
assert.deepEqual(rowJitter.rows.map((r) => r.fields), normal.rows.map((r) => r.fields));

console.log(JSON.stringify({
  ok: true,
  candidate: "P5 token-grid hybrid",
  cases: 4,
  normalRows: normal.stageDiagnostics.reconstructedRowCount,
  shiftedInvariant: true,
  jitterInvariant: true,
  failClosedPartialHeader: true,
  wrongAutoConfirm: 0,
}, null, 2));
