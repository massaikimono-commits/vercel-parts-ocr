import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const scheduleNew = read("app","schedule","new","page.tsx");
const scheduleEdit = read("app","schedule","edit","page.tsx");
const inspectionPrint = read("app","inspection","print","page.tsx");
const sql = read("database","app-core-v1-safety-functions.sql");
function assert(condition, message) {
  if (!condition) {
    console.error(`app-core safety regression failed: ${message}`);
    process.exit(1);
  }
}
assert(scheduleNew.includes('supabase.rpc("find_schedule_registration_duplicates"'), "schedule registration must check duplicates");
assert(scheduleNew.includes('supabase.rpc("create_schedule_registration_v2"'), "schedule registration must be atomic");
assert(scheduleNew.includes("p_existing_vehicle_id"), "existing vehicle reuse must remain supported");
assert(scheduleNew.includes("納車予定は入庫・作業予定の終了後"), "delivery must not precede inbound/work end");
assert(!scheduleNew.includes('supabase.rpc("create_manual_schedule_registration"'), "legacy partial schedule RPC must not be used");
assert(!scheduleNew.includes('.from("schedule_entries").insert({'), "delivery insert must stay inside atomic RPC");
assert(scheduleEdit.includes('supabase.rpc("reschedule_schedule_entry_v2"'), "reschedule and stay details must be atomic");
assert(!scheduleEdit.includes("saveWorkDetails"), "separate stay write must not return");
assert(inspectionPrint.includes("canFinalizeRecordTemplatePrint"), "record print must honor finalization gate");
assert(inspectionPrint.includes("印刷完了を記録"), "printed status must require explicit user confirmation");
assert(!inspectionPrint.includes("printAndMark"), "print must not pre-mark printed");
assert(sql.includes("create_schedule_registration_v2"), "DB safety manifest must track atomic registration");
assert(sql.includes("reschedule_schedule_entry_v2"), "DB safety manifest must track atomic reschedule");
assert(sql.includes("loaner vehicle is already reserved for this period"), "DB safety manifest must track loaner conflict guard");
assert(sql.includes("active loaner reservations must be cleared"), "DB safety manifest must track loaner status guard");
console.log("app-core safety regression passed");
