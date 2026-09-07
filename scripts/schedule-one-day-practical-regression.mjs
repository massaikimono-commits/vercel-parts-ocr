import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/page.tsx", import.meta.url), "utf8");

assert.match(source, /className=\{\`dailySlotCard[\s\S]*onClick=\{\(event\) => openScheduleDetailFromCard\(event, entry\)\}/s, "whole one-day card opens the linked schedule/vehicle detail");
assert.match(source, /function openScheduleDetailFromCard\([\s\S]*target\.closest\("button,input,select,textarea,summary,details,form,label,a"\)[\s\S]*\/schedule\/detail\?entry=/s, "schedule cards navigate directly to the detail page while protecting interactive controls");
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
assert.match(source, /if \\(work\\.reason === "一般整備"\\) return work\\.outsource_vendor_name\\?\\.trim\\(\\) \\? "reason-body" : "reason-repair";/, "general repair is yellow unless an outsource vendor is assigned, in which case it uses the white body/outsource class");
assert.match(source, /if \(work\.reason === "板金塗装" \|\| String\(work\.reason\) === "板金"\) return "reason-body";/, "bodywork reason uses white class for both labels");
for (const cls of ["reason-shaken","reason-check","reason-repair","reason-body"]) {
  assert.match(source, new RegExp(`dailySlotCard\\.${cls}`), `daily board applies ${cls} color`);
}

assert.match(source, /const label = completed \? "作業完了" : running \? "作業中" : "作業未実施";/, "work state labels remain 未実施 → 作業中 → 作業完了");
assert.match(source, /<span className="dailyWorkState">\{workStateControl\(work\)\}<\/span>/, "one-day board always shows work state");

assert.match(source, /@media\(max-width:720px\)\{\.page\{padding:6px 6px 36px\}[\s\S]*\.dailyBoardRow\{min-height:50px\}/s, "mobile top area and one-day rows are compact");
assert.match(source, /\.mobileDayLine\{display:flex[\s\S]*font-size:13px/, "mobile date and total count use a compact one-line header");
assert.match(source, /\.quickNavRow\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, "week/month/new/report actions are a compact four-button row");
assert.match(source, /\.secondaryNavRow\{display:block\}/, "mobile top controls keep only the compact date picker row");
assert.doesNotMatch(source, /completionPosition|CompletionPosition|layoutControl|名前横|詳細欄/, "one-day completion-position selector is retired");
assert.match(source, /<div className="customerRow">[\s\S]*<div className="workStateSlot">\{workStateControl\(work\)\}<\/div>/s, "work state is fixed beside the customer name");
assert.match(source, /\.dailyCellCustomer>b\{font-size:12px\}/, "mobile customer text is compact");
assert.match(source, /\.dailyCellVehicle>b\{font-size:11px\}/, "mobile last4 text is compact");
assert.match(source, /\.dailyCellTime>b\{font-size:10px\}/, "mobile time text is compact");

assert.match(source, /onClick=\{\(event\) => openScheduleDetailFromCard\(event, inboundEntry\)\}/, "staying rows open the exact schedule/vehicle detail");
assert.match(source, /className="stayMobileSummary"/, "staying vehicles have a dedicated mobile list summary");
assert.match(source, /滞留:\{work\.stay_reason \|\| "未登録"\}/, "mobile staying summary shows stay reason inline");
assert.match(source, /納車:未登録/, "mobile staying summary shows delivery status inline");
assert.match(source, /\.stayDesktopBody\{display:none\}/, "mobile hides the large staying-card body");
assert.match(source, /\.stayGrid\{grid-template-columns:1fr;gap:3px\}/, "mobile staying vehicles render as a tight list");
assert.match(source, /\.stayEdit summary\{font-size:8px\}/, "staying edit disclosure stays available but compact");

assert.match(source, /\.workloadGrid\{grid-template-columns:1fr;gap:3px\}/, "mobile workload renders as a compact list");
assert.match(source, /\.workloadCard\{grid-template-columns:minmax\(0,1fr\) auto auto auto;/, "workload row keeps staff, unfinished, running, and urgent counts inline");
assert.match(source, /\.quick\{grid-template-columns:1fr 1fr;gap:4px;margin-top:6px\}/, "next-function area is compact on mobile");
assert.match(source, /\.quick button\{padding:6px 4px;border-radius:7px;font-size:9px;min-height:30px\}/, "next-function buttons use reduced height and spacing");

console.log("schedule one-day practical regression: ok");
