import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const modelSource = fs.readFileSync("app/schedule/delivery-time-ux.ts", "utf8");
const componentSource = fs.readFileSync("app/schedule/time-selection.tsx", "utf8");
const sql = fs.readFileSync("database/schedule-time-label-contract-v2.sql", "utf8");
const newPage = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const editPage = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");

const moduleSource = ts.transpileModule(modelSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const model = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`);

const expected = [
  ["until_1400", "14時まで", "14:00"], ["until_1500", "15時まで", "15:00"],
  ["until_1600", "16時まで", "16:00"], ["until_1700", "17時まで", "17:00"],
  ["after_1500", "15時以降", "15:00"], ["after_1600", "16時以降", "16:00"],
  ["after_1700", "17時以降", "17:00"],
];
for (const [key, label, time] of expected) {
  const preset = model.SCHEDULE_TIME_PRESETS.find((item) => item.key === key);
  assert.ok(preset, `${label} preset exists`);
  assert.equal(preset.label, label); assert.equal(preset.time, time);
  assert.equal(preset.printTimeLabelOverride, label);
  assert.equal(model.schedulePresetForOverride(label)?.key, key);
  assert.equal(model.isSupportedScheduleTimeLabel(label), true);
  assert.ok(sql.includes(`'${label}'`), `${label} accepted by candidate SQL`);
}
assert.ok(model.SCHEDULE_TIME_PRESETS.some((item) => item.key === "unspecified" && item.label === "中"));
assert.equal(model.SCHEDULE_TIME_PRESETS.some((item) => item.label === "13時まで"), false);
const valid = model.scheduleChoiceFromCustomRange("14:30", "16:00");
assert.ok(valid); assert.equal(valid.time, "14:30"); assert.equal(valid.endTime, "16:00");
assert.equal(valid.printTimeLabelOverride, "14:30～16:00");
for (const [start, end] of [["14:30","14:30"],["16:00","14:30"],["08:00","09:00"],["17:00","18:00"],["14:15","16:00"]]) {
  assert.equal(model.scheduleChoiceFromCustomRange(start, end), null, `${start}～${end} must be rejected`);
}

assert.match(componentSource, /SCHEDULE_TIME_PRESETS\.map/, "shared component renders common preset model");
assert.doesNotMatch(componentSource, />\s*任意時間帯\s*</, "custom range must not restore the removed visible heading");
assert.match(componentSource, /type="time"[\s\S]*type="time"/, "start/end time inputs remain visible");
assert.match(componentSource, /aria-label="開始時刻"/, "start time keeps accessibility label");
assert.match(componentSource, /aria-label="終了時刻"/, "end time keeps accessibility label");
assert.doesNotMatch(componentSource, />\s*開始時刻\s*</, "start time must not restore visible label");
assert.doesNotMatch(componentSource, />\s*終了時刻\s*</, "end time must not restore visible label");
assert.match(componentSource, /aria-pressed/, "selected state is not color-only");
assert.match(componentSource, /aria-hidden="true">✓/, "selected state keeps visible checkmark");
assert.equal((componentSource.match(/grid grid-cols-3 gap-2/g) || []).length, 2, "morning and afternoon both use compact 3-column grid");
assert.match(componentSource, /includeMorningChoices\.length > 0 \? " mt-4" : ""/, "pickup afternoon grid gets boundary-only vertical spacing");
assert.match(componentSource, /includeMorningChoices\.length > 0 \? \{ marginTop: "1rem" \} : \{\}/, "boundary spacing has rendered-layout fallback");
assert.match(componentSource, /data-morning-afternoon-gap=\{includeMorningChoices\.length > 0 \? "true" : undefined\}/, "pickup-only morning/afternoon boundary remains explicit");
assert.doesNotMatch(componentSource, /grid-cols-1|grid-cols-2|sm:grid-cols-4/, "preset UI cannot regress to one/two-column mobile or old responsive rule");
assert.match(componentSource, /min-h-11[^\n]*whitespace-nowrap[^\n]*text-xs/, "compact preset sizing keeps iPhone labels on one line");
assert.match(componentSource, /backgroundColor: "#ecfdf5"[\s\S]*color: "#047857"[\s\S]*borderColor: "#a7f3d0"/, "unselected preset uses explicit pale-green visual contract");
assert.match(componentSource, /backgroundColor: "#ffffff"[\s\S]*color: "#1d4ed8"[\s\S]*borderColor: "#2563eb"/, "selected preset uses explicit white/blue visual contract");
assert.match(componentSource, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/, "custom start/end remain compact side-by-side");
assert.match(componentSource, /gridTemplateColumns: "minmax\(0, 1fr\) auto minmax\(0, 1fr\)"/, "custom range has rendered-layout fallback independent of generated utility CSS");
assert.match(componentSource, /aria-hidden="true">～<\/span>/, "custom range keeps compact separator");
assert.match(componentSource, /min="08:30"/, "opening time preserved");
assert.match(componentSource, /max="17:30"/, "closing time preserved");
assert.match(componentSource, /step=\{1800\}/, "30-minute step preserved");
assert.doesNotMatch(componentSource, /13時まで/, "13時まで cannot return through shared component");

assert.match(sql, /schedule_time_label_is_valid_v2/); assert.match(sql, /create_schedule_registration_time_label_v2/);
assert.match(sql, /create_schedule_registration_batch_time_label_v2/); assert.match(sql, /reschedule_schedule_entry_time_label_v2/);
assert.doesNotMatch(sql, /add\s+column/i); assert.doesNotMatch(sql, /delete\s+from|truncate\s+|drop\s+table/i);
assert.match(newPage, /<TimeSelection label=\{`\$\{ENTRY_LABEL\[entryType\]\}時間設定`\}/);
assert.match(newPage, /includeMorningChoices=\{entryType === "pickup"/);
assert.match(newPage, /<TimeSelection label="納車時間設定"/);
assert.match(editPage, /<TimeSelection label=\{`\$\{LABEL\[entry\.entry_type\]\}時間設定`\}/);
assert.match(editPage, /includeMorningChoices=\{entry\.entry_type==="pickup"/);
assert.match(editPage, /<TimeSelection label="納車時間設定"/);
assert.match(newPage, /create_schedule_registration_batch_time_label_v2/);
assert.match(newPage, /create_schedule_registration_time_label_v2/);
assert.match(editPage, /reschedule_schedule_entry_time_label_v2/);
assert.match(editPage, /reschedule_schedule_entry_v2/, "historical RPC preserved");
assert.doesNotMatch(newPage+editPage, /create_schedule_registration_(batch_)?delivery_label_v1|reschedule_schedule_entry_delivery_label_v1/);
for (const file of ["detail/page.tsx","search/page.tsx","page.tsx","week/page.tsx","month/page.tsx","print/page.tsx"]) {
  assert.match(fs.readFileSync(`app/schedule/${file}`,"utf8"), /print_time_label_override/, `${file} carries label override`);
}
assert.match(fs.readFileSync("app/home-dashboard.tsx","utf8"), /print_time_label_override/);
assert.match(fs.readFileSync("app/schedule/print-rules.ts","utf8"), /if \(row\.print_time_label_override\?\.trim\(\)\)/);
console.log("schedule-time-selection-contract-regression: PASS");
