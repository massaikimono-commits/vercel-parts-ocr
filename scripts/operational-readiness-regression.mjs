import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const layout = read("app/layout.tsx");
const guard = read("app/operational-recovery-guard.tsx");
const nav = read("app/mobile-quick-nav.tsx");
const errorBoundary = read("app/error.tsx");
const home = read("app/home-dashboard.tsx");
const week = read("app/schedule/week/page.tsx");
const day = read("app/schedule/page.tsx");
const search = read("app/schedule/search/page.tsx");
const detail = read("app/schedule/detail/page.tsx");
const history = read("app/customer-vehicles/history/page.tsx");
const parts = read("app/parts-data/page.tsx");
const customerVehicles = read("app/customer-vehicles/page.tsx");
const controller = read("app/responsive-ux-controller.tsx");

assert(layout.includes('import OperationalRecoveryGuard from "./operational-recovery-guard"'), "operational recovery guard must be mounted");
assert(layout.includes("<OperationalRecoveryGuard />"), "operational recovery guard must render inside authenticated shell");

assert(guard.includes("SLOW_LOAD_MS = 18000"), "slow-load fail-safe must have a bounded delay");
assert(guard.includes('window.addEventListener("online"') && guard.includes('window.addEventListener("offline"'), "online/offline recovery must be wired");
assert(guard.includes("pageStillLoading()"), "slow-load warning must only appear when a loading marker remains");
assert(guard.includes("location.reload()") && guard.includes('location.assign("/")'), "recovery must offer retry and home escape routes");
assert(guard.includes("/schedule/print") && guard.includes("/parts-print") && guard.includes("/inspection/print"), "print routes must be excluded from recovery UI");
assert(!guard.includes("supabase") && !guard.includes("fetch("), "recovery guard must add zero data/network work");
assert(guard.includes('font-size:16px!important'), "mobile form controls must avoid iOS auto-zoom");
assert(guard.includes("safe-area-inset-bottom"), "recovery UI must respect iPhone safe-area and quick nav");
assert(guard.includes(":focus-visible"), "keyboard focus must remain visible");

assert(nav.includes("todayActive"), "Today quick-nav item must expose selected state");
assert(nav.includes('selectedDay === todayJst()'), "Today selected state must use JST day semantics");
assert(nav.includes('className={todayActive ? "todayShortcut active" : "todayShortcut"}'), "Today selected state must be visual");
assert(nav.includes('aria-current={todayActive ? "page" : undefined}'), "Today selected state must be announced accessibly");
assert(nav.includes("repeat(5,minmax(0,1fr))"), "quick nav must remain five stable items");
assert(nav.includes("safe-area-inset-bottom"), "quick nav must keep iPhone safe-area support");

assert(errorBoundary.includes('role="alert"'), "unexpected route failure must have a visible error state");
assert(errorBoundary.includes("reset()") && errorBoundary.includes('location.assign("/")'), "unexpected route failure must allow retry and escape");
assert(!errorBoundary.includes("error.message"), "unexpected error UI must not expose internal error details");

assert(home.includes('className={`homeWeekRow ${reasonClass}`}') && home.includes('onClick={() => openDay(day)}'), "home weekly rows must navigate from React source to the one-day schedule");
assert(home.includes('aria-label={`${customerName(customer)}の${shortDayLabel(day)}の1日の予定を開く`}'), "home weekly rows must expose a descriptive accessible label");
assert(!home.includes('className={`homeWeekRow ${reasonClass}`} onClick={() => location.assign("/schedule/edit?id="'), "home weekly rows must not retain the old edit-route source contract");
assert(home.includes("予定なし") && home.includes("＋ この日に登録"), "home weekly empty state must retain a clear next action");

for (const [name, source] of [["week", week], ["day", day], ["search", search], ["detail", detail], ["history", history], ["parts", parts], ["customer-vehicles", customerVehicles]]) {
  assert(source.includes("try"), `${name} must have guarded data work`);
  assert(source.includes("catch"), `${name} must surface a failure path`);
}
assert(/finally\s*\{[\s\S]*?setBusy\(false\)/.test(week), "week must always exit loading");
assert(/finally\s*\{[\s\S]*?setBusy\(false\)/.test(day), "daily schedule must always exit loading");
assert(/finally\s*\{[\s\S]*?setBusy\(false\)/.test(search), "schedule search must always exit loading");
assert(/finally\s*\{[\s\S]*?setBusy\(false\)/.test(detail), "schedule detail must always exit loading");
assert(/finally\s*\{[\s\S]*?setBusy\(false\)/.test(history), "vehicle history must always exit loading");
assert(parts.includes("setFormalLoading(false)"), "parts history must always exit formal loading");
assert(customerVehicles.includes("vehicleLoadSeq") && customerVehicles.includes("requestId !== vehicleLoadSeq.current"), "vehicle search must reject stale responses");

assert(detail.includes("次回予定登録") && detail.includes("車両履歴") && detail.includes("部品データ"), "schedule detail must remain an operational hub");
assert(customerVehicles.includes("SEARCH_STATE_KEY") && customerVehicles.includes("sessionStorage.setItem(SEARCH_STATE_KEY"), "customer/vehicle search state must remain session-persistent");
assert(history.includes("SOURCE_PAGE_SIZE = 25") && parts.includes("FORMAL_PAGE_SIZE = 50"), "history/parts loading must remain bounded");
assert(day.includes('"← 前日"') || day.includes("← 前日"), "daily schedule must preserve 前日 wording");
assert(day.includes("明日 →"), "daily schedule must preserve 明日 wording");
assert(controller.includes("new MutationObserver(requestApplyUx)") && controller.includes("requestAnimationFrame"), "existing DOM observer must remain re-entry guarded until a source-level migration is completed");

console.log("Operational readiness regression: PASS");
console.log("- slow/offline recovery: PASS");
console.log("- mobile quick-nav current state: PASS");
console.log("- home weekly source navigation / accessible label: PASS");
console.log("- loading termination contracts: PASS");
console.log("- bounded history/search contracts: PASS");
console.log("- operational hub / business wording preservation: PASS");
