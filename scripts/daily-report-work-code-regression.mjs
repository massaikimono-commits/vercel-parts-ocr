import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync(new URL("../app/schedule/daily-report-work-code.ts", import.meta.url), "utf8");
const printPage = fs.readFileSync(new URL("../app/schedule/print/page.tsx", import.meta.url), "utf8");
const newPage = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");
const businessState = fs.readFileSync(new URL("../app/schedule/business-vehicle-state.ts", import.meta.url), "utf8");

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
assert.match(printPage, /\.reportVehicle small\{[^}]*color:#000/, "上部の入庫要因コードは黒文字");
assert.match(printPage, /\.secondaryRow \.vehicleWork small\{[^}]*position:absolute;left:67%;top:0;width:29%;height:100%/, "滞留・納車予定のコードは車番と同じ行の既存括弧位置へ重ねる");
assert.match(printPage, /<span className="vehicleWork"><b>\{last4ForVehicle\(work\.vehicle_id\)\}<\/b><small>\{dailyReportWorkCode/, "下部は車番とコードだけを出しアプリ側で括弧を描画しない");
assert.doesNotMatch(printPage, /[（(]\s*\{dailyReportWorkCode|dailyReportWorkCode\([^)]*\)\}\s*[）)]/, "コード文字列へ新しい括弧を追加しない");
assert.match(printPage, /entry\.entry_type === "customer_visit" && <span className="reportVisitVehicleLabel">来社<\/span>/, "通常来社は車番左側へ来社と表示");
assert.match(printPage, /entry\.entry_type === "onsite_repair" && \(/, "出張の既存時間側ラベルは維持");
assert.doesNotMatch(newPage, /作業待ち|来社待ち/, "作業待ちはDB対応まで予定登録へ追加しない");
assert.doesNotMatch(printPage, /作業待ち|来社待ち/, "作業待ちはDB対応まで日報へ追加しない");
assert.doesNotMatch(businessState, /作業待ち|来社待ち/, "作業待ちはDB対応まで滞留判定へ推測追加しない");
assert.match(printPage, /\.secondaryRow \.vehicleWork small\{[^}]*color:#000/, "下部の入庫要因コードは黒文字");
assert.match(printPage, /\.secondaryDue\{position:relative!important;display:block!important\}/, "納車予定の納期は同一セル同一行を使う");
assert.match(printPage, /\.secondaryDue b\{[^}]*left:6%;[^}]*height:100%/, "納期の日付は同じ納期セル内に置く");
assert.match(printPage, /\.secondaryDue small\{[^}]*left:52%;[^}]*height:100%/, "納期の時間区分は同じ納期セルの既存括弧位置へ置く");
assert.doesNotMatch(printPage, /secondaryDue\{[^}]*grid-template-rows/, "納期を縦2段へ戻さない");

console.log("daily report work-code regression: ok");
