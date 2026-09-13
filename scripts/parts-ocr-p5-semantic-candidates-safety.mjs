import assert from "node:assert/strict";
import { compareSemanticMappingCandidates } from "../app/ocr/bakeoff/p5-semantic-candidates.mjs";

function t(text, x1, y1, x2, y2) {
  return { text, x1, y1, x2, y2, confidence: 0.9 };
}

const splitHeaders = [
  t("部品", 10, 10, 40, 24), t("名称", 42, 10, 72, 24),
  t("数", 120, 10, 132, 24), t("量", 134, 10, 146, 24),
  t("定", 210, 10, 222, 24), t("価", 224, 10, 236, 24),
  t("仕", 300, 10, 312, 24), t("入", 314, 10, 326, 24),
  t("FILTER", 12, 40, 70, 54), t("2", 124, 40, 135, 54), t("1200", 214, 40, 250, 54), t("800", 304, 40, 335, 54),
];

const split = compareSemanticMappingCandidates(splitHeaders);
const current = split.find((v) => v.variantId === "CURRENT");
const a = split.find((v) => v.variantId === "A_SPLIT_TOKEN_COMPOSITION");
const b = split.find((v) => v.variantId === "B_GENERALIZED_FUZZY");
const c = split.find((v) => v.variantId === "C_SOFT_HEADER_BAND");
assert.equal(current.wrongAutoConfirm, 0);
assert.equal(a.wrongAutoConfirm, 0);
assert.equal(b.wrongAutoConfirm, 0);
assert.equal(c.wrongAutoConfirm, 0);
assert.ok(a.mappedHeaderFieldCount >= 4, "A should compose split headers");
assert.ok(a.reconstructedRowCount > current.reconstructedRowCount, "A should improve reconstruction over CURRENT on split headers");
assert.ok(a.nonBlankNameCount > 0 && a.nonBlankQtyCount > 0 && a.nonBlankRetailCount > 0 && a.nonBlankCostCount > 0, "A should populate four fields");

const fuzzyHeaders = [
  t("部品名称", 10, 10, 72, 24),
  t("数童", 120, 10, 146, 24),
  t("定価", 210, 10, 236, 24),
  t("仕入", 300, 10, 326, 24),
  t("FILTER", 12, 40, 70, 54), t("2", 124, 40, 135, 54), t("1200", 214, 40, 250, 54), t("800", 304, 40, 335, 54),
];
const fuzzy = compareSemanticMappingCandidates(fuzzyHeaders);
const fuzzyA = fuzzy.find((v) => v.variantId === "A_SPLIT_TOKEN_COMPOSITION");
const fuzzyB = fuzzy.find((v) => v.variantId === "B_GENERALIZED_FUZZY");
assert.ok(fuzzyB.mappedHeaderFieldCount >= fuzzyA.mappedHeaderFieldCount, "B must not map fewer headers than A on generalized OCR confusion case");
assert.equal(fuzzyB.wrongAutoConfirm, 0);

const noise = [
  t("ABC", 10, 10, 40, 24), t("999", 100, 10, 130, 24), t("XYZ", 200, 10, 240, 24),
  t("ROW", 10, 40, 40, 54), t("1", 100, 40, 110, 54), t("2", 200, 40, 210, 54),
];
for (const variant of compareSemanticMappingCandidates(noise)) {
  assert.equal(variant.wrongAutoConfirm, 0);
  assert.equal(variant.manualReviewRequired, true);
  assert.equal(variant.mappedHeaderFieldCount, 0, `${variant.variantId} must fail closed on unrelated noise`);
}

console.log("P5 semantic candidate synthetic safety: PASS");
