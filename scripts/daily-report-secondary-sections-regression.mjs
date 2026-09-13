import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/daily-report-secondary-sections.ts", import.meta.url), "utf8");

assert.match(source, /collectDailyReportMessages/, "伝達事項は既存予定メモから重複を除いて収集する");
assert.doesNotMatch(source, /checked_in_at|checked_out_at|planned_delivery_at|work_completed|selectDailyReportSecondaryWorks/, "日報下部の車両判定へ旧入庫・完了・補助納車列ロジックを戻さない");

console.log("daily report secondary sections regression: ok");
