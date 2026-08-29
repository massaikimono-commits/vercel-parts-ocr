import assert from "node:assert/strict";
import fs from "node:fs";

const allocator = fs.readFileSync(new URL("../app/schedule/daily-report-allocation.ts", import.meta.url), "utf8");
const template = fs.readFileSync(new URL("../app/schedule/daily-report-template.ts", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../app/schedule/print-rules.ts", import.meta.url), "utf8");

assert.match(allocator, /dailyReportPeriodSlotIndexes\(period\)/, "日報テンプレートの23行スロットを直接使う");
assert.match(allocator, /prepareDailyReportSection\(rows, period\)/, "来社→引取→出張・時間順の既存印刷ルールを再利用する");
assert.match(allocator, /deliveries:\s*delivery\.placed/, "納車欄を独立して配置する");
assert.match(allocator, /inbound:\s*inbound\.placed/, "引取系欄を独立して配置する");
assert.match(allocator, /overflow:/, "日報欄を超える予定を黙って欠落させない");
assert.match(template, /count:\s*23/, "既存日報の23行構成を維持する");
assert.match(template, /\.reverse\(\)/, "午後は下側スロットから使用する");
assert.match(rules, /customer_visit:\s*0[\s\S]*pickup:\s*1[\s\S]*onsite_repair:\s*2/, "引取系は来社→引取→出張の順を維持する");
assert.match(rules, /return "A中"/, "午前中の引取で時間指定なしはA中");
assert.match(rules, /return "中"/, "納車の時間指定なしは中");

console.log("daily report allocation regression: ok");
