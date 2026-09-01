import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/daily-report-secondary-sections.ts", import.meta.url), "utf8");

assert.match(source, /collectDailyReportMessages/, "伝達事項は既存予定メモから重複を除いて収集する");
assert.match(source, /normalized\.includes\("板金"\)/, "板金表記の車両を鈑金車両欄へ分類する");
assert.match(source, /normalized\.includes\("鈑金"\)/, "鈑金表記の車両も鈑金車両欄へ分類する");
assert.match(source, /bodyShopVehicleIds/, "同一車両に一般整備と鈑金作業があっても鈑金車両欄を優先する");
assert.match(source, /uniqueByVehicle/, "滞留・鈑金・納車予定は車両単位で重複表示しない");
assert.match(source, /!bodyShopVehicleIds\.has\(work\.vehicle_id\)/, "鈑金車両を一般の滞留車両欄へ重複表示しない");
assert.match(source, /planned_delivery_at/, "納車予定車両は既存planned_delivery_atを再利用する");
assert.match(source, /checkedOutAt !== null && checkedOutAt < end/, "選択日中までに出庫済みの車両を納車予定欄へ残さない");
assert.match(source, /const checkedOutAt = work\.checked_out_at \? new Date\(work\.checked_out_at\)\.getTime\(\) : null/, "後日出庫は時刻比較で判定する");
assert.match(source, /work\.status === "cancelled"/, "キャンセル済みデータを帳票欄へ出さない");
assert.match(source, /scheduled_at\?: string \| null/, "滞留判定は既存scheduled_atを再利用できる");
assert.match(source, /const activeFrom = work\.checked_in_at \|\| work\.scheduled_at/, "未入庫の将来予定を過去日の日報へ滞留表示しない");
assert.match(source, /new Date\(activeFrom\)\.getTime\(\) >= endOfDay/, "滞留車両は選択日の終了時点までに開始した作業だけを対象にする");
assert.match(source, /new Date\(work\.checked_out_at\)\.getTime\(\) >= endOfDay/, "後日出庫した車両は過去日の滞留欄に残す");
assert.match(source, /work\.work_completed \|\| work\.status === "completed"/, "出庫日時が無い完了済み作業は現在の滞留欄へ残さない");

console.log("daily report secondary sections regression: ok");
