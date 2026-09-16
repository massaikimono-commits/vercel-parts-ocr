import fs from "node:fs";

const search = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");
const searchLayout = fs.readFileSync("app/customer-vehicles/layout.tsx", "utf8");
const bulk = fs.readFileSync("app/customer-vehicles/bulk-import/page.tsx", "utf8");
const bulkLayout = fs.readFileSync("app/customer-vehicles/bulk-import/layout.tsx", "utf8");
const v2 = fs.readFileSync("app/vehicle-workflow-v2/page.tsx", "utf8");
const fast = fs.readFileSync("app/vehicle-workflow-fast/page.tsx", "utf8");
const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");

const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

assert(/searchCard \.searchIntro.*display:none/.test(searchLayout), "vehicle search history intro must be hidden from search UI");
assert(/searchCard \.bulkImportAction.*display:none/.test(searchLayout), "bulk registration must not be exposed from vehicle search UI");
assert(/section\.card:has\(\.historyList\).*display:none/.test(searchLayout), "parts history card must not be displayed in vehicle search UI");
assert(!/customer-vehicles\/history/.test(searchLayout) && !/部品履歴<\/button>/.test(searchLayout), "vehicle search dock must not expose history actions");
assert(/content:\"車両検索\"/.test(searchLayout), "vehicle search must present the dedicated 車両検索 title");
assert(/\/vehicle-workflow\?mode=new/.test(home), "home vehicle registration must remain an independent mode=new entry");
assert(/複数台を一括登録/.test(v2) && /\/customer-vehicles\/bulk-import/.test(v2), "bulk registration entry must remain available");
assert(/searchParams\.get\(["']mode["']\)\s*===\s*["']new["']/.test(v2), "v2 must preserve mode=new");
assert(/newRegistrationMode/.test(fast), "fast workflow must preserve new-registration mode");
assert(/setVehicles\(\[\]\)/.test(fast), "new-registration mode must preserve existing-vehicle suppression");
assert(/type=\"file\"/.test(bulk) && /multiple/.test(bulk), "bulk import must preserve multiple PDF input");
assert(/import_vehicle_certificates_batch_v1/.test(bulk), "bulk import RPC contract must remain unchanged");
assert(/parseVehicleCertificatePdfStructured/.test(bulk) && /parseVehicleCertificatePdfNative/.test(bulk), "PDF Native v3/v2 chain must remain intact");
assert(/\/vehicle-workflow\?mode=new/.test(bulkLayout), "bulk import app back action must return to registration flow");
assert(!/location\.assign\(\"\/customer-vehicles\"\)/.test(bulkLayout), "bulk import app back action must not return to vehicle search");
assert(/\.bulkRegistrationFlow \.page>\.top button:first-child\{display:none!important\}/.test(bulkLayout), "legacy bulk-import search back action must be hidden");
assert(/顧客・車両・部品履歴/.test(search), "history data contract/source remains present and is not deleted by UI separation");
console.log("vehicle search / registration separation regression: PASS");
