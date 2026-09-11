import fs from "node:fs";
const src = fs.readFileSync("app/schedule/week/page.tsx", "utf8");
const moveWeekBody = src.match(/function moveWeek\(delta: number\) \{([\s\S]*?)\n  \}/)?.[1] || "";
const currentWeekBody = src.match(/function goCurrentWeek\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";
const checks = [
  ["moveWeek helper exists", src.includes("function moveWeek(delta: number)")],
  ["week movement updates visible week", src.includes("setWeekStart(nextStart)")],
  ["week movement synchronizes jump day", src.includes("setJumpDay(nextStart)")],
  ["current week synchronizes today", src.includes("setJumpDay(today)") && src.includes("setWeekStart(mondayOf(today))")],
  ["previous week uses synchronized helper", src.includes("onClick={() => moveWeek(-1)}")],
  ["next week uses synchronized helper", src.includes("onClick={() => moveWeek(1)}")],
  ["current week uses synchronized helper", src.includes("onClick={goCurrentWeek}")],
  ["month navigation remains anchored to jumpDay", src.includes("/schedule/month?day=\" + jumpDay")],
  ["week movement remains local-state only", moveWeekBody.length > 0 && !/supabase|fetch\(|loadWeek\(|location\./.test(moveWeekBody)],
  ["current-week movement remains local-state only", currentWeekBody.length > 0 && !/supabase|fetch\(|loadWeek\(|location\./.test(currentWeekBody)],
];
for (const [name, ok] of checks) { if (!ok) throw new Error(`FAIL ${name}`); }
console.log("week navigation anchor sync regression: PASS");
