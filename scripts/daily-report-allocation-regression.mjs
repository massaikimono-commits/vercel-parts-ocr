import assert from "node:assert/strict";
import fs from "node:fs";

const allocator = fs.readFileSync(new URL("../app/schedule/daily-report-allocation.ts", import.meta.url), "utf8");
const template = fs.readFileSync(new URL("../app/schedule/daily-report-template.ts", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../app/schedule/print-rules.ts", import.meta.url), "utf8");

assert.match(allocator, /allocateDailyReportDay/, "日報は午前・午後を合わせた23行全体で割り当てる");
assert.match(allocator, /dailyReportRowSlots\(\)/, "日報テンプレートの23行全体を直接使う");
assert.match(allocator, /spareAfternoon/, "午後側の空き行を午前側が使える");
assert.match(allocator, /spareMorning/, "午前側の空き行を午後側が使える");
assert.match(template, /count:\s*23/, "既存日報の23行構成を維持する");
assert.match(rules, /customer_visit:\s*0[\s\S]*pickup:\s*1[\s\S]*onsite_repair:\s*2/, "引取系の並び順を維持する");

function capacities(morningCount, afternoonCount, totalSlots = 23) {
  const baseMorning = Math.ceil(totalSlots / 2);
  const baseAfternoon = totalSlots - baseMorning;
  const morningBaseUsed = Math.min(morningCount, baseMorning);
  const afternoonBaseUsed = Math.min(afternoonCount, baseAfternoon);
  const spareMorning = baseMorning - morningBaseUsed;
  const spareAfternoon = baseAfternoon - afternoonBaseUsed;
  const morningExtra = Math.min(Math.max(0, morningCount - morningBaseUsed), spareAfternoon);
  const afternoonExtra = Math.min(Math.max(0, afternoonCount - afternoonBaseUsed), spareMorning);
  return {
    morningCapacity: morningBaseUsed + morningExtra,
    afternoonCapacity: afternoonBaseUsed + afternoonExtra,
  };
}

assert.deepEqual(capacities(15, 0), { morningCapacity: 15, afternoonCapacity: 0 });
assert.deepEqual(capacities(15, 8), { morningCapacity: 15, afternoonCapacity: 8 });
assert.deepEqual(capacities(8, 15), { morningCapacity: 8, afternoonCapacity: 15 });
assert.deepEqual(capacities(15, 15), { morningCapacity: 12, afternoonCapacity: 11 });

console.log("daily report allocation regression: ok");
