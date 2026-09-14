from pathlib import Path

p = Path("scripts/mobile-quick-nav-regression.mjs")
text = p.read_text()
anchor = 'const controller = fs.readFileSync("app/responsive-ux-controller.tsx", "utf8");\n'
addition = anchor + 'const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");\nconst schedule = fs.readFileSync("app/schedule/page.tsx", "utf8");\n'
if text.count(anchor) != 1:
    raise SystemExit("mobile quick-nav controller source anchor mismatch")
text = text.replace(anchor, addition, 1)
replacements = [
    (
        'assert(controller.includes("uxDailyReportShortcut"), "daily report must receive a high-frequency shortcut");',
        'assert(controller.includes(".uxDailyReportShortcut") && home.includes("uxDailyReportShortcut"), "daily report shortcut must keep shared styling and be source-defined on home");',
    ),
    (
        "assert(controller.includes('/schedule/print?day=${encodeURIComponent(reportDay())}'), \"daily report shortcut must preserve selected/JST day\");",
        "assert(home.includes('/schedule/print?day=${todayJst()}') && schedule.includes('/schedule/print?day=${day}'), \"daily report shortcuts must preserve source-owned JST/selected day semantics\");",
    ),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"mobile quick-nav stale assertion mismatch: {old}")
    text = text.replace(old, new, 1)
p.write_text(text)
