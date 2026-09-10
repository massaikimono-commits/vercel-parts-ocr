import fs from "node:fs";
import assert from "node:assert/strict";

const customerVehicles = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");
const inspection = fs.readFileSync("app/inspection/page.tsx", "utf8");
const activeSchedule = fs.readFileSync("app/schedule/active/page.tsx", "utf8");

assert.ok(customerVehicles.includes('const activeVehiclePayload = JSON.stringify({'), "vehicle selection creates one shared active payload");
assert.ok(customerVehicles.includes('sessionStorage.setItem(ACTIVE_KEY, activeVehiclePayload);'), "vehicle selection keeps session handoff");
assert.ok(customerVehicles.includes('localStorage.setItem(ACTIVE_KEY, activeVehiclePayload);'), "vehicle selection persists handoff for existing operational routes");
assert.ok(customerVehicles.includes('location.assign("/inspection")}>🧾 記録簿'), "vehicle action menu exposes record-book route");
assert.ok(customerVehicles.includes('location.assign("/schedule/active")}>📅 次回予定登録'), "existing next-booking route remains available");
assert.ok(inspection.includes('localStorage.getItem(ACTIVE_KEY)'), "inspection consumes active vehicle handoff");
assert.ok(activeSchedule.includes('localStorage.getItem(ACTIVE_KEY)'), "active schedule consumes active vehicle handoff");
console.log("customer vehicle record handoff regression: PASS");
