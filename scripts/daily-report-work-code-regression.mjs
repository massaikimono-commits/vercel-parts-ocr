import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync(new URL("../app/schedule/daily-report-work-code.ts", import.meta.url), "utf8");
const printPage = fs.readFileSync(new URL("../app/schedule/print/page.tsx", import.meta.url), "utf8");
const newPage = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");

assert.match(helper, /normalized === "車検"\) return "S"/, "車検はS");
assert.match(helper, /normalized === "一般整備"\) return "Q"/, "一般整備はQ");
assert.match(helper, /return "B\/P"/, "板金系はB/P");
assert.match(helper, /inspectionScheduleType === "schedule"\) return "スケ"/, "scheduleはスケ");
assert.match(helper, /inspectionScheduleType === "legal_6m"\) return "6"/, "legal_6mは6");
assert.match(helper, /inspectionScheduleType === "legal_12m"\) return "12"/, "legal_12mは12");
assert.doesNotMatch(helper, /legal_3m/, "legal_3mは今回未実装");
assert.match(helper, /return "";\s*\n}/, "未指定点検は空欄");

assert.match(newPage, /<option value="schedule">スケジュール点検<\/option>/, "通常予定をスケジュール点検へ名称変更");
assert.doesNotMatch(newPage, />通常予定</, "通常予定の表示を残さない");
assert.doesNotMatch(newPage, /legal_3m/, "予定登録へlegal_3mを追加しない");

const codeUses = printPage.match(/dailyReportWorkCode\(/g) || [];
assert.equal(codeUses.length, 4, "上部2箇所・滞留・納車予定へ日報専用コードを適用");
assert.match(printPage, /inspection_schedule_type/, "日報は既存inspection_schedule_typeを読み込む");
assert.doesNotMatch(printPage, /legal_3m/, "日報側にもlegal_3mを追加しない");

console.log("daily report work-code regression: ok");
