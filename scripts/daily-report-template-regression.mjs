import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/daily-report-template.ts", import.meta.url), "utf8");

for (const requiredRegion of ["delivery", "inbound", "messages", "stayingVehicles", "bodyShopVehicles", "plannedDeliveries"]) {
  assert.match(source, new RegExp(`${requiredRegion}:\\s*\\{`), `日報の${requiredRegion}欄をテンプレート管理する`);
}

assert.match(source, /count:\s*23/, "既存日報の予定欄23行を維持する");
assert.match(source, /publicAssetPath:\s*null/, "個人名を含み得る日報原本を公開GitHubへ直接置かない");
assert.match(source, /commitToPublicRepo:\s*false/, "日報原本は公開リポジトリにコミットしない");
assert.match(source, /period === "morning"/, "午前用の上詰めスロットを持つ");
assert.match(source, /\.reverse\(\)/, "午後用の下詰めスロットを持つ");
assert.match(source, /paperSize:\s*"A3"/, "日報はA3実寸を維持する");
assert.match(source, /widthMm:\s*297[\s\S]*heightMm:\s*420/, "日報は297x420mmのA3縦");
assert.match(source, /delivery:\s*\[0\.3329,\s*0\.2003,\s*0\.2003,\s*0\.2665\]/, "納車欄は実PDFの4列幅を使う");
assert.match(source, /inbound:\s*\[0\.3437,\s*0\.2067,\s*0\.2119,\s*0\.2377\]/, "引取系は実PDFの4列幅を使う");
assert.match(source, /messages:\s*\{\s*x:\s*0\.135/, "伝達事項は印刷済み見出しを避けて本文欄から始める");
assert.match(source, /bodyShopVehicles:\s*\{[^}]*width:\s*0\.273/, "板金欄は納車予定車両の縦見出しへはみ出さない");
assert.match(source, /plannedDeliveries:\s*\[0\.4193,\s*0\.3228,\s*0\.2579\]/, "納車予定車両は元PDFのユーザー名/車番/納期列を使う");

console.log("daily report template regression: ok");
