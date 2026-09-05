import fs from "node:fs";

const day = fs.readFileSync("app/schedule/page.tsx", "utf8");
const week = fs.readFileSync("app/schedule/week/page.tsx", "utf8");
const printPage = fs.readFileSync("app/schedule/print/page.tsx", "utf8");

const failures = [];

for (const expected of [
  'className="dailyBoardHeader"',
  'className="dailyBoardCell deliveryCell"',
  'className="dailyBoardCell inboundCell"',
  ".dailyBoardRow{display:grid;grid-template-columns:1fr 1fr",
  ".dailyBoardCell+.dailyBoardCell{border-left:1px solid #ccd7e5",
  "@media print{",
]) {
  if (!day.includes(expected)) failures.push("day schedule missing: " + expected);
}

if (!day.includes("/schedule/print?day=")) {
  failures.push("day schedule missing dedicated print-page route");
}

for (const expected of [
  "@page{size:A3 portrait",
  ".sheet{position:relative;width:min(96vw,1400px);aspect-ratio:297/420",
  ".sheet{width:${PRINT_LAYOUT.page.widthMm}mm;height:${PRINT_LAYOUT.page.heightMm}mm",
]) {
  if (!printPage.includes(expected)) failures.push("dedicated print page missing: " + expected);
}

for (const expected of [
  "prepareDailyReportSection",
  "function prepareWeekDaySection",
  'const morningReport = prepareWeekDaySection(dayRows, "morning")',
  'const afternoonReport = prepareWeekDaySection(dayRows, "afternoon")',
  'className="miniColumns"',
  'className="miniColumn deliveryMini"',
  'className="miniColumn inboundMini"',
  "grid-template-columns:minmax(0,1fr) minmax(0,1fr)",
  "scroll-snap-type:x mandatory",
]) {
  if (!week.includes(expected)) failures.push("week schedule missing: " + expected);
}

if (failures.length) {
  console.error("FAIL daily-report screen layout regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS daily-report screen layout regression");
console.log("- one-day schedule keeps the accepted daily-report board: delivery left, inbound right");
console.log("- weekly days use morning/afternoon daily-report sections");
console.log("- day schedule routes printing to the dedicated print page");
console.log("- print preview stays proportional and physical print remains exact A3 portrait");
