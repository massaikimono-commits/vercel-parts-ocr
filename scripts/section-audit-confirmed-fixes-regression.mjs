import fs from "node:fs";
import assert from "node:assert/strict";

const login = fs.readFileSync("app/settings/login-history/page.tsx", "utf8");
const customer = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");
const inspection = fs.readFileSync("app/inspection/page.tsx", "utf8");

assert.ok(login.includes('supabase.auth.signOut({ scope: "global" })'), "remote logout uses existing Supabase Auth global sign-out");
assert.ok(login.includes('全端末からログアウト'), "remote logout is operator-visible");
assert.ok(login.includes('window.confirm('), "remote logout requires explicit confirmation");
assert.ok(login.includes('clearSensitiveLocalState();'), "remote logout clears sensitive local state");
assert.ok(!customer.includes('クラウドにも自動同期します'), "deprecated parts auto-sync claim is removed");
assert.ok(customer.includes('正式保存済み部品と端末の未確定データを分けて確認できます'), "parts history copy matches explicit formal-save semantics");
assert.ok(inspection.includes('🖨 正式印刷（確認待ち）'), "designated formal print remains held pending final PDF/coordinates");
assert.ok(inspection.includes('if (mode !== "inspection")'), "designated print path remains fail-closed");
console.log("section audit confirmed fixes regression: PASS");
