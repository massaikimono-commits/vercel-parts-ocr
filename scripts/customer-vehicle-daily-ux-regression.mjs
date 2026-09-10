import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");

assert.ok(page.includes('function callSelectedCustomer()'));
assert.ok(page.includes('location.href = `tel:${phone}`'));
assert.ok(page.includes('selectedCustomer?.phone && <button type="button" onClick={callSelectedCustomer}>📞 電話する</button>'));

assert.ok(page.includes('function openSelectedCustomerMap()'));
assert.ok(page.includes('https://maps.apple.com/?q=${encodeURIComponent(address)}'));
assert.ok(page.includes('selectedCustomer?.address && <button type="button" onClick={openSelectedCustomerMap}>🗺 住所を地図で開く</button>'));

assert.ok(page.includes('className="clearSearch" onClick={() => setQuery("")}>検索をクリア</button>'));
assert.ok(page.includes('{query.trim() && ('));

assert.doesNotMatch(page, /create table|alter table|create policy|create or replace function/i);
assert.doesNotMatch(page, /\.rpc\("(?!existing)/i);

console.log("customer vehicle daily UX regression: ok");
