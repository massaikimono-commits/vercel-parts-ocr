"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";

type LoginEvent = {
  occurred_at: string;
  event_type: "login_success" | "login_failure" | "logout";
  ip_address: string | null;
  user_agent: string | null;
  aal: string | null;
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

  async function load() {
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("my_login_security_history", { p_limit: 100 });
    if (error) {
      setMessage(safeActionError("ログイン履歴の読み込み", error));
      setBusy(false);
      return;
    }
    setRows((data || []) as LoginEvent[]);
    setBusy(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const failedCount = useMemo(
    () => rows.filter((x) => x.event_type === "login_failure").length,
    [rows]
  );

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <section className="card">
        <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => history.back()}>← 戻る</button>
          <button onClick={() => void load()} disabled={busy}>更新</button>
        </div>

        <h1>ログイン履歴</h1>
        <p>
          自分のIDに対する直近のログイン状況です。
          IPアドレスは携帯回線・Wi-Fi・会社回線などで変わるため、IPだけで不正アクセスとは判断しません。
        </p>

        {failedCount > 0 && (
          <div className="notice">
            この履歴内にログイン失敗が {failedCount} 件あります。
            身に覚えのない成功ログインがある場合は、パスワード変更とアカウント停止を優先してください。
          </div>
        )}

        {message && <div className="notice">{message}</div>}
        {busy && <p>読み込み中…</p>}

        {!busy && rows.length === 0 && <p>まだログイン履歴はありません。</p>}

        {!busy && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 8 }}>日時</th>
                  <th style={{ textAlign: "left", padding: 8 }}>結果</th>
                  <th style={{ textAlign: "left", padding: 8 }}>IPアドレス</th>
                  <th style={{ textAlign: "left", padding: 8 }}>端末</th>
                  <th style={{ textAlign: "left", padding: 8 }}>認証</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.occurred_at + "-" + i} style={{ borderTop: "1px solid #ddd" }}>
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>{jst(row.occurred_at)}</td>
                    <td style={{ padding: 8 }}>
                      <strong>{eventLabel(row.event_type)}</strong>
                    </td>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{row.ip_address || "不明"}</td>
                    <td style={{ padding: 8 }}>{deviceLabel(row.user_agent)}</td>
                    <td style={{ padding: 8 }}>
                      {row.aal === "aal2" ? "2段階認証済み" : row.aal === "aal1" ? "ID・パスワード" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
