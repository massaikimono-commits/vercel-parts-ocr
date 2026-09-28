import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";

const source = fs.readFileSync("app/schedule/delivery-time-ux.ts", "utf8");
const newPage = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const editPage = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");
const printRules = fs.readFileSync("app/schedule/print-rules.ts", "utf8");
const moduleSource = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const delivery = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`);

for (const [time, label] of [["15:00", "15時以降"], ["16:00", "16時以降"], ["17:00", "17時以降"]]) {
  const preset = delivery.DELIVERY_TIME_PRESETS.find((x) => x.label === label);
  assert.equal(preset.time, time);
  assert.equal(preset.printTimeLabelOverride, label);
  assert.equal(delivery.deliveryChoiceFromCustomTime(time).printTimeLabelOverride, null,
    `${time} exact must not inherit ${label} semantics`);
}
assert.equal(delivery.deliveryChoiceFromCustomTime("08:30")?.time, "08:30");
assert.equal(delivery.deliveryChoiceFromCustomTime("17:30")?.time, "17:30");
for (const invalid of ["08:00", "17:31", "15:15", "13時", "25:00"]) {
  assert.equal(delivery.deliveryChoiceFromCustomTime(invalid), null);
}

const checks = [
  ["preset 中", source.includes('label: "中"')],
  ["preset 15時以降", source.includes('label: "15時以降"')],
  ["preset 16時以降", source.includes('label: "16時以降"')],
  ["preset 17時以降", source.includes('label: "17時以降"')],
  ["13時まで is not a new preset", !source.includes('label: "13時まで"')],
  ["custom time min 08:30", source.includes('DELIVERY_CUSTOM_TIME_MIN = "08:30"')],
  ["custom time max 17:30", source.includes('DELIVERY_CUSTOM_TIME_MAX = "17:30"')],
  ["custom time uses 30 minute step", source.includes("DELIVERY_CUSTOM_TIME_STEP_SECONDS = 1800")],
  ["new registration label-aware RPC", newPage.includes('"create_schedule_registration_delivery_label_v1"') && newPage.includes("p_delivery_print_time_label_override")],
  ["batch registration label-aware RPC", newPage.includes('"create_schedule_registration_batch_delivery_label_v1"') && newPage.includes("deliveryPrintTimeLabelOverride")],
  ["label-aware RPC limited to companion delivery", newPage.includes('!isWaitingService && addDelivery && entryType !== "delivery"') && newPage.includes("supabase.rpc(deliveryLabelOverride")],
  ["presets and custom time visible together", newPage.includes("DELIVERY_TIME_PRESETS.map") && newPage.includes('type="time"')],
  ["edit label-aware RPC and historical restoration", editPage.includes("reschedule_schedule_entry_delivery_label_v1") && editPage.includes("deliveryPresetForOverride") && editPage.includes('deliveryChoiceKey==="historical"')],
  ["edit always-visible custom time", editPage.includes("DELIVERY_TIME_PRESETS.map") && editPage.includes('type="time"')],
  ["existing edit RPC preserved for historical paths", editPage.includes("reschedule_schedule_entry_v2")],
  ["daily report exact delivery rendering retained", printRules.includes('row.entry_type === "pickup" || row.entry_type === "delivery"')],
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
if (failed.length) process.exit(1);
console.log("delivery-time-ux-regression: PASS");
