import fs from "node:fs";
import assert from "node:assert/strict";
for (const path of ["app/customer-vehicles/history/page.tsx","app/customer-vehicles/photos/page.tsx"]) {
  const src=fs.readFileSync(path,"utf8");
  assert.ok(src.includes('sessionStorage.setItem("parts-active-vehicle", snapshot)'), `${path}: session handoff`);
  assert.ok(src.includes('localStorage.setItem("parts-active-vehicle", snapshot)'), `${path}: local handoff`);
  assert.ok(src.includes('rememberVehicleAndOpen("/schedule/active")'), `${path}: next schedule shortcut`);
  assert.ok(src.includes('rememberVehicleAndOpen("/inspection")'), `${path}: inspection shortcut`);
  assert.ok(src.includes('この車両で続ける'), `${path}: continuation UI`);
  assert.ok(!src.includes('/ocr/auto'), `${path}: no OCR coupling`);
}
console.log("history/photo continuation regression: PASS");
