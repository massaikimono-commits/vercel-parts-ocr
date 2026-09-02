import fs from "node:fs";

const source = fs.readFileSync("app/schedule/page.tsx", "utf8");
const failures = [];

for (const expected of [
  "@media screen and (min-width:721px)",
  ".page{max-width:1440px",
  ".scheduleItem{padding:6px 8px",
  ".itemMain{display:flex;align-items:center",
  ".customer{font-size:14px",
  ".meta span{padding:2px 5px;font-size:10px",
  "@media(max-width:720px)",
  "@media print{",
  "@page{size:A3 portrait",
]) {
  if (!source.includes(expected)) failures.push("missing: " + expected);
}

const desktopStart = source.indexOf("@media screen and (min-width:721px)");
const mobileStart = source.indexOf("@media(max-width:720px)");
const printStart = source.indexOf("@media print{");
if (!(desktopStart >= 0 && mobileStart > desktopStart && printStart > mobileStart)) {
  failures.push("desktop/mobile/print media blocks are not isolated in the expected order");
}

if (failures.length) {
  console.error("FAIL schedule desktop density regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS schedule desktop density regression");
console.log("- compact layout applies to desktop screen only");
console.log("- mobile breakpoint remains separate");
console.log("- A3 print media remains separate");
