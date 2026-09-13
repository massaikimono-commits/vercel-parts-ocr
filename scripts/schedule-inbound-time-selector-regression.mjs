import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");

assert.match(source, /const \[showAfternoonOptions, setShowAfternoonOptions\] = useState\(false\)/, "progressive afternoon selector state exists");
assert.match(source, /timeOptions\.filter\(\(x\) => x\.group === "morning"\)/, "initial selector shows morning options");
assert.match(source, /<b>午後<\/b>/, "initial selector includes afternoon trigger");
assert.match(source, /showAfternoonOptions && \(/, "afternoon choices are hidden until afternoon is selected");
assert.match(source, /午後の時間指定 または 中/, "expanded selector explains exact-time or broad 中 choice");
assert.match(source, /「中」はその日の営業時間内で時間指定なしです。/, "中 meaning is explicit");

assert.match(source, /option\.mode === "unspecified" && option\.group === "afternoon"[\s\S]*label: "中", displayLabel: "中"/, "legacy afternoon broad option is rendered as 中");
assert.match(source, /const afternoonTimes = \["13:00","14:00","15:00","16:00","17:00"\]/, "pickup gains 13:00+ exact choices");
assert.match(source, /const afternoonTimes = \["13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00"\]/, "onsite gains 13:00+ exact choices");
assert.match(source, /label: "A中"[\s\S]*mode: "morning"/, "onsite includes A中");
assert.match(source, /label: "中"[\s\S]*mode: "unspecified"/, "onsite includes 中");
assert.match(source, /schedule_slot_check_v2/, "generated pickup/onsite choices still use slot availability checks");

assert.doesNotMatch(source, /onsiteMode|onsiteTime|onsiteDuration/, "onsite-specific time picker state is removed");
assert.doesNotMatch(source, />30分<|>60分<|>90分<|>120分</, "onsite duration buttons are removed");
assert.match(source, /function mainTimes\(\) \{\s*if \(!selectedTime\) return null;/s, "pickup/customer visit/onsite share selected-time submission path");
assert.match(source, /setShowAfternoonOptions\(false\)/, "success/type/day reset collapses afternoon selector");

console.log("schedule inbound time selector regression: ok");
