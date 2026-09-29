import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const modelSource = fs.readFileSync("app/schedule/delivery-time-ux.ts", "utf8");
const componentSource = fs.readFileSync("app/schedule/time-selection.tsx", "utf8");
const sql = fs.readFileSync("database/schedule-time-label-contract-v2.sql", "utf8");
const newPage = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const editPage = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");

const moduleSource = ts.transpileModule(modelSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const model = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`);

const expected = [
  ["until_1400", "14時まで", "14:00"],
  ["until_1500", "15時まで", "15:00"],
  ["until_1600", "16時まで", "16:00"],
  ["until_1700", "17時まで", "17:00"],
  ["after_1500", "15時以降", "15:00"],
  ["after_1600", "16時以降", "16:00"],
  ["after_1700", "17時以降", "17:00"],
];

for (const [key, label, time] of expected) {
  const preset = model.SCHEDULE_TIME_PRESETS.find((item) => item.key === key);
  assert.ok(preset, `${label} preset exists`);
  assert.equal(preset.label, label);
  assert.equal(preset.time, time);
  assert.equal(preset.printTimeLabelOverride, label);
  assert.equal(model.schedulePresetForOverride(label)?.key, key);
  assert.equal(model.isSupportedScheduleTimeLabel(label), true);
  assert.ok(sql.includes(`'${label}'`), `${label} accepted by candidate SQL`);
}

assert.ok(model.SCHEDULE_TIME_PRESETS.some((item) => item.key === "unspecified" && item.label === "中"));
assert.equal(model.SCHEDULE_TIME_PRESETS.some((item) => item.label === "13時まで"), false);

const valid = model.scheduleChoiceFromCustomRange("14:30", "16:00");
assert.ok(valid);
assert.equal(valid.time, "14:30");
assert.equal(valid.endTime, "16:00");
assert.equal(valid.printTimeLabelOverride, "14:30～16:00");
assert.equal(model.isSupportedScheduleTimeLabel("14:30～16:00"), true);

for (const [start, end] of [
  ["14:30", "14:30"],
  ["16:00", "14:30"],
  ["08:00", "09:00"],
  ["17:00", "18:00"],
  ["14:15", "16:00"],
]) {
  assert.equal(model.scheduleChoiceFromCustomRange(start, end), null, `${start}～${end} must be rejected`);
}

assert.match(componentSource, /SCHEDULE_TIME_PRESETS\.map/, "shared component renders the common preset model");
assert.match(componentSource, /任意時間帯/, "shared component labels custom range clearly");
assert.match(componentSource, /type="time"[\s\S]*type="time"/, "shared component renders start and end time inputs");
assert.match(componentSource, /aria-pressed/, "selection state is not conveyed by color alone");
assert.match(componentSource, /aria-hidden="true">✓/, "selected state has a visible checkmark");
assert.match(componentSource, /grid-cols-2[^\n]*sm:grid-cols-4/, "shared mobile and wide button rules");
assert.match(componentSource, /min="08:30"/, "custom range preserves opening time");
assert.match(componentSource, /max="17:30"/, "custom range preserves closing time");
assert.match(componentSource, /step=\{1800\}/, "custom range preserves 30-minute step");

assert.match(sql, /schedule_time_label_is_valid_v2/, "candidate SQL validates common labels");
assert.match(sql, /create_schedule_registration_time_label_v2/, "candidate SQL has single registration RPC");
assert.match(sql, /create_schedule_registration_batch_time_label_v2/, "candidate SQL has batch registration RPC");
assert.match(sql, /reschedule_schedule_entry_time_label_v2/, "candidate SQL has reschedule RPC");
assert.doesNotMatch(sql, /add\s+column/i, "candidate SQL adds no column");
assert.doesNotMatch(sql, /delete\s+from|truncate\s+|drop\s+table/i, "candidate SQL has no destructive data operation");
assert.match(newPage, /<TimeSelection label=\{`\$\{ENTRY_LABEL\[entryType\]\}時間設定`\}/, "new pickup and delivery share time selection");
assert.match(newPage, /includeMorningChoices=\{entryType === "pickup"/, "pickup morning business options remain available");
assert.match(newPage, /<TimeSelection label="納車時間設定"/, "companion delivery uses shared time selection");
assert.match(editPage, /<TimeSelection label=\{`\$\{LABEL\[entry\.entry_type\]\}時間設定`\}/, "edit pickup and delivery share time selection");
assert.match(editPage, /includeMorningChoices=\{entry\.entry_type==="pickup"/, "edit pickup morning options remain available");
assert.match(editPage, /<TimeSelection label="納車時間設定"/, "edit companion delivery uses shared time selection");
assert.match(newPage, /printTimeLabelOverride: mainLabelOverride/, "batch main label is persisted");
assert.match(newPage, /deliveryPrintTimeLabelOverride: deliveryLabelOverride/, "batch companion label is persisted");
assert.match(newPage, /p_print_time_label_override: mainLabelOverride/, "single main label is persisted");
assert.match(newPage, /p_delivery_print_time_label_override: deliveryLabelOverride/, "single companion label is persisted");
assert.match(newPage, /create_schedule_registration_batch_time_label_v2/, "batch uses v2 candidate RPC");
assert.match(newPage, /create_schedule_registration_time_label_v2/, "single uses v2 candidate RPC");
assert.match(editPage, /reschedule_schedule_entry_time_label_v2/, "edit uses v2 candidate RPC");
assert.match(editPage, /mainChoiceKey==="historical"[\s\S]*entry\.print_time_label_override/, "historical main override is retained");
assert.match(editPage, /deliveryChoiceKey==="historical"[\s\S]*deliveryEntry/, "historical companion override is retained");
assert.match(editPage, /reschedule_schedule_entry_v2/, "historical RPC is preserved");
assert.doesNotMatch(newPage+editPage, /create_schedule_registration_(batch_)?delivery_label_v1|reschedule_schedule_entry_delivery_label_v1/, "new writes cannot flow into delivery-only RPCs");
for (const file of ["detail/page.tsx","search/page.tsx","page.tsx","week/page.tsx","month/page.tsx","print/page.tsx"]) {
  assert.match(fs.readFileSync(`app/schedule/${file}`,"utf8"), /print_time_label_override/, `${file} carries label override`);
}
assert.match(fs.readFileSync("app/home-dashboard.tsx","utf8"), /print_time_label_override/, "home carries label override");
assert.match(fs.readFileSync("app/schedule/print-rules.ts","utf8"), /if \(row\.print_time_label_override\?\.trim\(\)\)/, "print prefers override");

console.log("schedule-time-selection-contract-regression: PASS");
