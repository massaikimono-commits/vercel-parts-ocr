from pathlib import Path

p = Path("app/customer-vehicles/page.tsx")
s = p.read_text()

if 'const SEARCH_STATE_KEY = "customer-vehicles-search-state";' not in s:
    s = s.replace('const PARTS_KEY = "parts-data";\n', 'const PARTS_KEY = "parts-data";\nconst SEARCH_STATE_KEY = "customer-vehicles-search-state";\n', 1)

if 'const [searchStateReady, setSearchStateReady] = useState(false);' not in s:
    s = s.replace('  const [vehicleSearchMode, setVehicleSearchMode] = useState<VehicleSearchMode>("last4");\n', '  const [vehicleSearchMode, setVehicleSearchMode] = useState<VehicleSearchMode>("last4");\n  const [searchStateReady, setSearchStateReady] = useState(false);\n', 1)

old = '''  useEffect(() => {\n    const timer = window.setTimeout(() => {\n      void loadVehicleList(query, false, vehicleSearchMode);\n    }, query.trim() ? 300 : 0);\n    return () => window.clearTimeout(timer);\n  }, [query, vehicleSearchMode]);\n'''
new = '''  useEffect(() => {\n    try {\n      const saved = JSON.parse(sessionStorage.getItem(SEARCH_STATE_KEY) || "null");\n      if (typeof saved?.query === "string") setQuery(saved.query);\n      if (["last4", "customer", "phone"].includes(saved?.mode)) {\n        setVehicleSearchMode(saved.mode as VehicleSearchMode);\n      }\n    } catch {}\n    setSearchStateReady(true);\n  }, []);\n\n  useEffect(() => {\n    if (!searchStateReady) return;\n    try {\n      sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify({ query, mode: vehicleSearchMode }));\n    } catch {}\n  }, [query, vehicleSearchMode, searchStateReady]);\n\n  useEffect(() => {\n    if (!searchStateReady) return;\n    const timer = window.setTimeout(() => {\n      void loadVehicleList(query, false, vehicleSearchMode);\n    }, query.trim() ? 300 : 0);\n    return () => window.clearTimeout(timer);\n  }, [query, vehicleSearchMode, searchStateReady]);\n'''
if 'sessionStorage.getItem(SEARCH_STATE_KEY)' not in s:
    assert old in s
    s = s.replace(old, new, 1)

hint_anchor = '''        {query.trim() && (\n          <button type="button" className="clearSearch" onClick={() => setQuery("")}>検索をクリア</button>\n        )}\n'''
if '検索条件はこのタブ内で保持します。' not in s:
    assert hint_anchor in s
    s = s.replace(hint_anchor, hint_anchor + '        <small className="searchStateHint">検索条件はこのタブ内で保持します。</small>\n', 1)

p.write_text(s)

r = Path("scripts/customer-search-memory-regression.mjs")
r.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\n\nconst customer = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");\nassert.ok(customer.includes('const SEARCH_STATE_KEY = "customer-vehicles-search-state";'), "search state has an isolated session key");\nassert.ok(customer.includes('sessionStorage.getItem(SEARCH_STATE_KEY)'), "search state restores from session storage");\nassert.ok(customer.includes('sessionStorage.setItem(SEARCH_STATE_KEY'), "search state persists to session storage");\nassert.ok(customer.includes('if (!searchStateReady) return;'), "vehicle search waits for restored state");\nassert.ok(customer.includes('検索条件はこのタブ内で保持します。'), "preview candidate is operator-visible");\nassert.ok(!customer.includes('localStorage.setItem(SEARCH_STATE_KEY'), "search state is not persisted across browser sessions");\nconsole.log("customer search memory regression: PASS");\n''')
