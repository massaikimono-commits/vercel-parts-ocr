import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TOP_HEADER_CROPS,
  parseTopHeaderDate,
  parseTopHeaderDocumentNumber,
  parseTopHeaderText,
} from "../app/lib/certificate-fast-top-header.mjs";

const direct = parseTopHeaderText("記録年月日 令和8年9月3日\n記録事項番号 1234567890123");
assert.equal(direct.recordDate, "令和8年9月3日");
assert.equal(direct.documentNumber, "1234567890123");

assert.equal(parseTopHeaderDate("記録年月日 今和 8年 9月 3日"), "令和8年9月3日");
assert.equal(parseTopHeaderDate("令和0年9月3日"), "");
assert.equal(parseTopHeaderDate("令和8年19月3日"), "");
assert.equal(parseTopHeaderDate("令和8年2月31日"), "");
assert.equal(parseTopHeaderDate("令和2年2月29日"), "令和2年2月29日");
assert.equal(parseTopHeaderDate("令和3年2月29日"), "");
assert.equal(parseTopHeaderDate("令和元年4月30日"), "");
assert.equal(parseTopHeaderDate("令和元年5月1日"), "令和元年5月1日");
assert.equal(parseTopHeaderDate("平成元年1月7日"), "");
assert.equal(parseTopHeaderDate("平成元年1月8日"), "平成元年1月8日");
assert.equal(parseTopHeaderDate("平成28年2月29日"), "平成28年2月29日");
assert.equal(parseTopHeaderDate("平成31年5月1日"), "");
assert.equal(parseTopHeaderDate("昭和元年12月24日"), "");
assert.equal(parseTopHeaderDate("昭和元年12月25日"), "昭和元年12月25日");
assert.equal(parseTopHeaderDate("昭和64年1月7日"), "昭和64年1月7日");
assert.equal(parseTopHeaderDate("昭和64年1月8日"), "");
assert.equal(parseTopHeaderDocumentNumber("記録事項番号 1234 5678 90123"), "1234567890123");
assert.equal(parseTopHeaderDocumentNumber("123456789012"), "");

assert.ok(TOP_HEADER_CROPS.length >= 1, "top header must have at least one targeted crop");
for (const [x, y, w, h] of TOP_HEADER_CROPS) {
  assert.ok(x >= 0 && x < 1 && w > 0 && x + w <= 1, "top-header crop must stay inside page width");
  assert.ok(y >= 0 && y < 1 && h > 0 && y + h <= 1, "top-header crop must stay inside page height");
}
const [, y, , h] = TOP_HEADER_CROPS[0];
assert.ok(y <= 0.025, "top-header crop must include the real-photo header near 4.3% page height");
assert.ok(y + h >= 0.13, "top-header crop must extend far enough to include date and document-number cells");

// The actual app entry point is /vehicle-workflow-v2. Keep the missing-only
// top-header recovery active there as well as on the direct fast test route.
const recoverySource = readFileSync(
  new URL("../app/certificate-fast-top-header-recovery.jsx", import.meta.url),
  "utf8",
);
assert.match(recoverySource, /\/vehicle-workflow-v2/, "top-header recovery must run on the active vehicle workflow");
assert.match(recoverySource, /\/vehicle-workflow-fast/, "top-header recovery must remain available on the fast test route");

console.log("fast top-header regression: ok");
