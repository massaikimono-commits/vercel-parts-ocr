import assert from "node:assert/strict";
import fs from "node:fs";

const createSource = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");
const editSource = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");

for (const source of [createSource, editSource]) {
  assert.match(source, /showAfternoonOptions/, "progressive afternoon selector state exists");
  assert.match(source, /filter\(\(x\) => x\.group === "morning"\)|filter\(x=>x\.group==="morning"\)/, "initial selector shows morning options");
  assert.match(source, />午後<\/b>/, "initial selector includes 午後 trigger");
  assert.match(source, /showAfternoonOptions && \(/, "afternoon details are hidden until 午後 is selected");
  assert.match(source, /午後の時間指定 または 中/, "expanded selector contains 13:00+ exact choices and 中");
  assert.match(source, /「中」はその日の営業時間内で時間指定なしです。/, "中 meaning is explicit");
  assert.match(source, /label:"A中"|label: "A中"/, "A中 exists");
  assert.match(source, /label:"中"|label: "中"/, "中 exists");
}

assert.match(editSource, /setSelected\(""\);setShowAfternoonOptions\(true\)/, "edit 午後 trigger requires choosing an afternoon detail");
assert.match(editSource, /const afternoonTimes=\["13:00","14:00","15:00","16:00","17:00"\]/, "edit pickup has 13:00+ exact choices");
assert.match(editSource, /const afternoonTimes=\["13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00"\]/, "edit onsite has 13:00+ exact choices");
assert.match(editSource, /schedule_slot_check_v2/, "edit generated choices keep existing slot checks");
assert.match(editSource, /p_exclude_entry_id:base\.id/, "edit availability check excludes the entry being edited");
assert.match(editSource, /const startsAt=selectedOption\.startsAt;\s*const endsAt=selectedOption\.endsAt;\s*const mode=selectedOption\.mode;/s, "edit submits through the same selected-option path");
assert.doesNotMatch(editSource, /onsiteMode|onsiteTime|onsiteDuration/, "legacy onsite-only picker state is removed");
assert.doesNotMatch(editSource, />30分<|>60分<|>90分<|>120分</, "legacy onsite duration choices are removed");

console.log("schedule edit inbound time selector regression: ok");
