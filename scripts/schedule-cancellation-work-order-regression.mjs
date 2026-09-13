import assert from "node:assert/strict";
import fs from "node:fs";

const edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../database/cancel-schedule-entry-v1.sql", import.meta.url), "utf8");

assert.match(sql, /delete from public\.schedule_entries where work_order_id = v_entry\.work_order_id;/, "RPC deletes all schedule entries in the work order");
assert.match(sql, /where lr\.work_order_id = v_entry\.work_order_id/, "RPC updates loaner reservations by work order");
assert.match(sql, /rental_provider_status = 'cancellation_requested'/, "rental-company loaner remains safe pending cancellation");
assert.match(sql, /return public\.cancel_customer_booking_by_staff\(/, "linked customer booking continues through the existing safe cancellation path");

assert.match(edit, /supabase\.rpc\("cancel_schedule_entry_v1"/, "edit screen keeps the existing cancellation RPC");
assert.match(edit, /params\.get\("mode"\)==="cancel"/, "cancellation confirmation can be opened directly from search");
assert.match(edit, /entry && cancelMode && showCancel/, "direct cancel mode reuses the existing confirmation UI");
assert.doesNotMatch(edit, /onClick=\{\(\)=>setShowCancel\(true\)\}/, "normal edit mode does not duplicate the cancellation entry point");
assert.match(edit, /\.eq\("work_order_id",e\.work_order_id\)[\s\S]*\.eq\("entry_type","delivery"\)/s, "edit loads related delivery by work order");
assert.match(edit, /\.eq\("work_order_id",e\.work_order_id\)[\s\S]*\.in\("entry_type",\["pickup","customer_visit","onsite_repair"\]\)/s, "edit loads related inbound schedule by work order");

for (const label of ["お客様名","下4桁","入庫要因","入庫予定","納車予定"]) {
  assert.ok(edit.includes(label), `cancellation confirmation shows ${label}`);
}
assert.match(edit, /この入庫予定一式を取消します/, "confirmation clearly describes one work-order set");
assert.match(edit, /同じ work_order_id に紐づく引取・来社・出張・納車予定は1セットとして取消します。/, "confirmation explains work-order grouping");
assert.match(edit, /entrySummaryLabel\(cancelInboundEntry\)/, "inbound summary is shown");
assert.match(edit, /entrySummaryLabel\(cancelDeliveryEntry\)/, "delivery summary is shown");
assert.match(edit, /customerSummaryLabel\(customerSummary\)/, "customer summary is shown");
assert.match(edit, /naturalLast4\(vehicleSummary\?\.registration_number_last4\)/, "natural last4 is shown");

assert.match(edit, /if\(data\?\.rentalCancellationPending && data\?\.cancelled===false\)\{[\s\S]*まだ取消確定していません。/s, "customer-booking rental pending is not shown as completed");
assert.match(edit, /if\(data\?\.rentalCancellationPending\)\{[\s\S]*入庫予定一式は取消済みです。レンタカーは業者への取消連絡待ちです。/s, "completed staff cancellation can still show rental-provider pending");
assert.match(edit, /入庫予定一式を取消しました。関連する入庫・納車予定と代車予約も更新しました。/, "completed work-order cancellation reports full-set completion");

console.log("schedule cancellation work-order regression: ok");
