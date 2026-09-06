import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync(new URL("../app/schedule/detail/page.tsx", import.meta.url), "utf8");
const schedule = fs.readFileSync(new URL("../app/schedule/page.tsx", import.meta.url), "utf8");

assert.match(schedule, /\/schedule\/detail\?entry=/, "one-day schedule links directly to schedule detail");
assert.doesNotMatch(schedule, /setActiveVehicle\(vehicle\)[\s\S]{0,500}dailySlotCard/s, "daily board no longer depends on customer-vehicles navigation");

for (const label of [
  "お客様名","ナンバー情報","車種","型式","車台番号",
  "入庫日","入庫時間","入庫区分","入庫要因",
  "納車予定日","納車予定時間","担当者","作業状態","備考"
]) {
  assert.ok(detail.includes(label), `detail page shows ${label}`);
}

assert.match(detail, /\.eq\("work_order_id",current\.work_order_id\)/, "detail loads all schedule entries for the same work order");
assert.match(detail, /entry_type==="pickup" \|\| x\.entry_type==="customer_visit" \|\| x\.entry_type==="onsite_repair"/, "detail resolves inbound entry from pickup/customer visit/onsite repair");
assert.match(detail, /entries\.find\(x=>x\.entry_type==="delivery"\)/, "detail resolves related delivery entry");
assert.match(detail, /work\.work_completed \|\| work\.status==="completed"/, "detail uses work-order completion state");
assert.match(detail, /work\.status==="in_progress"/, "detail uses in-progress work state");
assert.match(detail, /予約変更/, "detail exposes reservation edit");
assert.match(detail, /予約取消/, "detail exposes reservation cancel");
assert.match(detail, /\/schedule\/edit\?id=/, "detail edit action uses existing edit page");
assert.match(detail, /&mode=cancel/, "detail cancel action opens existing safe cancellation confirmation");
assert.doesNotMatch(detail, /customer-vehicles/, "detail does not route through the vehicle list");

console.log("schedule detail regression: ok");
