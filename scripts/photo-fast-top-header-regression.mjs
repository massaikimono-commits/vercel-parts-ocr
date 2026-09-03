import assert from "node:assert/strict";
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
assert.equal(parseTopHeaderDate("令和8年19月3日"), "");
assert.equal(parseTopHeaderDocumentNumber("記録事項番号 1234 5678 90123"), "1234567890123");
assert.equal(parseTopHeaderDocumentNumber("123456789012"), "");

assert.ok(TOP_HEADER_CROPS.length >= 1, "top header must have at least one targeted crop");
const [x, y, w, h] = TOP_HEADER_CROPS[0];
assert.ok(x >= 0 && x < 1 && w > 0 && x + w <= 1, "top-header crop must stay inside page width");
assert.ok(y <= 0.025, "top-header crop must include the real-photo header near 4.3% page height");
assert.ok(y + h >= 0.13, "top-header crop must extend far enough to include date and document-number cells");

console.log("fast top-header regression: ok");
