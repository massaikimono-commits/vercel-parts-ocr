from pathlib import Path

path = Path('app/schedule/week/page.tsx')
s = path.read_text()
old = '''  function jumpToWeek() {
    if (!jumpDay) return;
    setWeekStart(mondayOf(jumpDay));
  }
'''
new = '''  function jumpToWeek() {
    if (!jumpDay) return;
    setWeekStart(mondayOf(jumpDay));
  }

  function moveWeek(delta: number) {
    const nextStart = addDays(weekStart, delta * 7);
    setWeekStart(nextStart);
    setJumpDay(nextStart);
  }

  function goCurrentWeek() {
    const today = todayJst();
    setJumpDay(today);
    setWeekStart(mondayOf(today));
  }
'''
if old not in s:
    raise SystemExit('jumpToWeek anchor not found')
s = s.replace(old, new, 1)
old_buttons = '''          <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← 前週</button>
          <button onClick={() => setWeekStart(mondayOf(todayJst()))}>今週</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}>翌週 →</button>
          <button onClick={() => { window.location.href = "/schedule/month?day=" + jumpDay; }}>月全体</button>'''
new_buttons = '''          <button onClick={() => moveWeek(-1)}>← 前週</button>
          <button onClick={goCurrentWeek}>今週</button>
          <button onClick={() => moveWeek(1)}>翌週 →</button>
          <button onClick={() => { window.location.href = "/schedule/month?day=" + jumpDay; }}>月全体</button>'''
if old_buttons not in s:
    raise SystemExit('week nav buttons anchor not found')
s = s.replace(old_buttons, new_buttons, 1)
path.write_text(s)

reg = Path('scripts/week-navigation-anchor-sync-regression.mjs')
reg.write_text('''import fs from "node:fs";\nconst src = fs.readFileSync("app/schedule/week/page.tsx", "utf8");\nconst checks = [\n  ["moveWeek helper exists", src.includes("function moveWeek(delta: number)")],\n  ["week movement updates visible week", src.includes("setWeekStart(nextStart)")],\n  ["week movement synchronizes jump day", src.includes("setJumpDay(nextStart)")],\n  ["current week synchronizes today", src.includes("setJumpDay(today)") && src.includes("setWeekStart(mondayOf(today))")],\n  ["previous week uses synchronized helper", src.includes("onClick={() => moveWeek(-1)}")],\n  ["next week uses synchronized helper", src.includes("onClick={() => moveWeek(1)}")],\n  ["current week uses synchronized helper", src.includes("onClick={goCurrentWeek}")],\n  ["month navigation remains anchored to jumpDay", src.includes("/schedule/month?day=\\\" + jumpDay")],\n];\nfor (const [name, ok] of checks) { if (!ok) throw new Error(`FAIL ${name}`); }\nconsole.log("week navigation anchor sync regression: PASS");\n''')
