from pathlib import Path

ACTIVE='parts-active-vehicle'

# Integrated history
p=Path('app/customer-vehicles/history/page.tsx')
s=p.read_text()
anchor='''  async function showMore() {\n'''
helper='''  function rememberVehicleAndOpen(path: string) {\n    if (!vehicle) return;\n    const snapshot = JSON.stringify({\n      id: vehicle.id,\n      registration: vehicle.registration_number || "",\n      last4: vehicle.registration_number_last4 || vehicle.registration_last4 || "",\n      chassis: vehicle.chassis_number || "",\n      model: vehicle.model || "",\n    });\n    try { sessionStorage.setItem("parts-active-vehicle", snapshot); } catch {}\n    try { localStorage.setItem("parts-active-vehicle", snapshot); } catch {}\n    location.assign(path);\n  }\n\n'''
if 'function rememberVehicleAndOpen' not in s:
    assert anchor in s
    s=s.replace(anchor, helper+anchor,1)
old='''      <div className="notice">{busy && !items.length ? "読み込み中…" : message}</div>\n\n      <section className="card">\n'''
new='''      <div className="notice">{busy && !items.length ? "読み込み中…" : message}</div>\n\n      {vehicle && (\n        <section className="continueCard card">\n          <b>この車両で続ける</b>\n          <div className="continueActions">\n            <button onClick={() => rememberVehicleAndOpen("/schedule/active")}>📅 次回予定登録</button>\n            <button onClick={() => rememberVehicleAndOpen("/inspection")}>🧾 記録簿</button>\n          </div>\n        </section>\n      )}\n\n      <section className="card">\n'''
if 'この車両で続ける' not in s:
    assert old in s
    s=s.replace(old,new,1)
css='''.more{display:flex;justify-content:center;margin-top:9px}.empty'''
cssnew='''.continueCard{display:flex;align-items:center;justify-content:space-between;gap:10px}.continueActions{display:flex;gap:8px;flex-wrap:wrap}.continueActions button{min-height:40px}.more{display:flex;justify-content:center;margin-top:9px}.empty'''
assert css in s
s=s.replace(css,cssnew,1)
mobile='''@media(max-width:650px){.historyPage'''
mobile_new='''@media(max-width:650px){.continueCard{display:grid}.continueActions{display:grid;grid-template-columns:1fr 1fr}.continueActions button{width:100%;font-size:12px;padding:8px}.historyPage'''
assert mobile in s
s=s.replace(mobile,mobile_new,1)
p.write_text(s)

# Photo history
p=Path('app/customer-vehicles/photos/page.tsx')
s=p.read_text()
anchor='''  async function loadMore() {\n'''
helper='''  function rememberVehicleAndOpen(path: string) {\n    if (!vehicle) return;\n    const snapshot = JSON.stringify({\n      id: vehicle.id,\n      number: vehicle.vehicle_number || "",\n      registration: vehicle.registration_number || "",\n      last4: vehicle.registration_number_last4 || vehicle.registration_last4 || "",\n      chassis: vehicle.chassis_number || "",\n      model: vehicle.model || "",\n    });\n    try { sessionStorage.setItem("parts-active-vehicle", snapshot); } catch {}\n    try { localStorage.setItem("parts-active-vehicle", snapshot); } catch {}\n    location.assign(path);\n  }\n\n'''
if 'function rememberVehicleAndOpen' not in s:
    assert anchor in s
    s=s.replace(anchor,helper+anchor,1)
old='''      <section className="card foundationNotice">\n'''
new='''      {vehicle && (\n        <section className="continueCard card">\n          <b>この車両で続ける</b>\n          <div className="continueActions">\n            <button onClick={() => rememberVehicleAndOpen("/schedule/active")}>📅 次回予定登録</button>\n            <button onClick={() => rememberVehicleAndOpen("/inspection")}>🧾 記録簿</button>\n          </div>\n        </section>\n      )}\n\n      <section className="card foundationNotice">\n'''
if 'この車両で続ける' not in s:
    assert old in s
    s=s.replace(old,new,1)
css='''.foundationNotice{background:#fff8df'''
cssnew='''.continueCard{display:flex;align-items:center;justify-content:space-between;gap:10px}.continueActions{display:flex;gap:8px;flex-wrap:wrap}.continueActions button{min-height:40px}.foundationNotice{background:#fff8df'''
assert css in s
s=s.replace(css,cssnew,1)
mobile='''@media(max-width:650px){.photoPage'''
mobile_new='''@media(max-width:650px){.continueCard{display:grid}.continueActions{display:grid;grid-template-columns:1fr 1fr}.continueActions button{width:100%;font-size:12px;padding:8px}.photoPage'''
assert mobile in s
s=s.replace(mobile,mobile_new,1)
p.write_text(s)

r=Path('scripts/history-photo-continuation-regression.mjs')
r.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\nfor (const path of ["app/customer-vehicles/history/page.tsx","app/customer-vehicles/photos/page.tsx"]) {\n  const src=fs.readFileSync(path,"utf8");\n  assert.ok(src.includes('sessionStorage.setItem("parts-active-vehicle", snapshot)'), `${path}: session handoff`);\n  assert.ok(src.includes('localStorage.setItem("parts-active-vehicle", snapshot)'), `${path}: local handoff`);\n  assert.ok(src.includes('rememberVehicleAndOpen("/schedule/active")'), `${path}: next schedule shortcut`);\n  assert.ok(src.includes('rememberVehicleAndOpen("/inspection")'), `${path}: inspection shortcut`);\n  assert.ok(src.includes('この車両で続ける'), `${path}: continuation UI`);\n  assert.ok(!src.includes('/ocr/auto'), `${path}: no OCR coupling`);\n}\nconsole.log("history/photo continuation regression: PASS");\n''')
