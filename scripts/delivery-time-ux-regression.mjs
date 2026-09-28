import fs from "node:fs";

const source = fs.readFileSync("app/schedule/delivery-time-ux.ts", "utf8");
const newPage = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const editPage = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");
const printRules = fs.readFileSync("app/schedule/print-rules.ts", "utf8");

const checks = [
  ["preset 中", source.includes('label: "中"')],
  ["preset 15時以降", source.includes('label: "15時以降"')],
  ["preset 16時以降", source.includes('label: "16時以降"')],
  ["preset 17時以降", source.includes('label: "17時以降"')],
  ["13時まで is not a new preset", !source.includes('label: "13時まで"')],
  ["custom time min 08:30", source.includes('DELIVERY_CUSTOM_TIME_MIN = "08:30"')],
  ["custom time max 17:30", source.includes('DELIVERY_CUSTOM_TIME_MAX = "17:30"')],
  ["custom time uses 30 minute step", source.includes("DELIVERY_CUSTOM_TIME_STEP_SECONDS = 1800")],
  ["existing new registration delivery RPC path retained", newPage.includes("p_delivery_starts_at") && newPage.includes("p_delivery_print_time_mode")],
  ["existing edit exact-time path retained", editPage.includes('type="time"') && editPage.includes("reschedule_schedule_entry_v2")],
  ["daily report exact delivery rendering retained", printRules.includes('row.entry_type === "pickup" || row.entry_type === "delivery"')],
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
if (failed.length) process.exit(1);
console.log("delivery-time-ux-regression: PASS");
