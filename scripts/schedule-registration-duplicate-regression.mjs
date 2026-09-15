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
assert.match(source, /車番がまだ分からない場合は「お客様名だけ」でも予定登録できます。/, "initial intake guidance allows customer name without plate");
assert.match(source, /if \(selectedVehicleIds\.length <= 1 && !customerName\.trim\(\)\)/, "customer name remains required for single/new registration");
assert.doesNotMatch(source, /if \(selectedVehicleIds\.length <= 1 && !registrationNumber\.trim\(\) && !registrationLast4\.trim\(\)\)/, "plate is no longer required for provisional initial intake");
assert.match(source, /const sameDayWarnings = resolvedVehicleId\s*\? await sameDayVehicleScheduleWarnings\(\[resolvedVehicleId\]\)\s*:\s*\[\];/, "vehicle-unconfirmed registration skips vehicle duplicate warning");

console.log("schedule registration duplicate regression: ok");
