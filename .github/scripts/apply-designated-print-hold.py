from pathlib import Path

p = Path('app/inspection/page.tsx')
s = p.read_text()

before = '''  async function printCurrent() {
    if (mode === "inspection") await saveInspection("printed");
    else await saveDesignated("printed");
    window.print();
  }
'''
after = '''  async function printCurrent() {
    if (mode !== "inspection") {
      setMessage("指定整備記録簿の正式印刷は、正式PDF・最終印刷座標の確認完了後に有効化します。");
      return;
    }
    await saveInspection("printed");
    window.print();
  }
'''
if before not in s:
    raise SystemExit('printCurrent anchor not found')
s = s.replace(before, after, 1)

before2 = '''          <section className="card actions noPrint"><button onClick={() => void saveDesignated("draft")}>下書き保存</button><button className="primary" onClick={() => void saveDesignated("confirmed")}>担当者確認済みにする</button><button onClick={() => void printCurrent()}>🖨 印刷</button></section>
'''
after2 = '''          <section className="card actions noPrint"><button onClick={() => void saveDesignated("draft")}>下書き保存</button><button className="primary" onClick={() => void saveDesignated("confirmed")}>担当者確認済みにする</button><button disabled title="正式PDF・最終印刷座標の確認待ち">🖨 正式印刷（確認待ち）</button><small className="help">正式PDF・最終印刷座標が確定するまで、指定整備記録簿の正式印刷は無効です。</small></section>
'''
if before2 not in s:
    raise SystemExit('designated actions anchor not found')
s = s.replace(before2, after2, 1)
p.write_text(s)

r = Path('scripts/designated-print-hold-regression.mjs')
r.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\n\nconst page = fs.readFileSync("app/inspection/page.tsx", "utf8");\nassert.ok(page.includes('if (mode !== "inspection")'), "designated print path is fail-closed");\nassert.ok(page.includes('正式PDF・最終印刷座標の確認完了後に有効化します。'), "blocked print explains readiness requirement");\nassert.ok(page.includes('disabled title="正式PDF・最終印刷座標の確認待ち"'), "designated formal print button is disabled");\nassert.ok(page.includes('🖨 正式印刷（確認待ち）'), "designated print hold is visible to operator");\nassert.ok(page.includes('await saveInspection("printed");'), "inspection print path remains available");\nassert.ok(!page.includes('else await saveDesignated("printed");'), "designated print cannot mark printed through printCurrent");\nassert.ok(page.includes('saveDesignated("confirmed")'), "operator confirmation remains available");\nconsole.log("designated print hold regression: PASS");\n''')
