import assert from "node:assert/strict";
import fs from "node:fs";

const model = fs.readFileSync(new URL("../app/schedule/daily-report-print-model.ts", import.meta.url), "utf8");
const allocation = fs.readFileSync(new URL("../app/schedule/daily-report-allocation.ts", import.meta.url), "utf8");
const template = fs.readFileSync(new URL("../app/schedule/daily-report-template.ts", import.meta.url), "utf8");

assert.match(model, /allocateDailyReportDay\(morningRows, afternoonRows\)/, "午前は上詰め・午後は下詰めの1日23行割り当てを使う");
assert.match(model, /DAILY_REPORT_TEMPLATE\.rows\.count/, "既存日報の行数をテンプレート定義から使う");
assert.match(model, /deliveryBySlot/, "納車欄を独立したセルとして保持する");
assert.match(model, /inboundBySlot/, "引取系欄を独立したセルとして保持する");
assert.match(model, /overflow:\s*\{[\s\S]*deliveries:[\s\S]*inbound:/, "欄超過をプレビュー層まで保持する");
assert.match(allocation, /prepareDailyReportSection\(rows, period\)/, "既存の来社→引取→出張・時間順を維持する");
assert.match(template, /commitToPublicRepo:\s*false/, "ユーザー指定の日報原本を公開GitHubへ置かない");

console.log("daily report print model regression: ok");
