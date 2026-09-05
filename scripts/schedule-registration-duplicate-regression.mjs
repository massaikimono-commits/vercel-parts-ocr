import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");

assert.match(source, /async function sameDayVehicleScheduleWarnings\(vehicleIds: string\[\]\)/, "same-day duplicate helper exists");
assert.match(source, /\.from\("schedule_entries"\)/, "same-day duplicate check reads schedule entries");
assert.match(source, /\.in\("vehicle_id", ids\)/, "same-day duplicate check is keyed by selected vehicle ids");
assert.match(source, /\.gte\("starts_at", dayStart\)/, "same-day duplicate check starts at selected day");
assert.match(source, /\.lt\("starts_at", nextDayStart\)/, "same-day duplicate check ends before next day");
assert.match(source, /時間や入庫内容が違っていても同日のため確認してください。/, "same-day warning ignores time/reason differences");
assert.match(source, /"それでも登録する"/, "same-day warning can be overridden explicitly");

const helperUses = source.match(/sameDayVehicleScheduleWarnings\(/g) || [];
assert.equal(helperUses.length, 3, "helper is used for function definition, single registration, and batch registration");

assert.doesNotMatch(source, /DuplicateVehicleCandidate/, "score-based vehicle identity candidate type is removed");
assert.doesNotMatch(source, /duplicateVehicles/, "score-based vehicle candidate UI/state is removed");
assert.doesNotMatch(source, /vehicleCandidates\.some|strongVehicles|pairedCustomerIds/, "partial/score vehicle identity is not used");
assert.match(source, /p_chassis_number: null/, "schedule manual form still lacks chassis input and therefore must not assert same vehicle");
assert.match(source, /車台番号入力がないため、情報不足/, "missing chassis is documented as insufficient vehicle identity information");
assert.match(source, /顧客の重複確認です。車両の同一判定と「同じ車両＋同じ日」の予定重複は別に扱います。/, "customer duplicate and schedule duplicate are presented separately");

console.log("schedule registration duplicate regression: ok");
