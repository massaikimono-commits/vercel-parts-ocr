from pathlib import Path

p = Path("scripts/mobile-quick-nav-regression.mjs")
text = p.read_text()
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
