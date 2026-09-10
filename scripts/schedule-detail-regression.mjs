import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync(new URL("../app/schedule/detail/page.tsx", import.meta.url), "utf8");
const schedule = fs.readFileSync(new URL("../app/schedule/page.tsx", import.meta.url), "utf8");

assert.match(schedule, /\/schedule\/detail\?entry=/, "one-day schedule links directly to schedule detail");
assert.doesNotMatch(schedule, /setActiveVehicle\(vehicle\)[\s\S]{0,500}dailySlotCard/s, "daily board no longer depends on customer-vehicles navigation");

for (const label of [
  "お客様名","電話番号","ナンバー情報","車種","型式","車台番号",
  "入庫日","入庫時間","入庫区分","入庫要因",
  "納車予定日","納車予定時間","担当者","作業状態","作業待ち","代車","優先","外注先","備考",
  "この車両で続ける"
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
assert.match(detail, /outsource_vendor_name/, "detail reads outsource vendor");
assert.match(detail, /is_urgent/, "detail reads urgent flag");
assert.match(detail, /needs_loaner/, "detail reads loaner flag");
assert.match(detail, /is_waiting_service/, "detail reads waiting-service flag");
assert.match(detail, /schedule_display_name,phone/, "detail reads customer phone without another query");
assert.match(detail, /sessionStorage\.setItem\("parts-active-vehicle"/, "detail stages vehicle context for parts flow");
assert.match(detail, /localStorage\.setItem\("parts-active-vehicle"/, "detail stages vehicle context for inspection flow");
assert.match(detail, /openVehicleTool\("\/parts-data"\)/, "detail opens vehicle parts directly");
assert.match(detail, /customer-vehicles\/\$\{kind\}\?vehicle=/, "detail links selected vehicle directly to history/photo routes");
assert.match(detail, /\/inspection\?workOrderId=/, "detail opens inspection record for current work order");
assert.match(detail, /work\.reason!=="点検" && work\.reason!=="車検"/, "inspection shortcut is limited to inspection/vehicle-inspection work");
assert.doesNotMatch(detail, /location\.assign\("\/customer-vehicles"\)/, "detail does not bounce through the vehicle list");
assert.doesNotMatch(detail, /\/ocr\//, "practical detail hub does not couple to OCR execution");

console.log("schedule detail regression: ok");
