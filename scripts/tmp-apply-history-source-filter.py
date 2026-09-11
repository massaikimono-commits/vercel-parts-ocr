from pathlib import Path

p = Path("app/customer-vehicles/history/page.tsx")
s = p.read_text()

old = '''const DISPLAY_PAGE_SIZE = 25;\nconst SOURCE_PAGE_SIZE = 25;\n'''
new = '''const DISPLAY_PAGE_SIZE = 25;\nconst SOURCE_PAGE_SIZE = 25;\nconst SOURCE_FILTERS = ["すべて", "車両操作", "作業", "入出庫", "予定変更", "記録簿", "点検履歴"] as const;\n'''
assert old in s
s = s.replace(old, new, 1)

old = '''  const [sourceHasMore, setSourceHasMore] = useState(false);\n  const [busy, setBusy] = useState(true);\n'''
new = '''  const [sourceHasMore, setSourceHasMore] = useState(false);\n  const [sourceFilter, setSourceFilter] = useState<(typeof SOURCE_FILTERS)[number]>("すべて");\n  const [busy, setBusy] = useState(true);\n'''
assert old in s
s = s.replace(old, new, 1)

old = '''  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);\n  const canShowMore = visibleCount < items.length || sourceHasMore;\n'''
new = '''  const filteredItems = useMemo(\n    () => sourceFilter === "すべて" ? items : items.filter((item) => item.source === sourceFilter),\n    [items, sourceFilter]\n  );\n  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);\n  const canShowMore = visibleCount < filteredItems.length || sourceHasMore;\n'''
assert old in s
s = s.replace(old, new, 1)

old = '''      <section className="card">\n        <div className="sectionHead">\n          <h2>最新履歴</h2>\n          <span>{visibleItems.length}件表示</span>\n        </div>\n\n        {!busy && !visibleItems.length && (\n'''
new = '''      <section className="card">\n        <div className="sectionHead">\n          <h2>最新履歴</h2>\n          <span>{visibleItems.length}件表示</span>\n        </div>\n\n        <div className="sourceFilters" aria-label="履歴の種類">\n          {SOURCE_FILTERS.map((source) => (\n            <button\n              type="button"\n              key={source}\n              className={sourceFilter === source ? "active" : ""}\n              onClick={() => { setSourceFilter(source); setVisibleCount(DISPLAY_PAGE_SIZE); }}\n            >\n              {source}\n            </button>\n          ))}\n        </div>\n        <p className="filterNote">読み込み済み履歴を種類ごとに絞り込みます。DBの再検索は行いません。</p>\n\n        {!busy && !visibleItems.length && (\n'''
assert old in s
s = s.replace(old, new, 1)

old = '''        .notice{background:#eef5ff;border:1px solid #d6e6fb;color:#40546e;border-radius:11px;padding:9px 11px;margin-bottom:10px;font-size:13px}.sectionHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.sectionHead h2{font-size:21px;margin:0}.sectionHead>span{font-size:12px;background:#eef4ff;color:#2674e8;border-radius:999px;padding:5px 8px}\n'''
new = '''        .notice{background:#eef5ff;border:1px solid #d6e6fb;color:#40546e;border-radius:11px;padding:9px 11px;margin-bottom:10px;font-size:13px}.sectionHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.sectionHead h2{font-size:21px;margin:0}.sectionHead>span{font-size:12px;background:#eef4ff;color:#2674e8;border-radius:999px;padding:5px 8px}.sourceFilters{display:flex;gap:6px;overflow-x:auto;padding:9px 0 2px;scrollbar-width:none}.sourceFilters::-webkit-scrollbar{display:none}.sourceFilters button{flex:0 0 auto;padding:7px 10px;font-size:11px}.sourceFilters button.active{background:#2f6fe4;border-color:#2f6fe4;color:#fff}.filterNote{margin:5px 0 0;color:#718096;font-size:11px}\n'''
assert old in s
s = s.replace(old, new, 1)

old = '''        @media(max-width:650px){.historyPage{padding:7px 7px 34px}.top{margin-bottom:5px}.top button{min-height:40px;padding:7px 9px}.card{padding:10px;margin-bottom:8px;border-radius:14px}.vehicleCard h1{font-size:19px}.vehicleCard button{min-height:40px;font-size:11px;padding:7px}.notice{font-size:12px;padding:7px 8px;margin-bottom:7px}.sectionHead h2{font-size:18px}.timeline{margin-top:7px}.timelineItem{grid-template-columns:15px minmax(0,1fr);gap:5px}.timelineItem:not(:last-child):before{left:6px}.timelineDot{width:12px;height:12px;margin-top:13px}.timelineBody{padding:9px;margin-bottom:6px;border-radius:11px}.timelineTop{display:grid;gap:4px}.timelineTop>div{align-items:flex-start}.timelineTop time{font-size:10px}.meta{display:grid;gap:3px}.detailGrid{grid-template-columns:1fr}.detailGrid .wide{grid-column:auto}.more button{width:100%;min-height:42px}}\n'''
new = '''        @media(max-width:650px){.historyPage{padding:7px 7px 34px}.top{margin-bottom:5px}.top button{min-height:40px;padding:7px 9px}.card{padding:10px;margin-bottom:8px;border-radius:14px}.vehicleCard h1{font-size:19px}.vehicleCard button{min-height:40px;font-size:11px;padding:7px}.notice{font-size:12px;padding:7px 8px;margin-bottom:7px}.sectionHead h2{font-size:18px}.sourceFilters{margin-right:-3px}.sourceFilters button{min-height:40px;padding:7px 11px}.filterNote{font-size:10px}.timeline{margin-top:7px}.timelineItem{grid-template-columns:15px minmax(0,1fr);gap:5px}.timelineItem:not(:last-child):before{left:6px}.timelineDot{width:12px;height:12px;margin-top:13px}.timelineBody{padding:9px;margin-bottom:6px;border-radius:11px}.timelineTop{display:grid;gap:4px}.timelineTop>div{align-items:flex-start}.timelineTop time{font-size:10px}.meta{display:grid;gap:3px}.detailGrid{grid-template-columns:1fr}.detailGrid .wide{grid-column:auto}.more button{width:100%;min-height:42px}}\n'''
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)

r = Path("scripts/vehicle-history-source-filter-regression.mjs")
r.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\nconst history = fs.readFileSync("app/customer-vehicles/history/page.tsx", "utf8");\nassert.ok(history.includes('const SOURCE_FILTERS = ["すべて", "車両操作", "作業", "入出庫", "予定変更", "記録簿", "点検履歴"]'), "stable history source filters");\nassert.ok(history.includes('sourceFilter === "すべて" ? items : items.filter((item) => item.source === sourceFilter)'), "filters already-loaded unified timeline");\nassert.ok(history.includes('aria-label="履歴の種類"'), "filter control is identifiable");\nassert.ok(history.includes('setVisibleCount(DISPLAY_PAGE_SIZE)'), "switching source resets visible page size");\nassert.ok(history.includes('DBの再検索は行いません'), "preview candidate explains local-only filtering");\nassert.ok(!history.includes('sourceFilter).eq('), "filter does not alter Supabase query contract");\nconsole.log("vehicle history source filter regression: PASS");\n''')
