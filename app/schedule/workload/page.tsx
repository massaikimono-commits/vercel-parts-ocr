/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type WorkOrder = {
  id: string;
  worker_name: string | null;
  status: string;
  work_completed: boolean;
  checked_in_at: string | null;
  checked_out_at: string | null;
  reason: string | null;
  is_urgent: boolean | null;
};

type LoadRow = {
  name: string;
  total: number;
  unfinished: number;
  notStarted: number;
  inProgress: number;
  completedWaiting: number;
  staying: number;
  urgent: number;
  oldestStayDays: number;
};

function normalizeWorker(name: string | null) {
  return name?.trim() || "担当未設定";
}

function dayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function elapsedStayDays(checkedInAt: string | null) {
  if (!checkedInAt) return null;
  const start = Date.parse(dayKey(checkedInAt) + "T00:00:00Z");
  const today = Date.parse(dayKey(new Date().toISOString()) + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(today) || today < start) return null;
  return Math.floor((today - start) / 86_400_000);
}

export default function WorkloadPage() {
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("担当者の負荷を読み込みます。");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    setMessage("担当者の負荷を読み込み中…");
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id,worker_name,status,work_completed,checked_in_at,checked_out_at,reason,is_urgent")
        .is("checked_out_at", null)
        .neq("status", "cancelled")
        .limit(500);
      if (error) throw error;
      setWorks((data || []) as WorkOrder[]);
      setMessage("現在出庫前の作業を担当者別に集計しています。");
    } catch (error: any) {
      setWorks([]);
      setMessage("負荷表の読み込みエラー: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    const map = new Map<string, LoadRow>();
    for (const work of works) {
      const name = normalizeWorker(work.worker_name);
      const row = map.get(name) || {
        name,
        total: 0,
        unfinished: 0,
        notStarted: 0,
        inProgress: 0,
        completedWaiting: 0,
        staying: 0,
        urgent: 0,
        oldestStayDays: 0,
      };
      row.total += 1;
      if (work.work_completed || work.status === "completed") {
        row.completedWaiting += 1;
      } else if (work.status === "in_progress") {
        row.inProgress += 1;
        row.unfinished += 1;
      } else {
        row.notStarted += 1;
        row.unfinished += 1;
      }
      if (work.is_urgent && !work.work_completed && work.status !== "completed") row.urgent += 1;

      const stayDays = elapsedStayDays(work.checked_in_at);
      if (stayDays !== null) {
        row.staying += 1;
        row.oldestStayDays = Math.max(row.oldestStayDays, stayDays);
      }
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => {
      return b.unfinished - a.unfinished
        || b.urgent - a.urgent
        || b.inProgress - a.inProgress
        || b.oldestStayDays - a.oldestStayDays
        || b.total - a.total
        || a.name.localeCompare(b.name, "ja");
    });
  }, [works]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    total: acc.total + row.total,
    unfinished: acc.unfinished + row.unfinished,
    notStarted: acc.notStarted + row.notStarted,
    inProgress: acc.inProgress + row.inProgress,
    completedWaiting: acc.completedWaiting + row.completedWaiting,
    staying: acc.staying + row.staying,
    urgent: acc.urgent + row.urgent,
    oldestStayDays: Math.max(acc.oldestStayDays, row.oldestStayDays),
  }), { total: 0, unfinished: 0, notStarted: 0, inProgress: 0, completedWaiting: 0, staying: 0, urgent: 0, oldestStayDays: 0 }), [rows]);

  const unassignedRow = useMemo(() => rows.find((row) => row.name === "担当未設定") || null, [rows]);

  return (
    <main className="loadPage">
      <header className="top">
        <button onClick={() => location.assign("/schedule/week")}>← 1週間予定へ</button>
        <div><b>担当者負荷</b><span>出庫前の作業状況</span></div>
        <strong>icb</strong>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">作業負荷表</div>
          <h1>担当者ごとの現在負荷</h1>
          <p>{busy ? "読み込み中…" : message}</p>
        </div>
        <button className="reload" disabled={busy} onClick={() => void load()}>再読込</button>
      </section>

      <section className="summary">
        <div><span>出庫前</span><b>{totals.total}</b></div>
        <div className="unfinishedSummary"><span>未完了</span><b>{totals.unfinished}</b></div>
        <div><span>未実施</span><b>{totals.notStarted}</b></div>
        <div><span>作業中</span><b>{totals.inProgress}</b></div>
        <div><span>急ぎ未完了</span><b>{totals.urgent}</b></div>
        <div><span>作業完了・納車待ち</span><b>{totals.completedWaiting}</b></div>
        <div><span>入庫中</span><b>{totals.staying}</b></div>
        <div><span>最長滞留</span><b>{totals.staying ? `${totals.oldestStayDays}日` : "-"}</b></div>
      </section>

      {!busy && unassignedRow && unassignedRow.unfinished > 0 && (
        <div className="unassignedAlert" role="status">
          <div>
            <b>担当未設定の未完了車両があります</b>
            <span>未完了 {unassignedRow.unfinished}台（未実施 {unassignedRow.notStarted}台・作業中 {unassignedRow.inProgress}台）</span>
          </div>
          {unassignedRow.urgent > 0 && <strong>急ぎ {unassignedRow.urgent}台</strong>}
        </div>
      )}

      <section className="tableCard">
        <div className="tableHead">
          <span>担当者</span><span>未完了</span><span>未実施</span><span>作業中</span><span>急ぎ</span><span>完了待ち</span><span>入庫中</span><span>最長滞留</span><span>合計</span>
        </div>
        {rows.map((row) => (
          <div className={`loadRow ${row.name === "担当未設定" ? "unassigned" : ""}`} key={row.name}>
            <b>{row.name}</b>
            <span className={row.unfinished ? "unfinished" : ""}>{row.unfinished}</span>
            <span className={row.notStarted ? "warn" : ""}>{row.notStarted}</span>
            <span className={row.inProgress ? "progress" : ""}>{row.inProgress}</span>
            <span className={row.urgent ? "urgent" : ""}>{row.urgent}</span>
            <span>{row.completedWaiting}</span>
            <span className={row.staying ? "stay" : ""}>{row.staying}</span>
            <span className={row.oldestStayDays ? "stayAge" : ""}>{row.staying ? `${row.oldestStayDays}日` : "-"}</span>
            <strong>{row.total}</strong>
          </div>
        ))}
        {!busy && rows.length === 0 && <div className="empty">現在の出庫前作業はありません。</div>}
      </section>

      <div className="hint">未完了は「未実施＋作業中」の台数です。担当者は未完了台数が多い順に並び、同数なら急ぎ・作業中・滞留日数を優先します。同じ作業を複数予定に登録していても、work_orders単位で1台として集計します。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit}
        .loadPage{max-width:1180px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}.top button,.reload{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .hero{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}.eyebrow{color:#2674e8;font-weight:800}.hero h1{font-size:28px;margin:3px 0}.hero p{margin:0;color:#6d798a}.summary{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;margin:10px 0}.summary>div{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:13px;display:grid;gap:4px}.summary .unfinishedSummary{border-color:#c8d9f2;background:#f7fbff}.summary span{font-size:12px;color:#687587}.summary b{font-size:26px}.unassignedAlert{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:0 0 10px;padding:12px 14px;border:1px solid #f2c99e;border-radius:14px;background:#fff8f2;color:#8b4b19}.unassignedAlert>div{display:grid;gap:3px}.unassignedAlert span{font-size:12px;color:#8b684c}.unassignedAlert strong{white-space:nowrap;border-radius:999px;padding:6px 10px;background:#fff0f0;color:#b02a2a}.tableCard{background:#fff;border:1px solid #d9e0ea;border-radius:18px;overflow:hidden}.tableHead,.loadRow{display:grid;grid-template-columns:minmax(160px,1.5fr) repeat(8,minmax(70px,.6fr));gap:8px;align-items:center;padding:11px 14px}.tableHead{background:#f7f9fc;color:#657184;font-size:11px;font-weight:900}.tableHead span:not(:first-child),.loadRow span,.loadRow strong{text-align:center}.loadRow{border-top:1px solid #edf0f4}.loadRow>b{font-size:15px}.loadRow span,.loadRow strong{border-radius:999px;padding:5px 7px;font-weight:900}.loadRow .unfinished{background:#edf4ff;color:#1f5cae}.loadRow .warn{background:#fff4d8;color:#8a5a00}.loadRow .progress{background:#eaf3ff;color:#245ca8}.loadRow .urgent{background:#fff0f0;color:#b02a2a}.loadRow .stay{background:#eef7ed;color:#356d31}.loadRow .stayAge{background:#fff4d8;color:#8a5a00}.loadRow.unassigned{background:#fff8f2}.loadRow.unassigned>b{color:#a25417}.empty{padding:28px;text-align:center;color:#8b97a7}.hint{font-size:12px;color:#78869a;margin-top:8px}
        @media(max-width:900px){.summary{grid-template-columns:repeat(4,1fr)}}
        @media(max-width:650px){.hero{display:block}.reload{margin-top:12px;width:100%}.summary{grid-template-columns:1fr 1fr}.unassignedAlert{align-items:flex-start}.tableCard{overflow-x:auto}.tableHead,.loadRow{min-width:980px}.hero h1{font-size:24px}}
      `}</style>
    </main>
  );
}
