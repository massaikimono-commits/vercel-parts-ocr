import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const modelSource = fs.readFileSync("app/schedule/delivery-time-ux.ts", "utf8");
const componentSource = fs.readFileSync("app/schedule/time-selection.tsx", "utf8");
const sql = fs.readFileSync("database/schedule-time-label-contract-v2.sql", "utf8");

const moduleSource = ts.transpileModule(modelSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const model = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`);

const expected = [
  ["until_14", "14時まで", "14:00"],
  ["until_15", "15時まで", "15:00"],
  ["until_16", "16時まで", "16:00"],
  ["until_17", "17時まで", "17:00"],
  ["after_15", "15時以降", "15:00"],
  ["after_16", "16時以降", "16:00"],
  ["after_17", "17時以降", "17:00"],
];

for (const [key, label, time] of expected) {
  const preset = model.SCHEDULE_TIME_PRESETS.find((item) => item.key === key);
  assert.ok(preset, `${label} preset exists`);
  assert.equal(preset.label, label);
  assert.equal(preset.startTime, time);
  assert.equal(preset.printTimeLabelOverride, label);
  assert.equal(model.schedulePresetForOverride(label)?.key, key);
  assert.equal(model.isSupportedScheduleTimeLabel(label), true);
  assert.ok(sql.includes(`'${label}'`), `${label} accepted by candidate SQL`);
}

assert.ok(model.SCHEDULE_TIME_PRESETS.some((item) => item.key === "middle" && item.label === "中"));
assert.equal(model.SCHEDULE_TIME_PRESETS.some((item) => item.label === "13時まで"), false);

const valid = model.scheduleChoiceFromCustomRange("14:30", "16:00");
assert.ok(valid);
assert.equal(valid.startTime, "14:30");
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
assert.match(componentSource, /min="08:30"/, "custom range preserves opening time");
assert.match(componentSource, /max="17:30"/, "custom range preserves closing time");
assert.match(componentSource, /step=\{1800\}/, "custom range preserves 30-minute step");

assert.match(sql, /schedule_time_label_is_valid_v2/, "candidate SQL validates common labels");
assert.match(sql, /create_schedule_registration_time_label_v2/, "candidate SQL has single registration RPC");
assert.match(sql, /create_schedule_registration_batch_time_label_v2/, "candidate SQL has batch registration RPC");
assert.match(sql, /reschedule_schedule_entry_time_label_v2/, "candidate SQL has reschedule RPC");
assert.doesNotMatch(sql, /add\s+column/i, "candidate SQL adds no column");
assert.doesNotMatch(sql, /delete\s+from|truncate\s+|drop\s+table/i, "candidate SQL has no destructive data operation");

console.log("schedule-time-selection-contract-regression: PASS");
