import fs from "node:fs";

const sql = fs.readFileSync("database/schedule-pickup-capacity-deadlines-v2.sql", "utf8");
const create = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const edit = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");
const rules = fs.readFileSync("app/schedule/print-rules.ts", "utf8");

const failures = [];

for (const expected of [
  "pickup_morning_limit",
  "'10'::jsonb",
  "'afternoon_unspecified'",
  "'afternoon_unspecified_label'",
  "'午後'",
  "p_entry_type<>'pickup'",
  "v_morning_pickup_count>=v_morning_pickup_limit",
  "schedule_pickup_capacity",
  "'displayLabel'",
]) {
  if (!sql.includes(expected)) failures.push("SQL missing: " + expected);
}

for (const expected of [
  "displayLabel?: string;",
  "x.displayLabel || x.label",
  'supabase.rpc("schedule_pickup_capacity"',
  "capMorningPickup",
  "午前 引取",
]) {
  if (!create.includes(expected)) failures.push("schedule/new missing: " + expected);
}

for (const expected of [
  "displayLabel?:string;",
  "x.displayLabel || x.label",
  "x.mode === base.print_time_mode",
]) {
  if (!edit.includes(expected)) failures.push("schedule/edit missing: " + expected);
}

for (const expected of [
  'row.entry_type === "pickup" || row.entry_type === "delivery"',
  'return minute === 0 ?',
  'row.entry_type === "pickup" && row.print_time_mode === "unspecified"',
  'return "午後"',
]) {
  if (!rules.includes(expected)) failures.push("print rules missing: " + expected);
}

if (failures.length) {
  console.error("FAIL pickup capacity/deadline regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS pickup capacity/deadline regression");
console.log("- morning pickup cap is 10 independent pickup entries");
console.log("- exact pickup/delivery can render as deadline labels");
console.log("- afternoon pickup period option exists");
console.log("- legacy option labels remain available for older deployed UI");
