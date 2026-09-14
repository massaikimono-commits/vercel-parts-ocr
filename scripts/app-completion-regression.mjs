import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const home = read("app/home-dashboard.tsx");
const day = read("app/schedule/page.tsx");
const week = read("app/schedule/week/page.tsx");
const month = read("app/schedule/month/page.tsx");
const search = read("app/schedule/search/page.tsx");
const detail = read("app/schedule/detail/page.tsx");
const vehicles = read("app/customer-vehicles/page.tsx");
const history = read("app/customer-vehicles/history/page.tsx");
const photos = read("app/customer-vehicles/photos/page.tsx");
const parts = read("app/parts-data/page.tsx");
const controller = read("app/responsive-ux-controller.tsx");
const recovery = read("app/operational-recovery-guard.tsx");
const login = read("app/page.tsx");

assert(home.includes('className="uxDailyReportShortcut"') && home.includes('/schedule/print?day=${todayJst()}'), "home report shortcuts must be source-defined");
assert(day.includes('/schedule/print?day=${day}'), "one-day report action must remain source-defined");
assert(!controller.includes("addDailyReportShortcuts"), "report shortcut DOM injection must be removed");
assert(!controller.includes("reportDay()"), "report-day DOM helper must be removed");
assert(!controller.includes('replaceAll("予約変更"'), "global reservation wording replacement must remain absent");
assert(controller.includes('const observeSecurityDom = pathname === "/" || pathname === "/settings/login-history"'), "MutationObserver must be scoped to security routes");
assert(controller.includes("observeSecurityDom ? new MutationObserver(requestApplyUx) : null"), "MutationObserver must not run on normal routes");
assert(controller.includes("requestAnimationFrame") && controller.includes("if (disposed || applyFrame) return"), "remaining security observer must stay coalesced and re-entry guarded");
assert(home.includes('role="alert"') && home.includes('onClick={() => void loadToday()}') && home.includes('今日の予定を開く'), "home load error must expose retry and next action");
assert(search.includes('検索結果はここに表示されます。') && search.includes('location.assign("/schedule/new")'), "schedule-search empty state must expose registration action");
assert(vehicles.includes('該当する車両がありません。') && vehicles.includes('車両を登録・読取'), "vehicle empty state must expose existing registration route");
assert(week.includes('予定なし') && week.includes('＋ 予定登録'), "weekly empty state must retain registration action");
assert(parts.includes('車両を選択すると、その車両の正式部品履歴だけを読み込みます。') && parts.includes('/vehicle-workflow'), "parts empty state must retain vehicle-selection action");
assert(history.includes('この車両に紐付く既存履歴はまだありません。') && history.includes('/customer-vehicles'), "history empty state must retain vehicle-management exit");
assert(photos.includes('この車両には写真履歴がありません。') && photos.includes('/customer-vehicles'), "photo empty state must retain vehicle-management exit");
assert(detail.includes('予定が見つかりません。') && detail.includes('history.back()'), "detail missing state must retain a way back");
assert(login.includes('aria-label="ログインID"') && login.includes('aria-label="パスワード"'), "login fields must have accessible names");
for (const [name, source] of [["day",day],["week",week],["month",month],["search",search],["detail",detail],["vehicles",vehicles],["history",history],["photos",photos]]) {
  assert(source.includes("finally"), `${name} loading/error path must include finally termination`);
}
assert(recovery.includes("button:focus-visible") && recovery.includes("env(safe-area-inset-bottom)"), "focus-visible and safe-area recovery contracts must remain");
assert(controller.includes('@media screen and (max-width:760px)') && controller.includes('@media screen and (min-width:761px) and (max-width:1100px)') && controller.includes('@media screen and (min-width:1101px)'), "mobile/tablet/desktop source-level breakpoints must remain explicit");

console.log("App completion regression: PASS");
