import fs from "node:fs";
import assert from "node:assert/strict";

const customer = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");
assert.ok(customer.includes('const SEARCH_STATE_KEY = "customer-vehicles-search-state";'), "search state has an isolated session key");
assert.ok(customer.includes('sessionStorage.getItem(SEARCH_STATE_KEY)'), "search state restores from session storage");
assert.ok(customer.includes('sessionStorage.setItem(SEARCH_STATE_KEY'), "search state persists to session storage");
assert.ok(customer.includes('if (!searchStateReady) return;'), "vehicle search waits for restored state");
assert.ok(customer.includes('検索条件はこのタブ内で保持します。'), "preview candidate is operator-visible");
assert.ok(!customer.includes('localStorage.setItem(SEARCH_STATE_KEY'), "search state is not persisted across browser sessions");
console.log("customer search memory regression: PASS");
