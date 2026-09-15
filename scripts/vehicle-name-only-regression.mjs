import fs from "node:fs";

function assert(ok, message) { if (!ok) { console.error(`FAIL: ${message}`); process.exit(1); } console.log(`PASS: ${message}`); }
const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");
const schedule = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
assert(home.includes("＋ 車両登録"), "mobile home exposes vehicle registration shortcut");
assert(home.includes("車両だけ先に登録"), "desktop home exposes vehicle registration shortcut");
assert(home.includes('location.assign("/vehicle-workflow")'), "vehicle shortcut reuses existing vehicle workflow");
assert(schedule.includes("お客様名だけ"), "schedule explains name-only provisional registration");
assert(!schedule.includes("登録番号またはナンバー下4桁を入力してください。"), "plate number is no longer client-required");
assert(schedule.includes("if (selectedVehicleIds.length <= 1 && !customerName.trim())"), "customer name remains required for single/new registration");
assert(schedule.includes("resolvedVehicleId") && schedule.includes("sameDayVehicleScheduleWarnings([resolvedVehicleId])"), "same-day vehicle warning remains vehicle-id scoped");
assert(schedule.includes("p_existing_vehicle_id: selectedVehicleForSubmitNow || null"), "existing vehicle linkage remains unchanged");
assert(schedule.includes("p_registration_last4:"), "plate data continues to be submitted when available");
console.log("VEHICLE_NAME_ONLY_REGRESSION_PASS");
