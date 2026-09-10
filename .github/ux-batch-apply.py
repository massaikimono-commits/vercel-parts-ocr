from pathlib import Path

def replace_once(path, old, new, label):
    p=Path(path); s=p.read_text()
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'{label}: anchor missing')
    p.write_text(s.replace(old,new,1))

replace_once('app/schedule/detail/page.tsx','  function openVehicleHistory(kind:"history"|"photos"){\n    if(!vehicle) return;\n    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);\n  }','  function openVehicleHistory(kind:"history"|"photos"){\n    if(!vehicle) return;\n    rememberActiveVehicle();\n    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);\n  }','schedule detail active context')

replace_once('app/customer-vehicles/page.tsx','              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>','              <button onClick={() => location.assign("/schedule/active")}>📅 次回予定登録</button>\n              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>','customer vehicle direct schedule')

def add_continue_helper(path):
    p=Path(path); s=p.read_text()
    if '  function openNextSchedule() {' in s:
        return
    helper='''  function openNextSchedule() {\n    if (!vehicle) return;\n    const snapshot = {\n      id: vehicle.id,\n      number: "vehicle_number" in vehicle ? (vehicle.vehicle_number || "") : "",\n      registration: vehicle.registration_number || "",\n      last4: vehicle.registration_number_last4 || vehicle.registration_last4 || "",\n      chassis: vehicle.chassis_number || "",\n      model: vehicle.model || "",\n    };\n    try { sessionStorage.setItem("parts-active-vehicle", JSON.stringify(snapshot)); } catch {}\n    try { localStorage.setItem("parts-active-vehicle", JSON.stringify(snapshot)); } catch {}\n    location.assign("/schedule/active");\n  }\n\n'''
    anchor='  return (\n'
    if anchor not in s: raise SystemExit(f'{path}: helper anchor missing')
    p.write_text(s.replace(anchor,helper+anchor,1))

for path in ['app/customer-vehicles/history/page.tsx','app/customer-vehicles/photos/page.tsx','app/customer-vehicles/lease-maintenance/page.tsx']:
    add_continue_helper(path)

for path,label in [('app/customer-vehicles/history/page.tsx','history'),('app/customer-vehicles/photos/page.tsx','photos'),('app/customer-vehicles/lease-maintenance/page.tsx','lease')]:
    p=Path(path); s=p.read_text()
    if 'onClick={openNextSchedule}>次回予定登録</button>' in s: continue
    targets=['<button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>','<button onClick={() => window.location.assign("/customer-vehicles")}>顧客・車両管理</button>']
    target=next((t for t in targets if t in s),None)
    if not target: raise SystemExit(f'{label}: navigation anchor missing')
    p.write_text(s.replace(target,'<div className="heroActions"><button onClick={openNextSchedule}>次回予定登録</button>'+target+'</div>',1))

p=Path('app/schedule/detail/page.tsx'); s=p.read_text()
if 'function openOneDaySchedule()' not in s:
    anchor='  function openInspection(){\n'
    helper='''  function openOneDaySchedule(){\n    const source=inboundEntry || entry;\n    if(!source) return;\n    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(source.starts_at));\n    location.assign(`/schedule?day=${day}`);\n  }\n\n'''
    if anchor not in s: raise SystemExit('one-day helper anchor missing')
    s=s.replace(anchor,helper+anchor,1)
old='<button onClick={()=>history.back()}>← 戻る</button>\n        <strong>予定・車両詳細</strong>'
new='<div className="topBackActions"><button onClick={()=>history.back()}>← 戻る</button><button onClick={openOneDaySchedule} disabled={!entry}>1日の予定</button></div>\n        <strong>予定・車両詳細</strong>'
if new not in s:
    if old not in s: raise SystemExit('one-day button anchor missing')
    s=s.replace(old,new,1)
p.write_text(s)

Path('scripts/ux-context-preservation-regression.mjs').write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
const detail=fs.readFileSync("app/schedule/detail/page.tsx","utf8");
const customer=fs.readFileSync("app/customer-vehicles/page.tsx","utf8");
const history=fs.readFileSync("app/customer-vehicles/history/page.tsx","utf8");
const photos=fs.readFileSync("app/customer-vehicles/photos/page.tsx","utf8");
const lease=fs.readFileSync("app/customer-vehicles/lease-maintenance/page.tsx","utf8");
assert.match(detail,/function openVehicleHistory[\s\S]*rememberActiveVehicle\(\)[\s\S]*\/customer-vehicles\/\$\{kind\}/);
assert.match(customer,/\/schedule\/active\"\)>📅 次回予定登録/);
for (const source of [history,photos,lease]) {
  assert.match(source,/function openNextSchedule\(\)/);
  assert.match(source,/sessionStorage\.setItem\("parts-active-vehicle"/);
  assert.match(source,/localStorage\.setItem\("parts-active-vehicle"/);
  assert.match(source,/location\.assign\("\/schedule\/active"\)/);
  assert.match(source,/onClick=\{openNextSchedule\}>次回予定登録<\/button>/);
}
assert.match(detail,/function openOneDaySchedule\(\)/);
assert.match(detail,/location\.assign\(`\/schedule\?day=\$\{day\}`\)/);
assert.match(detail,/>1日の予定<\/button>/);
for (const source of [detail,customer,history,photos,lease]) assert.doesNotMatch(source,/create table|alter table|create policy|create or replace function/i);
console.log("ux context-preservation regression: ok");
''')
