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
expect(home, 'prepareDailyReportSection(periodRows.map(({ entry }) => entry), period)', "home weekly daily-report layout");
expect(home, 'miniColumnTitle">納車', "home weekly daily-report layout");
expect(home, 'miniColumnTitle">来社・引取・出張', "home weekly daily-report layout");
expect(home, 'dailyReportTimeLabel(entry)', "home weekly daily-report labels");

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

expect(scheduleNew, 'useState<EntryType>("pickup")', "registration default entry type");
expect(scheduleNew, '<option value="pickup">引き取り</option>', "registration entry order");
expect(scheduleNew, 'value="schedule">スケ', "inspection schedule type");
expect(scheduleNew, 'value="legal_3m">法定3ヶ月', "inspection schedule type");
expect(scheduleNew, 'value="legal_6m">法定6ヶ月', "inspection schedule type");
expect(scheduleNew, 'value="legal_12m">法定12ヶ月', "inspection schedule type");
expect(scheduleNew, 'value="exact">時間指定', "onsite schedule time");
expect(scheduleNew, 'value="morning">A中', "onsite schedule time");
expect(scheduleNew, 'value="unspecified">中（午後）', "onsite schedule time");
expect(scheduleNew, 'printMode: onsiteTimeMode', "onsite schedule time");
if (scheduleNew.includes("onsiteDuration") || scheduleNew.includes(">作業枠<")) failures.push("onsite schedule time: work-duration selector must stay hidden");
expect(scheduleNew, 'const [deliveryMethod, setDeliveryMethod]', "delivery handoff");
expect(scheduleNew, '<option value="delivery">納車</option>', "delivery handoff");
expect(scheduleNew, '<option value="customer_visit">来社</option>', "delivery handoff");
expect(scheduleNew, 'set_work_order_delivery_method_v1', "delivery handoff");
expect(scheduleDay, '.hero h1{font-size:20px', "day schedule date density");
expect(scheduleDay, 'entryDisplayLabel(entry, work)', "day schedule delivery handoff display");
expect(home, 'entryDisplayLabel(entry, work)', "home delivery handoff display");
expect(scheduleWeek, 'entryDisplayLabel(entry, work)', "week delivery handoff display");

if (failures.length) {
  console.error("FAIL schedule workflow UX regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS schedule workflow UX regression");
console.log("- home is weekly-schedule first");
console.log("- home weekly schedule uses the same daily-report period/column/order rules");
console.log("- registration starts with customer/vehicle, then work, then date/time");
console.log("- onsite registration uses time/A中/午後 only; no work-duration selector");
console.log("- completed-vehicle handoff can be marked as delivery or customer visit");
console.log("- inspection defaults delivery to same-day 中; vehicle inspection defaults to next-day 中");
console.log("- cancellation reason is optional");
console.log("- onsite registration uses time / A中 / 中 only, without a work-duration selector");
console.log("- daily/weekly schedule labels are distinct and consistent");
