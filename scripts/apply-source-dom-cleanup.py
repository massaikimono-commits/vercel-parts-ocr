from pathlib import Path
import json


def require_once(text: str, old: str, label: str) -> None:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")


week = Path("app/schedule/week/page.tsx")
text = week.read_text()
week_replacements = [
    ("onClick={() => editEntry(entry.id)}", "onClick={() => openDetail(entry.id)}", "weekly card click"),
    ("aria-label={`${customerName(customer)}の予約を変更`}", "aria-label={`${customerName(customer)}の予定詳細を開く`}", "weekly aria-label"),
    (
        'function editEntry(id: string) {\n    location.assign("/schedule/edit?id=" + encodeURIComponent(id));\n  }',
        'function openDetail(id: string) {\n    location.assign("/schedule/detail?entry=" + encodeURIComponent(id));\n  }',
        "weekly route helper",
    ),
    (
        "横にスクロールすると1週間を続けて確認できます。上部サマリーと「要確認日のみ表示」で問題日を先に確認でき、予約カードをタップすると空き確認付きの予約変更へ直接進めます。",
        "横にスクロールすると1週間を続けて確認できます。予定カードから予定詳細を開けます。",
        "weekly hint",
    ),
]
for old, new, label in week_replacements:
    require_once(text, old, label)
    text = text.replace(old, new, 1)
week.write_text(text)

month = Path("app/schedule/month/page.tsx")
text = month.read_text()
old = 'className={"monthRow " + reasonClass(work) + (overlaps.has(entry.id) ? " overlapping" : "")}\n                      onClick={() => { window.location.href = "/schedule/edit?id=" + encodeURIComponent(entry.id); }}'
new = 'className={"monthRow " + reasonClass(work) + (overlaps.has(entry.id) ? " overlapping" : "")}\n                      aria-label={`${customerName(customer)}の予定詳細を開く`}\n                      onClick={() => { window.location.href = "/schedule/detail?entry=" + encodeURIComponent(entry.id); }}'
require_once(text, old, "monthly card route")
month.write_text(text.replace(old, new, 1))

controller = Path("app/responsive-ux-controller.tsx")
text = controller.read_text()
week_hint_const = 'const WEEK_HINT = "横にスクロールすると1週間を続けて確認できます。予定カードから予定詳細を開けます。";\n'
require_once(text, week_hint_const, "controller WEEK_HINT")
text = text.replace(week_hint_const, "", 1)
start = text.find("function replaceSchedulingCopy(root: ParentNode) {")
end_marker = "\n\nexport default function ResponsiveUxController()"
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("controller global replacement block not found")
text = text[:start] + text[end + 2 :]
require_once(text, "      replaceSchedulingCopy(document.body);\n", "controller applyUx replacement call")
text = text.replace("      replaceSchedulingCopy(document.body);\n", "", 1)
hint_block = '''      if (pathname === "/schedule/week") {\n        const hint = document.querySelector<HTMLElement>(".hint");\n        if (hint && hint.textContent !== WEEK_HINT) hint.textContent = WEEK_HINT;\n      }\n'''
require_once(text, hint_block, "controller weekly hint override")
text = text.replace(hint_block, "", 1)
home_intercept = '''\n        const scheduleRow = target.closest<HTMLElement>(".homeWeekRow");\n        if (scheduleRow) {\n          const dayCard = scheduleRow.closest<HTMLElement>(".homeWeekDay");\n          const cards = Array.from(document.querySelectorAll<HTMLElement>(".homeWeekDay"));\n          const index = dayCard ? cards.indexOf(dayCard) : -1;\n          if (index >= 0) {\n            event.preventDefault();\n            event.stopPropagation();\n            location.assign(`/schedule?day=${addDays(mondayOf(todayJst()), index)}`);\n          }\n        }\n'''
require_once(text, home_intercept, "controller home week intercept")
text = text.replace(home_intercept, "\n", 1)
controller.write_text(text)

regression = Path("scripts/schedule-source-dom-cleanup-regression.mjs")
regression.write_text('''import fs from "node:fs";\n\nfunction read(path) { return fs.readFileSync(path, "utf8"); }\nfunction assert(ok, message) { if (!ok) throw new Error(message); }\n\nconst week = read("app/schedule/week/page.tsx");\nconst month = read("app/schedule/month/page.tsx");\nconst controller = read("app/responsive-ux-controller.tsx");\nconst edit = read("app/schedule/edit/page.tsx");\n\nassert(week.includes("/schedule/detail?entry="), "weekly cards must open schedule detail from source");\nassert(!week.includes("function editEntry("), "weekly source must not retain editEntry navigation helper");\nassert(week.includes("の予定詳細を開く`"), "weekly aria-label must be source-defined");\nassert(week.includes("予定カードから予定詳細を開けます。"), "weekly hint must be source-defined");\nassert(month.includes("/schedule/detail?entry="), "monthly cards must open schedule detail from source");\nassert(month.includes("aria-label={`${customerName(customer)}の予定詳細を開く`}"), "monthly aria-label must be source-defined");\nassert(!controller.includes("replaceSchedulingCopy"), "global schedule label replacement must be removed");\nassert(!controller.includes("replaceAll(\\\"予約変更\\\""), "global 予約変更 replacement must be removed");\nassert(!controller.includes("WEEK_HINT"), "weekly hint DOM override must be removed");\nassert(!controller.includes(".homeWeekRow"), "home weekly click intercept must be removed after source migration");\nassert(edit.includes("予約変更") || edit.includes("変更"), "edit screen change semantics must remain present");\n\nconsole.log("Schedule source/DOM cleanup regression: PASS");\n''')

package = Path("package.json")
data = json.loads(package.read_text())
data["scripts"]["test:schedule-source-dom-cleanup"] = "node scripts/schedule-source-dom-cleanup-regression.mjs"
needle = "npm run test:cloudflare-architecture"
build = data["scripts"]["build"]
if "npm run test:schedule-source-dom-cleanup" not in build:
    if needle not in build:
        raise SystemExit("build insertion point not found")
    build = build.replace(needle, "npm run test:schedule-source-dom-cleanup && " + needle, 1)
data["scripts"]["build"] = build
package.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
