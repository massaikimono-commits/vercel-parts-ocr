import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function assert(ok, message) { if (!ok) throw new Error(message); }

const week = read("app/schedule/week/page.tsx");
const month = read("app/schedule/month/page.tsx");
const controller = read("app/responsive-ux-controller.tsx");
const edit = read("app/schedule/edit/page.tsx");

assert(week.includes("/schedule/detail?entry="), "weekly cards must open schedule detail from source");
assert(!week.includes("function editEntry("), "weekly source must not retain editEntry navigation helper");
assert(week.includes("の予定詳細を開く`"), "weekly aria-label must be source-defined");
assert(week.includes("予定カードから予定詳細を開けます。"), "weekly hint must be source-defined");
assert(month.includes("/schedule/detail?entry="), "monthly cards must open schedule detail from source");
assert(month.includes("aria-label={`${customerName(customer)}の予定詳細を開く`}"), "monthly aria-label must be source-defined");
assert(!controller.includes("replaceSchedulingCopy"), "global schedule label replacement must be removed");
assert(!controller.includes("replaceAll(\"予約変更\""), "global 予約変更 replacement must be removed");
assert(!controller.includes("WEEK_HINT"), "weekly hint DOM override must be removed");
assert(!controller.includes(".homeWeekRow"), "home weekly click intercept must be removed after source migration");
assert(edit.includes("予約変更") || edit.includes("変更"), "edit screen change semantics must remain present");

console.log("Schedule source/DOM cleanup regression: PASS");
