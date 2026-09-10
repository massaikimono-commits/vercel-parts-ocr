from pathlib import Path

page = Path('app/customer-vehicles/page.tsx')
s = page.read_text()

old = '''    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({
      id: v.id,
      number: v.number,
      registration: v.registration,
      last4: v.last4,
      chassis: v.chassis,
      model: v.model,
    }));
'''
new = '''    const activeVehiclePayload = JSON.stringify({
      id: v.id,
      number: v.number,
      registration: v.registration,
      last4: v.last4,
      chassis: v.chassis,
      model: v.model,
    });
    sessionStorage.setItem(ACTIVE_KEY, activeVehiclePayload);
    localStorage.setItem(ACTIVE_KEY, activeVehiclePayload);
'''
if old not in s:
    raise SystemExit('active vehicle storage anchor not found')
s = s.replace(old, new, 1)

old = '''              <button onClick={() => location.assign(`/customer-vehicles/lease-maintenance?vehicle=${encodeURIComponent(selectedVehicle.id)}`)}>📄 リースメンテ契約</button>
              <button onClick={() => location.assign("/schedule/active")}>📅 次回予定登録</button>
'''
new = '''              <button onClick={() => location.assign(`/customer-vehicles/lease-maintenance?vehicle=${encodeURIComponent(selectedVehicle.id)}`)}>📄 リースメンテ契約</button>
              <button onClick={() => location.assign("/inspection")}>🧾 記録簿</button>
              <button onClick={() => location.assign("/schedule/active")}>📅 次回予定登録</button>
'''
if old not in s:
    raise SystemExit('vehicle action anchor not found')
s = s.replace(old, new, 1)
page.write_text(s)

reg = Path('scripts/customer-vehicle-record-handoff-regression.mjs')
reg.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\n\nconst customerVehicles = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");\nconst inspection = fs.readFileSync("app/inspection/page.tsx", "utf8");\nconst activeSchedule = fs.readFileSync("app/schedule/active/page.tsx", "utf8");\n\nassert.ok(customerVehicles.includes('const activeVehiclePayload = JSON.stringify({'), "vehicle selection creates one shared active payload");\nassert.ok(customerVehicles.includes('sessionStorage.setItem(ACTIVE_KEY, activeVehiclePayload);'), "vehicle selection keeps session handoff");\nassert.ok(customerVehicles.includes('localStorage.setItem(ACTIVE_KEY, activeVehiclePayload);'), "vehicle selection persists handoff for existing operational routes");\nassert.ok(customerVehicles.includes('location.assign(\"/inspection\")}>🧾 記録簿'), "vehicle action menu exposes record-book route");\nassert.ok(customerVehicles.includes('location.assign(\"/schedule/active\")}>📅 次回予定登録'), "existing next-booking route remains available");\nassert.ok(inspection.includes('localStorage.getItem(ACTIVE_KEY)'), "inspection consumes active vehicle handoff");\nassert.ok(activeSchedule.includes('localStorage.getItem(ACTIVE_KEY)'), "active schedule consumes active vehicle handoff");\nconsole.log("customer vehicle record handoff regression: PASS");\n''')
