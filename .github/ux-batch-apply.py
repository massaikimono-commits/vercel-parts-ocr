from pathlib import Path

def replace_once(path, old, new, label):
    p=Path(path); s=p.read_text()
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'{label}: anchor missing')
    p.write_text(s.replace(old,new,1))

# UX candidate A: preserve active vehicle before schedule-detail history/photo jumps.
replace_once(
    'app/schedule/detail/page.tsx',
    '  function openVehicleHistory(kind:"history"|"photos"){\n    if(!vehicle) return;\n    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);\n  }',
    '  function openVehicleHistory(kind:"history"|"photos"){\n    if(!vehicle) return;\n    rememberActiveVehicle();\n    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);\n  }',
    'schedule detail active context'
)

# UX candidate B: selected customer/vehicle -> existing active-vehicle schedule form directly.
replace_once(
    'app/customer-vehicles/page.tsx',
    '              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>',
    '              <button onClick={() => location.assign("/schedule/active")}>📅 次回予定登録</button>\n              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>',
    'customer vehicle direct schedule'
)

# UX candidate C: schedule detail -> exact one-day board without relying only on browser back history.
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
assert.ok(detail.includes('function openVehicleHistory(kind:"history"|"photos"){'));
assert.ok(detail.includes('rememberActiveVehicle();\n    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);'));
assert.ok(customer.includes('location.assign("/schedule/active")}>📅 次回予定登録</button>'));
assert.ok(detail.includes('function openOneDaySchedule()'));
assert.ok(detail.includes('location.assign(`/schedule?day=${day}`)'));
assert.ok(detail.includes('>1日の予定</button>'));
for (const source of [detail,customer]) assert.doesNotMatch(source,/create table|alter table|create policy|create or replace function/i);
console.log("ux context-preservation regression: ok");
''')
