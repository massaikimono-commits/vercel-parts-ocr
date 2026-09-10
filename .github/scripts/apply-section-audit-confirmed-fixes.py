from pathlib import Path

# Section 3: existing Supabase Auth global sign-out, no DB/RPC/schema addition.
p = Path('app/settings/login-history/page.tsx')
s = p.read_text()
s = s.replace('import { safeActionError } from "../../lib/client-security";', 'import { clearSensitiveLocalState, safeActionError } from "../../lib/client-security";', 1)
s = s.replace('  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);\n', '  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);\n  const [remoteSigningOut, setRemoteSigningOut] = useState(false);\n', 1)
anchor = '''  useEffect(() => {
    void load();
  }, []);

'''
insert = '''  useEffect(() => {
    void load();
  }, []);

  async function signOutAllDevices() {
    if (remoteSigningOut) return;
    const ok = window.confirm(
      "このIDをすべての端末からログアウトしますか？\\n\\n他端末のセッションも再認証が必要になります。"
    );
    if (!ok) return;
    setRemoteSigningOut(true);
    setMessage("");
    try {
      try { await supabase.rpc("record_logout"); } catch {}
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      clearSensitiveLocalState();
      location.replace("/");
    } catch (error: any) {
      setMessage(safeActionError("全端末ログアウト", error));
      setRemoteSigningOut(false);
    }
  }

'''
if anchor not in s:
    raise SystemExit('login history effect anchor not found')
s = s.replace(anchor, insert, 1)
buttons = '''        <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => history.back()}>← 戻る</button>
          <button onClick={() => void load()} disabled={busy}>更新</button>
        </div>
'''
buttons_new = '''        <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => history.back()}>← 戻る</button>
          <div className="actions">
            <button onClick={() => void load()} disabled={busy || remoteSigningOut}>更新</button>
            <button onClick={() => void signOutAllDevices()} disabled={remoteSigningOut}>
              {remoteSigningOut ? "ログアウト処理中…" : "全端末からログアウト"}
            </button>
          </div>
        </div>
'''
if buttons not in s:
    raise SystemExit('login buttons anchor not found')
s = s.replace(buttons, buttons_new, 1)
p.write_text(s)

# Section 15: remove stale UI claim of automatic cloud synchronization, which is deprecated.
p2 = Path('app/customer-vehicles/page.tsx')
s2 = p2.read_text()
old = '車両を開くと過去の部品OCR履歴まで確認でき、端末で保存した車両紐付け済み部品はクラウドにも自動同期します。'
new = '車両を開くと過去の部品OCR履歴まで確認でき、正式保存済み部品と端末の未確定データを分けて確認できます。'
if old not in s2:
    raise SystemExit('stale parts sync copy anchor not found')
s2 = s2.replace(old, new, 1)
p2.write_text(s2)

r = Path('scripts/section-audit-confirmed-fixes-regression.mjs')
r.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\n\nconst login = fs.readFileSync("app/settings/login-history/page.tsx", "utf8");\nconst customer = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");\nconst inspection = fs.readFileSync("app/inspection/page.tsx", "utf8");\n\nassert.ok(login.includes('supabase.auth.signOut({ scope: "global" })'), "remote logout uses existing Supabase Auth global sign-out");\nassert.ok(login.includes('全端末からログアウト'), "remote logout is operator-visible");\nassert.ok(login.includes('window.confirm('), "remote logout requires explicit confirmation");\nassert.ok(login.includes('clearSensitiveLocalState();'), "remote logout clears sensitive local state");\nassert.ok(!customer.includes('クラウドにも自動同期します'), "deprecated parts auto-sync claim is removed");\nassert.ok(customer.includes('正式保存済み部品と端末の未確定データを分けて確認できます'), "parts history copy matches explicit formal-save semantics");\nassert.ok(inspection.includes('🖨 正式印刷（確認待ち）'), "designated formal print remains held pending final PDF/coordinates");\nassert.ok(inspection.includes('if (mode !== "inspection")'), "designated print path remains fail-closed");\nconsole.log("section audit confirmed fixes regression: PASS");\n''')
