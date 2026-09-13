import fs from "node:fs";
import assert from "node:assert/strict";

const page = fs.readFileSync("app/inspection/page.tsx", "utf8");
assert.ok(page.includes('if (mode !== "inspection")'), "designated print path is fail-closed");
assert.ok(page.includes('正式PDF・最終印刷座標の確認完了後に有効化します。'), "blocked print explains readiness requirement");
assert.ok(page.includes('disabled title="正式PDF・最終印刷座標の確認待ち"'), "designated formal print button is disabled");
assert.ok(page.includes('🖨 正式印刷（確認待ち）'), "designated print hold is visible to operator");
assert.ok(page.includes('await saveInspection("printed");'), "inspection print path remains available");
assert.ok(!page.includes('else await saveDesignated("printed");'), "designated print cannot mark printed through printCurrent");
assert.ok(page.includes('saveDesignated("confirmed")'), "operator confirmation remains available");
console.log("designated print hold regression: PASS");
