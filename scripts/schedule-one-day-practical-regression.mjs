import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/page.tsx", import.meta.url), "utf8");

assert.match(source, /className=\{\`dailySlotCard[\s\S]*onClick=\{\(event\) => openVehicleFromCard\(event, vehicle\)\}/s, "whole one-day card opens the linked vehicle");
assert.match(source, /function openVehicleFromCard\([\s\S]*target\.closest\("button,input,select,textarea,summary,details,form,label,a"\)/s, "interactive controls do not accidentally trigger vehicle navigation");
assert.doesNotMatch(source, /車両を開く/, "separate vehicle-open button stays removed");

assert.match(source, /pickup: ""/, "pickup label is hidden as the normal operation");
assert.match(source, /entry\.entry_type === "customer_visit" \|\| entry\.entry_type === "onsite_repair"[\s\S]*\? ENTRY_LABEL\[entry\.entry_type\][\s\S]*: "";/s, "only customer visit / onsite repair labels are shown");
assert.match(source, /<b>入庫<\/b>/, "one-day board does not advertise pickup wording in the inbound header");
assert.doesNotMatch(source, />引取・来社・出張<\/b>/, "legacy pickup wording is removed from the one-day board header");

const customerPos = source.indexOf('<div className="dailyCellCustomer">');
const vehiclePos = source.indexOf('<div className="dailyCellVehicle">', customerPos);
const reasonPos = source.indexOf('<small>{work?.reason || "入庫要因未設定"}</small>', vehiclePos);
const timePos = source.indexOf('<div className="dailyCellTime">', reasonPos);
assert.ok(customerPos >= 0 && vehiclePos > customerPos && reasonPos > vehiclePos && timePos > reasonPos, "card display priority is customer → last4/reason → type/time");

assert.match(source, /if \(work\.reason === "車検"\) return "reason-shaken";/, "vehicle inspection reason color class exists");
assert.match(source, /if \(work\.reason === "点検"\) return "reason-check";/, "inspection reason color class exists");
assert.match(source, /if \(work\.reason === "一般整備"\) return "reason-repair";/, "general repair is always yellow-class regardless of outsourcing");
assert.match(source, /if \(work\.reason === "板金塗装" \|\| String\(work\.reason\) === "板金"\) return "reason-body";/, "bodywork reason uses white class for both labels");
for (const cls of ["reason-shaken","reason-check","reason-repair","reason-body"]) {
  assert.match(source, new RegExp(`dailySlotCard\\.${cls}`), `daily board applies ${cls} color`);
}

assert.match(source, /const label = completed \? "作業完了" : running \? "作業中" : "作業未実施";/, "work state labels remain 未実施 → 作業中 → 作業完了");
assert.match(source, /<span className="dailyWorkState">\{workStateControl\(work\)\}<\/span>/, "one-day board always shows work state");

assert.match(source, /@media\(max-width:720px\)\{\.dailyBoardRow\{min-height:50px\}/, "mobile one-day rows are compact");
assert.match(source, /\.dailyCellCustomer>b\{font-size:12px\}/, "mobile customer text is compact");
assert.match(source, /\.dailyCellVehicle>b\{font-size:11px\}/, "mobile last4 text is compact");
assert.match(source, /\.dailyCellTime>b\{font-size:10px\}/, "mobile time text is compact");

console.log("schedule one-day practical regression: ok");
