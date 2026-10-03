"use client";

import { useSecurityAlertAcknowledgement } from "../../lib/security-alert-acknowledgement";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { clearSensitiveLocalState, safeActionError } from "../../lib/client-security";

type LoginEvent = {
  occurred_at: string;
  event_type: "login_success" | "login_failure" | "logout";
  ip_address: string | null;
  user_agent: string | null;
  aal: string | null;
};

type SecurityAlert = {
  severity: "warning" | "high";
  alert_code: string;
  occurred_at: string | null;
  message: string;
};

function jst(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function deviceLabel(ua: string | null) {
  const x = String(ua || "");
  if (/iPhone/i.test(x)) {
    if (/CriOS/i.test(x)) return "iPhone / Chrome";
    if (/FxiOS/i.test(x)) return "iPhone / Firefox";
    return "iPhone / Safari";
  }
  if (/iPad/i.test(x)) return "iPad";
  if (/Android/i.test(x)) return /Chrome/i.test(x) ? "Android / Chrome" : "Android";
  if (/Windows/i.test(x)) {
    if (/Edg\//i.test(x)) return "Windows / Edge";
    if (/Chrome/i.test(x)) return "Windows / Chrome";
    if (/Firefox/i.test(x)) return "Windows / Firefox";
    return "Windows";
  }
  if (/Macintosh|Mac OS X/i.test(x)) return /Chrome/i.test(x) ? "Mac / Chrome" : "Mac / Safari";
  return x ? "その他の端末" : "不明";
}

function eventLabel(type: LoginEvent["event_type"]) {
  if (type === "login_success") return "ログイン成功";
  if (type === "login_failure") return "ログイン失敗";
  return "ログアウト";
}

export default function LoginHistoryPage() {
  const [rows, setRows] = useState<LoginEvent[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [remoteSigningOut, setRemoteSigningOut] = useState(false);

  const securityAcknowledgement = useSecurityAlertAcknowledgement(alerts[0] || null);

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const [historyRes, alertRes] = await Promise.all([
        supabase.rpc("my_login_security_history", { p_limit: 100 }),
        supabase.rpc("my_login_security_alerts", { p_limit: 10 }),
      ]);
      if (historyRes.error) throw historyRes.error;
      setRows((historyRes.data || []) as LoginEvent[]);
      if (alertRes.error) {
        setAlerts([]);
        setMessage(safeActionError("セキュリティ通知の読み込み", alertRes.error));
      } else {
        setAlerts((alertRes.data || []) as SecurityAlert[]);
      }
    } catch (error) {
      setRows([]); setAlerts([]);
      setMessage(safeActionError("ログイン履歴の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function signOutAllDevices() {
    if (remoteSigningOut) return;
    const ok = window.confirm(
      "このIDをすべての端末からログアウトしますか？\n\n他端末のセッションも再認証が必要になります。"
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

  const failedCount = useMemo(
    () => rows.filter((x) => x.event_type === "login_failure").length,
    [rows]
  );

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <section className="card">
        <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => history.back()}>← 戻る</button>
          <div className="actions">
            <button onClick={() => void load()} disabled={busy || remoteSigningOut}>更新</button>
            <button onClick={() => void signOutAllDevices()} disabled={remoteSigningOut}>
              {remoteSigningOut ? "ログアウト処理中…" : "全端末からログアウト"}
            </button>
          </div>
        </div>

        <h1>ログイン履歴</h1>
        <p>
          自分のIDに対する直近のログイン状況です。
          IPアドレスは携帯回線・Wi-Fi・会社回線などで変わるため、IPだけで不正アクセスとは判断しません。
        </p>

        {alerts.length > 0 && (
          <div className="notice">
            <strong>⚠ 自動検知した要注意ログイン</strong>
            {alerts.map((alert, i) => (
              <div key={alert.alert_code + "-" + i} style={{ marginTop: 8 }}>
                {alert.message}
                {alert.occurred_at ? <small>　{jst(alert.occurred_at)}</small> : null}
              </div>
            ))}
            <button type="button" className="uxSecurityAck" disabled={securityAcknowledgement.acknowledged}
              onClick={securityAcknowledgement.acknowledge}>
              {securityAcknowledgement.acknowledged ? "確認済み" : "確認済みにする"}
            </button>
          </div>
        )}

        {failedCount > 0 && (
          <div className="notice">
            この履歴内にログイン失敗が {failedCount} 件あります。
            身に覚えのない成功ログインがある場合は、パスワード変更とアカウント停止を優先してください。
          </div>
        )}

        {message && <div className="notice" role="alert">{message}</div>}
        {busy && <p role="status">読み込み中…</p>}

        {!busy && !message && rows.length === 0 && <p>まだログイン履歴はありません。</p>}

        {!busy && rows.length > 0 && (
          <div className="loginHistoryTable">
            <table>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>日時</th>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>結果</th>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>IPアドレス</th>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>端末</th>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>認証</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.occurred_at + "-" + i} style={{ borderTop: "1px solid #ddd" }}>
                    <td data-label="日時" style={{ padding: 8, whiteSpace: "nowrap" }}>{jst(row.occurred_at)}</td>
                    <td data-label="結果" style={{ padding: 8 }}>
                      <strong>{eventLabel(row.event_type)}</strong>
                    </td>
                    <td data-label="IPアドレス" style={{ padding: 8, fontFamily: "monospace" }}>{row.ip_address || "不明"}</td>
                    <td data-label="端末" style={{ padding: 8 }}>{deviceLabel(row.user_agent)}</td>
                    <td data-label="認証" style={{ padding: 8 }}>
                      {row.aal === "aal2" ? "2段階認証済み" : row.aal === "aal1" ? "ID・パスワード" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <style jsx>{`
        .loginHistoryTable{overflow-x:auto}
        .loginHistoryTable table{width:100%;border-collapse:collapse;min-width:720px}
        @media(max-width:760px){
          .loginHistoryTable table{min-width:0}
          .loginHistoryTable thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
          .loginHistoryTable tbody{display:grid;gap:8px}
          .loginHistoryTable tr{display:grid;border:1px solid #d9e0ea;border-radius:10px;padding:6px}
          .loginHistoryTable td{display:grid;grid-template-columns:80px minmax(0,1fr);gap:6px;border:0;overflow-wrap:anywhere;white-space:normal!important}
          .loginHistoryTable td::before{content:attr(data-label);font-family:inherit;color:#647184;font-weight:700}
        }
      `}</style>
    </main>
  );
}
