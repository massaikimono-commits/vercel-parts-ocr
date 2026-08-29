import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/daily-report-secondary-sections.ts", import.meta.url), "utf8");

assert.match(source, /collectDailyReportMessages/, "伝達事項は既存予定メモから重複を除いて収集する");
assert.match(source, /normalized\.includes\("板金"\)/, "板金表記の車両を鈑金車両欄へ分類する");
assert.match(source, /normalized\.includes\("鈑金"\)/, "鈑金表記の車両も鈑金車両欄へ分類する");
assert.match(source, /!isBodyShopReason\(work\.reason\)/, "一般の滞留車両と鈑金車両を重複させない");
assert.match(source, /planned_delivery_at/, "納車予定車両は既存planned_delivery_atを再利用する");
assert.match(source, /work\.work_completed \|\| work\.checked_out_at/, "完了・出庫済み車両を滞留欄へ残さない");
assert.match(source, /work\.status === "cancelled"/, "キャンセル済みデータを帳票欄へ出さない");

console.log("daily report secondary sections regression: ok");
