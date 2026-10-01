import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("database/delivery-time-label-override-v1.sql", "utf8");
const ux = fs.readFileSync("app/schedule/delivery-time-ux.ts", "utf8");
const rules = fs.readFileSync("app/schedule/print-rules.ts", "utf8");
const state = fs.readFileSync("app/schedule/business-vehicle-state.ts", "utf8");
const detail = fs.readFileSync("app/schedule/detail/page.tsx", "utf8");
const day = fs.readFileSync("app/schedule/page.tsx", "utf8");
const week = fs.readFileSync("app/schedule/week/page.tsx", "utf8");
const search = fs.readFileSync("app/schedule/search/page.tsx", "utf8");
const print = fs.readFileSync("app/schedule/print/page.tsx", "utf8");
const newPage = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const edit = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");
const dashboard = fs.readFileSync("app/home-dashboard.tsx", "utf8");

for (const label of ["15時以降", "16時以降", "17時以降"]) {
  assert.ok(ux.includes(`printTimeLabelOverride: "${label}"`), `${label} preset persists its semantic label`);
  assert.ok(sql.includes(`'${label}'`), `${label} is allowed by DB candidate`);
}
assert.match(ux, /custom_[\s\S]*printTimeLabelOverride: null/, "custom exact time never inherits preset semantics");
assert.match(ux, /minute % 30 !== 0/, "custom time is constrained to 30-minute increments");
assert.doesNotMatch(ux, /label: "13時まで"/, "13時まで is not a new preset");

assert.match(sql, /create_schedule_registration_delivery_label_v1/, "single registration label-aware RPC exists");
assert.match(sql, /create_schedule_registration_batch_delivery_label_v1/, "batch registration label-aware RPC exists");
assert.match(sql, /reschedule_schedule_entry_delivery_label_v1/, "reschedule label-aware RPC exists");
assert.match(sql, /set print_time_label_override = v_label/, "label-aware RPC persists existing override column");
assert.doesNotMatch(sql, /add\s+column/i, "candidate does not add a column");
assert.doesNotMatch(sql, /delete\s+from|truncate\s+|drop\s+table/i, "candidate has no destructive data operation");
assert.match(sql, /request_has_app_secret\(\)[\s\S]*is_active_app_user\(\)/, "candidate keeps active-user/app-secret guard");
assert.doesNotMatch(sql, /grant execute[\s\S]{0,220}\bto\s+anon\b/i, "anon is not granted candidate mutation RPCs");

assert.match(rules, /if \(row\.print_time_label_override\?\.trim\(\)\) return row\.print_time_label_override\.trim\(\)/, "daily report primary formatter prefers nonempty override");
assert.match(state, /print_time_label_override\?: string \| null/, "business-state entry carries override");
assert.match(state, /if \(override\) return override/, "business-state formatter prefers override");
assert.match(detail, /print_time_label_override/, "detail already consumes override");
assert.match(day, /print_time_label_override/, "one-day schedule already loads override");
assert.match(week, /print_time_label_override/, "week schedule already loads override");

assert.match(newPage, /deliveryPrintTimeLabelOverride: deliveryLabelOverride/, "batch forwards delivery label");
assert.match(newPage, /p_delivery_print_time_label_override: deliveryLabelOverride/, "single forwards delivery label");
assert.match(newPage, /printTimeLabelOverride: mainLabelOverride/, "batch forwards pickup label");
assert.match(newPage, /p_print_time_label_override: mainLabelOverride/, "single forwards pickup label");
assert.match(edit, /print_time_label_override:target\.printTimeLabelOverride/, "edit creates delivery with override");
assert.match(edit, /p_print_time_label_override:target\.printTimeLabelOverride/, "edit updates delivery with override");
assert.match(edit, /deliveryEntry\.print_time_label_override\|\|null/, "unchanged historical entry keeps override");
assert.match(search, /if \(entry\.print_time_label_override\?\.trim\(\)\)/, "search prefers nonempty override");
assert.equal((search.match(/\.select\("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode,print_time_label_override"\)/g) || []).length, 2, "both search queries load override");
assert.match(print, /if \(delivery\.print_time_label_override\?\.trim\(\)\)/, "daily print due-time prefers override");
assert.match(print, /entry_type,starts_at,print_time_mode,print_time_label_override/, "daily print secondary query loads override");
assert.match(dashboard, /entry_type,starts_at,print_time_mode,print_time_label_override/, "dashboard secondary query loads override");

console.log("delivery-time-db-contract-regression: PASS");
