import fs from "node:fs";
const src = fs.readFileSync("app/schedule/page.tsx", "utf8");
const checks = [
  ["parent spec previous-day label", src.includes('>← 前日</button>')],
  ["parent spec today label", src.includes('setDay(localDateString())}>今日</button>')],
  ["parent spec tomorrow label", src.includes('setDay(addDay(day, 1))}>明日 →</button>')],
  ["rejected next-day label absent", !src.includes('setDay(addDay(day, 1))}>翌日 →</button>')],
  ["tomorrow action still advances displayed day", src.includes('setDay(addDay(day, 1))')],
];
for (const [name, ok] of checks) if (!ok) throw new Error(`FAIL ${name}`);
console.log("daily schedule parent-spec navigation regression: PASS");
