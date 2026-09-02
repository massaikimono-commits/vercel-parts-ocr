import fs from "node:fs";

const day = fs.readFileSync("app/schedule/page.tsx", "utf8");
const week = fs.readFileSync("app/schedule/week/page.tsx", "utf8");

const failures = [];

for (const expected of [
  'className="deliveryColumn"',
  'className="inboundColumn"',
  '.periodSection .columns{grid-template-columns:minmax(0,1fr) minmax(0,1fr)',
  '.periodSection .deliveryColumn{grid-column:1;grid-row:1}',
  '.periodSection .inboundColumn{grid-column:2;grid-row:1}',
  '@media print{',
  '@page{size:A3 portrait',
]) {
  if (!day.includes(expected)) failures.push("day schedule missing: " + expected);
}

for (const expected of [
  'prepareDailyReportSection',
  'function prepareWeekDaySection',
  'const morningReport = prepareWeekDaySection(dayRows, "morning")',
  'const afternoonReport = prepareWeekDaySection(dayRows, "afternoon")',
  'className="miniColumns"',
  'className="miniColumn deliveryMini"',
  'className="miniColumn inboundMini"',
  'grid-template-columns:minmax(0,1fr) minmax(0,1fr)',
  'scroll-snap-type:x mandatory',
]) {
  if (!week.includes(expected)) failures.push("week schedule missing: " + expected);
}

if (failures.length) {
  console.error("FAIL daily-report screen layout regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS daily-report screen layout regression");
console.log("- mobile one-day schedule keeps delivery left and inbound right");
console.log("- weekly days use morning/afternoon daily-report sections");
console.log("- A3 one-day print remains present and separate");
