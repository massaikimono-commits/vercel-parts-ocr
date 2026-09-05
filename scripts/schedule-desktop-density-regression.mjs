import fs from "node:fs";

const source = fs.readFileSync("app/schedule/page.tsx", "utf8");
const printSource = fs.readFileSync("app/schedule/print/page.tsx", "utf8");
const failures = [];

for (const expected of [
  "@media screen and (min-width:721px)",
  ".page{max-width:1440px",
  ".scheduleItem{padding:6px 8px",
  ".itemMain{display:block;min-width:0;flex:1",
  ".customer{font-size:14px",
  ".meta span{padding:2px 5px;font-size:10px",
  "@media(max-width:720px)",
  "@media print{",
]) {
  if (!source.includes(expected)) failures.push("missing from schedule page: " + expected);
}

if (!source.includes("/schedule/print?day=")) {
  failures.push("schedule page no longer routes print action to /schedule/print");
}

for (const expected of [
  "@page{size:A3 portrait",
  ".sheet{position:relative;width:min(96vw,1400px);aspect-ratio:297/420",
  ".sheet{width:${PRINT_LAYOUT.page.widthMm}mm;height:${PRINT_LAYOUT.page.heightMm}mm",
]) {
  if (!printSource.includes(expected)) failures.push("missing from dedicated print page: " + expected);
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
console.log("- schedule print action routes to the dedicated print page");
console.log("- dedicated print preview stays proportional and print output remains exact A3 portrait");
