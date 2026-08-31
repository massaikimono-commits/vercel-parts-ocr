import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schedulePath = path.join(root, "app", "schedule", "page.tsx");
const homePath = path.join(root, "app", "home-dashboard.tsx");
const scheduleNewPath = path.join(root, "app", "schedule", "new", "page.tsx");

const schedule = fs.readFileSync(schedulePath, "utf8");
const home = fs.readFileSync(homePath, "utf8");
const scheduleNew = fs.readFileSync(scheduleNewPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`schedule work-state regression failed: ${message}`);
    process.exit(1);
  }
}

assert(schedule.includes("toggleWorkProgress"), "schedule list must keep progress state RPC control");
assert(schedule.includes("toggleWorkCompleted"), "schedule list must keep work completion RPC control");
assert(schedule.includes("advanceWorkState"), "schedule list must expose the sequential work-state control");
assert(!schedule.includes("completeWorkNow"), "schedule list must not split completion into a separate shortcut button");
assert(schedule.includes("作業未実施"), "pending work state must remain visible in the schedule list");
assert(schedule.includes("作業中"), "in-progress work state must remain visible in the schedule list");
assert(schedule.includes("作業完了"), "completed work state must remain visible in the schedule list");
assert(schedule.includes('supabase.rpc("set_work_order_progress_state"'), "progress changes must keep using the existing RPC");
assert(schedule.includes('"complete_work_order_one_tap"'), "completion must keep using the existing one-tap RPC");
assert(schedule.includes('"reopen_work_order"'), "work completion must remain reversible from the schedule list");
assert(home.includes('work?.status === "in_progress"'), "home must distinguish running work from pending work");
assert(home.includes('"作業中"'), "home must visibly label running work");
assert(!schedule.includes("q !== day"), "daily schedule must not reset a user-selected date back to the URL query");
assert(!scheduleNew.includes("q !== day"), "new schedule form must not reset a user-selected date back to the URL query");
assert(scheduleNew.includes("repeat(3,minmax(0,1fr))"), "mobile schedule time slots must use a readable three-column grid");

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
