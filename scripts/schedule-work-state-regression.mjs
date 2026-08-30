import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schedulePath = path.join(root, "app", "schedule", "page.tsx");
const homePath = path.join(root, "app", "home-dashboard.tsx");

const schedule = fs.readFileSync(schedulePath, "utf8");
const home = fs.readFileSync(homePath, "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`schedule work-state regression failed: ${message}`);
    process.exit(1);
  }
}

assert(schedule.includes("toggleWorkProgress"), "schedule list must keep one-click progress control");
assert(schedule.includes("toggleWorkCompleted"), "schedule list must keep one-click work completion control");
assert(schedule.includes("作業未実施"), "pending work state must remain visible in the schedule list");
assert(schedule.includes("作業中"), "in-progress work state must remain visible in the schedule list");
assert(schedule.includes("作業完了"), "completed work state must remain visible in the schedule list");
assert(schedule.includes('supabase.rpc("set_work_order_progress_state"'), "progress changes must keep using the existing RPC");
assert(schedule.includes('"complete_work_order_one_tap"'), "completion must keep using the existing one-tap RPC");
assert(schedule.includes('"reopen_work_order"'), "work completion must remain reversible from the schedule list");

const combinedNavigation = `${home}\n${schedule}`;
for (const forbidden of [
  'href="/work-complete"',
  'href="/work-completed"',
  'href="/delivery-complete"',
  'href="/delivery-completed"',
]) {
  assert(!combinedNavigation.includes(forbidden), `standalone completion menu must not be introduced: ${forbidden}`);
}

console.log("schedule work-state regression passed");
