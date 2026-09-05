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
assert.match(source, /return slots\.slice\(midpoint\)/, "午後用の下側スロットを持つ");

console.log("daily report template regression: ok");
