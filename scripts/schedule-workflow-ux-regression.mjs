import fs from "node:fs";

const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");
const scheduleNew = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const scheduleEdit = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");
const scheduleDay = fs.readFileSync("app/schedule/page.tsx", "utf8");
const scheduleWeek = fs.readFileSync("app/schedule/week/page.tsx", "utf8");

const failures = [];

function expect(source, expected, label) {
  if (!source.includes(expected)) failures.push(label + ": missing " + expected);
}

expect(home, 'className="homeWeek"', "home");
expect(home, "1週間のスケジュール", "home");
expect(home, "今週を常に確認", "home");
expect(home, 'location.assign("/schedule/week")', "home");

const homeWeekIndex = home.indexOf('className="homeWeek"');
const mobileTodayIndex = home.indexOf('className="mobileToday"');
if (!(homeWeekIndex >= 0 && mobileTodayIndex > homeWeekIndex)) {
  failures.push("home: weekly schedule is not placed before the daily summary");
}

const customerIndex = scheduleNew.indexOf("<h2>① お客様・車両</h2>");
const workIndex = scheduleNew.indexOf("<h2>② 入庫内容</h2>");
const timeIndex = scheduleNew.indexOf("<h2>③ 日時</h2>");
const deliveryIndex = scheduleNew.indexOf("<h2>④ 納車予定</h2>");
if (!(customerIndex >= 0 && workIndex > customerIndex && timeIndex > workIndex && deliveryIndex > timeIndex)) {
  failures.push("registration: expected customer/vehicle -> work -> date/time -> delivery order");
}


expect(scheduleNew, 'reason === "点検" ? (inspectionScheduleType || null) : null', "inspection schedule type");

const singleInspectionWrites = (
  scheduleNew.match(/p_inspection_schedule_type: reason === "点検" \? \(inspectionScheduleType \|\| null\) : null/g) || []
).length;
const batchInspectionWrites = (
  scheduleNew.match(/inspectionScheduleType: reason === "点検" \? \(inspectionScheduleType \|\| null\) : null/g) || []
).length;

if (singleInspectionWrites !== 1) {
  failures.push("inspection schedule type: single registration must clear the value outside 点検");
}
if (batchInspectionWrites !== 1) {
  failures.push("inspection schedule type: JSONB batch registration must clear the value outside 点検");
}

expect(scheduleEdit, "取消理由（任意）", "cancellation");
expect(scheduleEdit, "p_reason:cancelReason.trim() || null", "cancellation");
if (scheduleEdit.includes("取消理由（必須）") || scheduleEdit.includes("取消理由を入力してください。")) {
  failures.push("cancellation: reason is still mandatory");
}
if (scheduleEdit.includes("disabled={busy||!cancelReason.trim()}")) {
  failures.push("cancellation: confirm button is still blocked by an empty reason");
}

expect(scheduleDay, '<div className="eyebrow">1日の予定</div>', "day schedule");
expect(scheduleDay, ">1週間のスケジュール</button>", "day schedule");
expect(scheduleWeek, '<div className="eyebrow">1週間のスケジュール</div>', "week schedule");

if (failures.length) {
  console.error("FAIL schedule workflow UX regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS schedule workflow UX regression");
console.log("- home is weekly-schedule first");
console.log("- registration starts with customer/vehicle, then work, then date/time");
console.log("- inspection schedule type is persisted only for reason=点検");
console.log("- cancellation reason is optional");
console.log("- daily/weekly schedule labels are distinct and consistent");
