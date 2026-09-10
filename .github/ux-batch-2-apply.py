from pathlib import Path

def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if new in s:
        return
    if old not in s:
        raise SystemExit(f"{label}: anchor missing")
    p.write_text(s.replace(old, new, 1))

path = 'app/customer-vehicles/page.tsx'
p = Path(path)
s = p.read_text()

helper_anchor = '''  function openParts() {\n    if (!selectedVehicle) return;\n    selectVehicle(selectedVehicle);\n    location.assign("/parts-data");\n  }\n\n'''
helper_new = helper_anchor + '''  function callSelectedCustomer() {\n    const phone = selectedCustomer?.phone?.replace(/[^\\d+]/g, "") || "";\n    if (!phone) return;\n    location.href = `tel:${phone}`;\n  }\n\n  function openSelectedCustomerMap() {\n    const address = selectedCustomer?.address?.trim() || "";\n    if (!address) return;\n    window.open(`https://maps.apple.com/?q=${encodeURIComponent(address)}`, "_blank", "noopener,noreferrer");\n  }\n\n'''
if 'function callSelectedCustomer()' not in s:
    if helper_anchor not in s:
        raise SystemExit('helper anchor missing')
    s = s.replace(helper_anchor, helper_new, 1)

search_anchor = '''        <input\n          className="search"\n          value={query}\n          onChange={(e) => setQuery(e.target.value)}\n          inputMode={vehicleSearchMode === "last4" ? "numeric" : vehicleSearchMode === "phone" ? "tel" : "text"}\n          maxLength={vehicleSearchMode === "last4" ? 4 : undefined}\n          placeholder={vehicleSearchMode === "last4" ? "例：10 / 1234" : vehicleSearchMode === "customer" ? "例：山田 / 株式会社ICB" : "例：090-1234-5678"}\n        />\n'''
search_new = search_anchor + '''        {query.trim() && (\n          <button type="button" className="clearSearch" onClick={() => setQuery("")}>検索をクリア</button>\n        )}\n'''
if 'className="clearSearch"' not in s:
    if search_anchor not in s:
        raise SystemExit('search anchor missing')
    s = s.replace(search_anchor, search_new, 1)

actions_anchor = '''              <button onClick={() => location.assign("/vehicle-workflow")}>車両情報を編集</button>\n'''
actions_new = '''              {selectedCustomer?.phone && <button type="button" onClick={callSelectedCustomer}>📞 電話する</button>}\n              {selectedCustomer?.address && <button type="button" onClick={openSelectedCustomerMap}>🗺 住所を地図で開く</button>}\n''' + actions_anchor
if 'onClick={callSelectedCustomer}' not in s:
    if actions_anchor not in s:
        raise SystemExit('actions anchor missing')
    s = s.replace(actions_anchor, actions_new, 1)

style_anchor = '.search,.customerForm input,.customerForm textarea,.linkBox input,.linkBox select{width:100%;border:1px solid #cdd7e5;border-radius:12px;padding:14px;font-size:16px;background:#fff;color:#172033}'
style_new = style_anchor + '.clearSearch{align-self:flex-end;margin-top:6px;padding:8px 11px;font-size:13px;color:#53647b}'
if '.clearSearch{' not in s:
    if style_anchor not in s:
        raise SystemExit('style anchor missing')
    s = s.replace(style_anchor, style_new, 1)

p.write_text(s)

Path('scripts/customer-vehicle-daily-ux-regression.mjs').write_text(r'''import assert from "node:assert/strict";
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
''')
