import fs from "node:fs";
const src = fs.readFileSync("app/customer-vehicles/lease-maintenance/page.tsx", "utf8");
const checks = [
  ["vehicle-scoped continue helper exists", src.includes("function rememberVehicleAndOpen(path: string)")],
  ["session active vehicle handoff exists", src.includes('sessionStorage.setItem("parts-active-vehicle", snapshot)')],
  ["local active vehicle handoff exists", src.includes('localStorage.setItem("parts-active-vehicle", snapshot)')],
  ["next booking shortcut exists", src.includes('rememberVehicleAndOpen("/schedule/active")')],
  ["inspection shortcut exists", src.includes('rememberVehicleAndOpen("/inspection")')],
  ["continue actions require loaded vehicle", src.includes("{vehicle && (\n        <section className=\"continueCard card\">")],
  ["no OCR execution shortcut added", !src.includes('rememberVehicleAndOpen("/ocr') && !src.includes('location.assign("/ocr')],
];
for (const [name, ok] of checks) if (!ok) throw new Error(`FAIL ${name}`);
const helper = src.slice(src.indexOf("function rememberVehicleAndOpen"), src.indexOf("async function openSourceDocument"));
for (const token of ["supabase", "fetch(", "MutationObserver", "addEventListener"]) {
  if (helper.includes(token)) throw new Error(`FAIL helper adds runtime work: ${token}`);
}
console.log("lease maintenance continue actions regression: PASS");
