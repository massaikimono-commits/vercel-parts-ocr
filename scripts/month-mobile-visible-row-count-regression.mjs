import fs from "node:fs";
const src = fs.readFileSync("app/schedule/month/page.tsx", "utf8");
const checks = [
  ["desktop month still renders three source rows", src.includes("rows.slice(0, 3)")],
  ["mobile keeps the same three visible rows", src.includes(".monthRows .monthRow:nth-child(n+4){display:none}")],
  ["old two-row mobile hiding removed", !src.includes(".monthRows .monthRow:nth-child(n+3){display:none}")],
  ["existing more count remains based on three visible rows", src.includes("rows.length > 3") && src.includes("rows.length - 3")],
  ["more button still opens selected day", src.includes("className=\"more\" onClick={() => openDay(day)}")],
];
for (const [name, ok] of checks) if (!ok) throw new Error(`FAIL ${name}`);
for (const token of ["MutationObserver", "addEventListener", "localStorage", "sessionStorage"]) {
  if (src.includes(token)) throw new Error(`FAIL performance coupling ${token}`);
}
console.log("month mobile visible row count regression: PASS");
