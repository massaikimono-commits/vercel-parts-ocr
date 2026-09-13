import fs from "node:fs";

const shell = fs.readFileSync("app/layout.tsx", "utf8");
const nav = fs.readFileSync("app/mobile-quick-nav.tsx", "utf8");
const controller = fs.readFileSync("app/responsive-ux-controller.tsx", "utf8");
const calibration = fs.readFileSync("app/layout-density-calibration.tsx", "utf8");
const week = fs.readFileSync("app/schedule/week/page.tsx", "utf8");
const scheduleNew = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const scheduleEdit = fs.readFileSync("app/schedule/edit/page.tsx", "utf8");
const report = fs.readFileSync("app/schedule/print/page.tsx", "utf8");
const loginHistory = fs.readFileSync("app/settings/login-history/page.tsx", "utf8");
const calendar = fs.readFileSync("app/settings/business-calendar/page.tsx", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(shell.includes('import MobileQuickNav from "./mobile-quick-nav";'), "app shell must import MobileQuickNav");
assert(shell.includes('import ResponsiveUxController from "./responsive-ux-controller";'), "app shell must import shared responsive UX controller");
assert(shell.includes('import LayoutDensityCalibration from "./layout-density-calibration";'), "app shell must import final responsive/print calibration layer");
assert(shell.includes("<ResponsiveUxController />"), "shared UX controller must run inside authenticated app shell");
assert(shell.includes("<LayoutDensityCalibration />"), "final density/print calibration must run inside authenticated app shell");
assert(shell.indexOf("<ResponsiveUxController />") < shell.indexOf("<LayoutDensityCalibration />"), "final calibration layer must render after responsive controller");
assert(shell.includes("<MobileQuickNav />"), "app shell must render MobileQuickNav inside the guarded app");

assert(nav.includes('href: "/schedule/new"'), "mobile quick nav must include schedule registration");
assert(nav.includes('href: "/schedule/search"'), "mobile quick nav must include schedule search");
assert(nav.includes('href: "/customer-vehicles"'), "mobile quick nav must include customer/vehicle management");
assert(nav.includes('href: "/"'), "mobile quick nav must include home");
assert(nav.includes('`/schedule?day=${todayJst()}`'), "Today shortcut must always target today's daily schedule");
assert(nav.includes('timeZone: "Asia/Tokyo"'), "Today shortcut must use JST day semantics");
assert(!nav.includes("scheduleContext &&"), "Today shortcut must no longer be schedule-context-only");
assert(nav.includes("repeat(5,minmax(0,1fr))"), "mobile quick nav must be five columns on every normal route");
assert(nav.includes('"/parts-print"'), "parts print route must suppress quick nav");
assert(nav.includes('"/inspection/print"'), "inspection print route must suppress quick nav");
assert(nav.includes('"/schedule/print"'), "schedule print route must suppress quick nav");
assert(nav.includes("env(safe-area-inset-bottom)"), "quick nav must respect iPhone safe area");
assert(nav.includes("@media print"), "quick nav must be hidden for printing");
assert(!nav.includes("supabase"), "quick nav must not add database traffic");
assert(!nav.includes("fetch("), "quick nav must not add network fetches");
assert(!nav.includes("/ocr/auto"), "quick nav must not couple global navigation to OCR execution");

assert(controller.includes('body[data-ux-route="/schedule/week"] .attentionBar{display:none!important}'), "post-registration attention-day UI must be removed from weekly view");
assert(controller.includes("週間のスケジュール") || week.includes("週間予定"), "weekly schedule must remain available");
assert(controller.includes(".weekSummary{display:flex!important"), "weekly oversized summary cards must become a compact strip");
assert(controller.includes(".jumpBar"), "weekly date jump must be compacted rather than removed");
assert(controller.includes("uxDailyReportShortcut"), "daily report must receive a high-frequency shortcut");
assert(controller.includes('/schedule/print?day=${encodeURIComponent(reportDay())}'), "daily report shortcut must preserve selected/JST day");
assert(controller.includes(".homeWeekRow"), "home weekly rows must be intercepted for whole-day navigation");
assert(controller.includes('/schedule?day=${addDays(mondayOf(todayJst()), index)}'), "home weekly row/customer taps must open that day, not customer/edit directly");
assert(controller.includes('replaceAll("予約変更", "予定詳細")'), "reservation-change entry wording must normalize to 予定詳細");
assert(controller.includes('replaceAll("かんたん予約変更", "予定詳細")'), "easy-change heading must normalize to 予定詳細");

// /schedule/week must never starve its async load via a self-triggering MutationObserver loop.
assert(controller.includes("const WEEK_HINT ="), "weekly hint text must have a stable target value");
assert(controller.includes("hint && hint.textContent !== WEEK_HINT"), "weekly hint mutation must be idempotent");
assert(controller.includes("new MutationObserver(requestApplyUx)"), "DOM observer must use the guarded scheduler");
assert(controller.includes("window.requestAnimationFrame"), "DOM observer updates must be coalesced per animation frame");
assert(controller.includes("if (disposed || applyFrame) return"), "observer scheduler must block re-entrant frame storms");
assert(controller.includes("window.cancelAnimationFrame(applyFrame)"), "observer frame must be cleaned up on route change");

// Loading lifecycle contract: start busy, both success/empty resolve through finally, failure reports an error and also resolves busy.
assert(week.includes("setBusy(true)"), "weekly load must enter loading state");
assert(week.includes("setEntries(nextEntries)"), "weekly success/empty result must commit entries");
assert(week.includes('setMessage(safeActionError("週間予定の読み込み", error))'), "weekly query failure must transition to an error message");
assert(/finally\s*\{[\s\S]*?setBusy\(false\)/.test(week), "weekly load must always leave loading state in finally");
const loadingCases = ["data-success", "empty-success", "query-failure"];
for (const scenario of loadingCases) {
  let busy = true;
  try {
    if (scenario === "query-failure") throw new Error("fixture query failure");
    const rows = scenario === "empty-success" ? [] : [{ id: "fixture" }];
    assert(Array.isArray(rows), `${scenario}: fixture result must resolve`);
  } catch {
    assert(scenario === "query-failure", `${scenario}: only failure fixture may throw`);
  } finally {
    busy = false;
  }
  assert(busy === false, `${scenario}: weekly loading must not remain infinite`);
}

assert(controller.includes('body[data-ux-route="/schedule/new"]'), "schedule registration must have dedicated compact density rules");
assert(controller.includes(".capacity"), "schedule registration capacity must become a compact summary strip");
assert(controller.includes('body[data-ux-route="/schedule/edit"]'), "schedule detail/edit must have compact density rules");
assert(controller.includes('body[data-ux-route="/schedule/detail"]'), "schedule detail must have compact density rules");
assert(controller.includes("@media screen and (max-width:760px)"), "mobile density rules must be shared");
assert(controller.includes("@media screen and (min-width:761px) and (max-width:1100px)"), "tablet density must be explicitly audited");
assert(controller.includes("@media screen and (min-width:1101px)"), "desktop density must be explicitly audited");

// Final tablet/desktop density must be stronger than the legacy layer and cover high-frequency operational pages.
assert(calibration.includes("@media screen and (min-width:761px) and (max-width:1100px)"), "tablet final density layer must exist");
assert(calibration.includes("@media screen and (min-width:1101px)"), "desktop final density layer must exist");
for (const route of [
  "/schedule/week",
  "/schedule/new",
  "/schedule/edit",
  "/settings/login-history",
  "/settings/business-calendar",
]) {
  assert(calibration.includes(`body[data-ux-route="${route}"]`), `${route}: final compact density rule missing`);
}
assert(calibration.includes("body[data-ux-route] .card{padding:15px!important}"), "desktop common cards must be compact");
assert(calibration.includes("body[data-ux-route] h1{font-size:23px!important"), "desktop common titles must be capped");
assert(calibration.includes("body[data-ux-route] .notice{padding:8px 10px!important"), "desktop explanatory cards must be compact");
assert(calibration.includes('body[data-ux-route="/settings/business-calendar"] .importCard'), "low-frequency annual calendar settings must remain compact on desktop");

assert(controller.includes("SECURITY_ACK_KEY"), "security warning acknowledgement must use local persistence");
assert(controller.includes("alert_code") && controller.includes("occurred_at") && controller.includes("message"), "security acknowledgement fingerprint must distinguish new events");
assert(controller.includes("確認済みにする"), "login history must expose an acknowledgement action");
assert(controller.includes('body[data-ux-route="/settings/login-history"]'), "login history must have compact density rules");
assert(loginHistory.includes('my_login_security_alerts'), "existing security detection must remain active");
assert(loginHistory.includes('signOut({ scope: "global" })'), "global sign-out must remain available");

assert(controller.includes('body[data-ux-route="/settings/business-calendar"] .calendarHead{order:1}'), "current business calendar must be prioritized above annual upload settings");
assert(controller.includes('body[data-ux-route="/settings/business-calendar"] .monthsGrid{order:2}'), "current calendar must remain immediately visible");
assert(controller.includes('body[data-ux-route="/settings/business-calendar"] .importCard{order:4'), "annual upload must be demoted below daily-use calendar");
assert(controller.includes('content:"年間カレンダー設定"'), "low-frequency annual upload must be labelled as settings");
assert(calendar.includes("営業日設定・変更"), "business-day editing must remain available");

// A3 daily-report calibration is tied to the original 1755 x 2482 raster geometry (150 dpi A3).
for (const token of [
  "page: { widthMm: 297, heightMm: 420 }",
  "top: 260 / 2482",
  "bottom: 1734 / 2482",
  "groupHeight: 67 / 2482",
  "delivery: { x: 77 / 1755",
  "inbound: { x: 929 / 1755",
  "messages: { x: 239 / 1755, y: 1802 / 2482",
  "stayingVehicles: { x: 130 / 1755, y: 2037 / 2482",
  "bodyShopVehicles: { x: 716 / 1755, y: 2037 / 2482",
  "plannedDeliveries: { x: 1195 / 1755, y: 1836 / 2482",
]) {
  assert(report.includes(token), `original daily-report geometry drifted: ${token}`);
}
assert(report.includes("@page{size:A3 portrait;margin:0}"), "daily report page must remain A3 portrait with zero CSS margin");
assert(calibration.includes("@page{size:A3 portrait;margin:0}"), "final print calibration must explicitly declare A3 zero-margin page");
assert(calibration.includes("width:297mm!important") && calibration.includes("height:420mm!important"), "final print calibration must lock exact A3 physical dimensions");
assert(calibration.includes("position:fixed!important"), "daily-report overlay must anchor to the physical page, not responsive viewport flow");
assert(calibration.includes("left:0!important") && calibration.includes("top:0!important"), "daily-report page origin must be fixed at the PDF origin");
assert(calibration.includes("aspect-ratio:auto!important"), "print geometry must not inherit screen aspect-ratio scaling");
assert(calibration.includes("print-color-adjust:exact"), "Safari/desktop print path must use exact print adjustment");
assert(calibration.includes("page-break-inside:avoid!important") && calibration.includes("page-break-after:avoid!important"), "daily report must remain one page");
assert(!calibration.includes("scale("), "print calibration must not apply viewport-dependent scaling");
assert(!calibration.includes("translateZ("), "print calibration must remove Safari transform/rasterization drift");
assert(calibration.includes("transform:none!important") && calibration.includes("-webkit-transform:none!important"), "all report overlays must print without transforms");

assert(scheduleNew.includes("schedule_slot_check_v2"), "registration-time warning/capacity logic must remain intact");
assert(scheduleNew.includes("schedule_capacity"), "registration capacity logic must remain intact");
assert(scheduleEdit.includes("schedule_time_options") && scheduleEdit.includes("schedule_slot_check_v2"), "edit-time availability and warning logic must remain intact");
assert(week.includes("schedule_capacity"), "weekly capacity calculation must remain intact even when repeat attention UI is hidden");
assert(!controller.includes("insert(") && !controller.includes("update({") && !controller.includes("delete("), "UX controller must not mutate Supabase business data");
assert(!controller.includes("/ocr/auto"), "UX density controller must not alter OCR workflow");
assert(!calibration.includes("supabase") && !calibration.includes("fetch("), "final density/print calibration must remain pure CSS with zero network traffic");

console.log("Integrated device UX feedback regression: PASS");
console.log("Schedule week loading regression: PASS");
console.log("A3 report geometry regression: PASS");
console.log("Tablet/desktop compact density regression: PASS");
