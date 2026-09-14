from pathlib import Path
import json


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 match, got {count}: {old[:100]}")
    p.write_text(text.replace(old, new, 1))

# Move daily-report shortcuts out of the DOM controller into React source.
home = Path("app/home-dashboard.tsx")
text = home.read_text()
text = text.replace(
    '<button className="primaryAction" onClick={() => registerDay(todayJst())}>＋ 予定登録</button>\n          <button onClick={() => location.assign("/schedule/search")}>名前・電話・下4桁で予定検索</button>',
    '<button className="primaryAction" onClick={() => registerDay(todayJst())}>＋ 予定登録</button>\n          <button className="uxDailyReportShortcut" onClick={() => location.assign(`/schedule/print?day=${todayJst()}`)}>日報</button>\n          <button onClick={() => location.assign("/schedule/search")}>名前・電話・下4桁で予定検索</button>',
    1,
)
text = text.replace(
    '<div className="desktopTools">\n          <button onClick={() => location.assign("/schedule/search")}><b>予定即検索</b><small>名前・電話・下4桁</small></button>',
    '<div className="desktopTools">\n          <button className="uxDailyReportShortcut" onClick={() => location.assign(`/schedule/print?day=${todayJst()}`)}><b>日報を開く</b><small>今日の日報・A3印刷</small></button>\n          <button onClick={() => location.assign("/schedule/search")}><b>予定即検索</b><small>名前・電話・下4桁</small></button>',
    1,
)
security_block = '''      {securityAlerts.length > 0 && (\n        <section className="card" style={{ border: "2px solid currentColor", marginBottom: 12 }}>'''
if security_block not in text:
    raise SystemExit("home security insertion anchor missing")
# Add a visible terminal error state with existing retry/today actions.
needle = '''      <section className="homeWeek" aria-label="今週のスケジュール">'''
replacement = '''      {loadError && (\n        <div className="notice" role="alert">\n          <b>{loadError}</b>\n          <div className="actions">\n            <button type="button" onClick={() => void loadToday()}>再読み込み</button>\n            <button type="button" onClick={() => openDay(todayJst())}>今日の予定を開く</button>\n          </div>\n        </div>\n      )}\n\n      <section className="homeWeek" aria-label="今週のスケジュール">'''
if text.count(needle) != 1:
    raise SystemExit("home error insertion anchor mismatch")
text = text.replace(needle, replacement, 1)
home.write_text(text)

# Controller keeps only the security DOM bridge; normal navigation/report UI is source-owned.
controller = Path("app/responsive-ux-controller.tsx")
text = controller.read_text()
for block in [
'''function todayJst() {\n  return new Intl.DateTimeFormat("en-CA", {\n    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",\n  }).format(new Date());\n}\n\nfunction addDays(day: string, delta: number) {\n  const d = new Date(`${day}T00:00:00Z`);\n  d.setUTCDate(d.getUTCDate() + delta);\n  return d.toISOString().slice(0, 10);\n}\n\nfunction mondayOf(day: string) {\n  const d = new Date(`${day}T00:00:00Z`);\n  const dow = d.getUTCDay();\n  return addDays(day, dow === 0 ? -6 : 1 - dow);\n}\n\n''',
'''    function reportDay() {\n      const params = new URLSearchParams(location.search);\n      return /^\\d{4}-\\d{2}-\\d{2}$/.test(params.get("day") || "") ? params.get("day")! : todayJst();\n    }\n\n    function addDailyReportShortcuts() {\n      const go = () => location.assign(`/schedule/print?day=${encodeURIComponent(reportDay())}`);\n      if (pathname === "/") {\n        const mobile = document.querySelector<HTMLElement>(".mobileActions");\n        if (mobile && !mobile.querySelector(".uxDailyReportShortcut")) {\n          const button = makeButton("日報", "uxDailyReportShortcut", go);\n          mobile.insertBefore(button, mobile.children[1] || null);\n        }\n        const desktop = document.querySelector<HTMLElement>(".desktopTools");\n        if (desktop && !desktop.querySelector(".uxDailyReportShortcut")) {\n          const button = makeButton("日報を開く", "uxDailyReportShortcut", go);\n          const small = document.createElement("small");\n          small.textContent = "今日の日報・A3印刷";\n          button.appendChild(small);\n          desktop.insertBefore(button, desktop.firstChild);\n        }\n      }\n      if (pathname === "/schedule") {\n        const top = document.querySelector<HTMLElement>("main .top");\n        if (top && !top.querySelector(".uxDailyReportShortcut")) {\n          top.appendChild(makeButton("日報", "uxDailyReportShortcut", go));\n        }\n      }\n    }\n\n'''
]:
    if block not in text:
        raise SystemExit("controller removable block missing")
    text = text.replace(block, "", 1)
text = text.replace(
'''    function applyUx() {\n      addDailyReportShortcuts();\n      applySecurityAcknowledgement();\n    }''',
'''    function applyUx() {\n      applySecurityAcknowledgement();\n    }''',
1)
text = text.replace(
'''    document.addEventListener("click", captureClick, true);\n    const observer = new MutationObserver(requestApplyUx);\n    observer.observe(document.body, { childList: true, subtree: true });\n    applyUx();\n    void loadLatestSecurityAlert();''',
'''    const observeSecurityDom = pathname === "/" || pathname === "/settings/login-history";\n    document.addEventListener("click", captureClick, true);\n    const observer = observeSecurityDom ? new MutationObserver(requestApplyUx) : null;\n    observer?.observe(document.body, { childList: true, subtree: true });\n    applyUx();\n    void loadLatestSecurityAlert();''',
1)
text = text.replace('      observer.disconnect();', '      observer?.disconnect();', 1)
controller.write_text(text)

# Empty-state next actions use existing routes only.
replace_once(
    "app/schedule/search/page.tsx",
    '{!busy && rows.length === 0 && <div className="empty">検索結果はここに表示されます。</div>}',
    '{!busy && rows.length === 0 && <div className="empty">検索結果はここに表示されます。<div className="actions"><button type="button" onClick={() => location.assign("/schedule/new")}>＋ 予定登録</button></div></div>}',
)
replace_once(
    "app/customer-vehicles/page.tsx",
    '{!filteredVehicles.length && <div className="empty">該当する車両がありません。</div>}',
    '{!filteredVehicles.length && <div className="empty">該当する車両がありません。<div className="actions"><button type="button" onClick={() => location.assign("/vehicle-workflow")}>車両を登録・読取</button></div></div>}',
)

# Login fields get explicit accessible names without changing auth behavior.
replace_once(
    "app/page.tsx",
    '<input type="text" autoCapitalize="none" autoCorrect="off" placeholder="ログインID" value={loginId}',
    '<input type="text" aria-label="ログインID" autoCapitalize="none" autoCorrect="off" placeholder="ログインID" value={loginId}',
)
replace_once(
    "app/page.tsx",
    '<input type="password" placeholder="パスワード" value={password}',
    '<input type="password" aria-label="パスワード" placeholder="パスワード" value={password}',
)

regression = Path("scripts/app-completion-regression.mjs")
regression.write_text(r'''import fs from "node:fs";

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
''')

package = Path("package.json")
data = json.loads(package.read_text())
data["scripts"]["test:app-completion"] = "node scripts/app-completion-regression.mjs"
build = data["scripts"]["build"]
needle = "npm run test:schedule-source-dom-cleanup &&"
if "npm run test:app-completion" not in build:
    if needle not in build:
        raise SystemExit("package build insertion point missing")
    build = build.replace(needle, needle + " npm run test:app-completion &&", 1)
data["scripts"]["build"] = build
package.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
