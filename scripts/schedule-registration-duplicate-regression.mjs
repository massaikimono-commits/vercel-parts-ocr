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

assert.doesNotMatch(source, /find_schedule_registration_duplicates/, "manual entry does not invoke customer/vehicle candidate duplicate RPC");
assert.doesNotMatch(source, /既存顧客の確認|既存顧客を使う|候補とは別なので新規として登録/, "manual entry does not show existing-customer candidate confirmation");
assert.doesNotMatch(source, /DuplicateCustomerCandidate|DuplicateVehicleCandidate|duplicateCustomers|duplicateVehicles/, "candidate duplicate UI/state is removed");
assert.match(source, /const selectedCustomerForSubmit = existingCustomerId;/, "explicitly selected registered customer is submitted directly");
assert.match(source, /const selectedVehicleForSubmit = existingVehicleId;/, "explicitly selected registered vehicle is submitted directly");
assert.match(source, /初入庫は「お客様名＋ナンバー下4桁」だけでも予定登録できます。/, "initial intake guidance allows name + last4");
assert.match(source, /if \(selectedVehicleIds\.length <= 1 && !registrationNumber\.trim\(\) && !registrationLast4\.trim\(\)\)/, "manual initial intake accepts last4 without full registration");

console.log("schedule registration duplicate regression: ok");
