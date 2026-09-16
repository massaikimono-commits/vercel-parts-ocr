import fs from "node:fs";

const search = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");
const v2 = fs.readFileSync("app/vehicle-workflow-v2/page.tsx", "utf8");
const fast = fs.readFileSync("app/vehicle-workflow-fast/page.tsx", "utf8");
const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");

const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

assert(!/部品履歴をまとめて確認/.test(search), "vehicle search must not advertise parts/history UI");
assert(/\/vehicle-workflow\?mode=new/.test(home), "home vehicle registration must remain an independent mode=new entry");
assert(/複数台を一括登録/.test(v2) && /\/customer-vehicles\/bulk-import/.test(v2), "bulk registration entry must remain available");
assert(/searchParams\.get\(["']mode["']\)\s*===\s*["']new["']/.test(v2), "v2 must preserve mode=new");
assert(/newRegistrationMode/.test(fast), "fast workflow must preserve new-registration mode");
assert(/setVehicles\(\[\]\)/.test(fast), "new-registration mode must preserve existing-vehicle suppression");
console.log("vehicle search / registration separation regression: PASS");
