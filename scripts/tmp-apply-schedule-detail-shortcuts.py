from pathlib import Path

p = Path("app/schedule/detail/page.tsx")
s = p.read_text()
old = '''  function openVehicleHistory(kind:"history"|"photos"){
    if(!vehicle) return;
    rememberActiveVehicle();
    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);
  }
'''
new = old + '''\n  function openVehicleScopedTool(path:string){\n    if(!vehicle) return;\n    rememberActiveVehicle();\n    location.assign(`${path}?vehicle=${encodeURIComponent(vehicle.id)}`);\n  }\n'''
if "function openVehicleScopedTool" not in s:
    assert old in s
    s = s.replace(old, new, 1)
old_buttons = '''                  <button onClick={()=>openVehicleTool("/parts-data")}>部品データ</button>
                  <button onClick={()=>openVehicleHistory("history")}>車両履歴</button>
                  <button onClick={()=>openVehicleHistory("photos")}>写真履歴</button>
'''
new_buttons = '''                  <button onClick={()=>openVehicleTool("/parts-data")}>部品データ</button>
                  <button onClick={()=>openVehicleHistory("history")}>車両履歴</button>
                  <button onClick={()=>openVehicleHistory("photos")}>写真履歴</button>
                  <button onClick={()=>openVehicleScopedTool("/customer-vehicles/lease-maintenance")}>リースメンテ契約</button>
'''
if ">リースメンテ契約</button>" not in s:
    assert old_buttons in s
    s = s.replace(old_buttons, new_buttons, 1)
p.write_text(s)

r = Path("scripts/schedule-detail-vehicle-shortcuts-regression.mjs")
r.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\nconst detail = fs.readFileSync("app/schedule/detail/page.tsx", "utf8");\nassert.ok(detail.includes('openVehicleScopedTool("/customer-vehicles/lease-maintenance")'), "lease shortcut");\nassert.ok(detail.includes('rememberActiveVehicle();'), "selected vehicle handoff");\nassert.ok(!detail.includes('openVehicleTool("/ocr/auto")'), "practical detail hub stays decoupled from OCR execution");\nassert.ok(detail.includes('次回予定登録'), "keep next booking candidate");\nassert.ok(detail.includes('顧客・車両情報'), "keep customer vehicle candidate");\nassert.ok(detail.includes('電話する'), "keep phone candidate");\nconsole.log("schedule detail vehicle shortcuts regression: PASS");\n''')
