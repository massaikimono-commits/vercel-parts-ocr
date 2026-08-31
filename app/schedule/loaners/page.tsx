/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type WorkOrder = {
  id: string;
  vehicle_id: string;
  reason: string;
  worker_name: string | null;
  status: string;
  work_completed: boolean;
  needs_loaner: boolean;
  planned_delivery_at: string | null;
  planned_delivery_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
};

type ScheduleEntry = {
  id: string;
  work_order_id: string | null;
  vehicle_id: string | null;
  entry_type: string;
  starts_at: string;
};

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number_last4: string | null;
  registration_number: string | null;
};

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  schedule_display_name: string | null;
};

type Row = {
  work: WorkOrder;
  schedule: ScheduleEntry | null;
  vehicle: Vehicle | null;
  customer: Customer | null;
};

function customerName(customer: Customer | null) {
  return customer?.schedule_display_name || customer?.company_name || customer?.name || "未登録";
}

function last4(vehicle: Vehicle | null) {
  return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "";
}

function dateTimeLabel(value: string | null) {
  if (!value) return "未定";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function stateLabel(work: WorkOrder) {
  if (work.work_completed || work.status === "completed") return "作業完了・返却待ち";
  if (work.status === "in_progress") return "作業中";
  return "予約・入庫待ち";
}

export default function LoanerDemandPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("代車が必要な予約を読み込みます。");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    setMessage("代車予約を確認中…");
    try {
      const { data: workData, error: workError } = await supabase
        .from("work_orders")
        .select("id,vehicle_id,reason,worker_name,status,work_completed,needs_loaner,planned_delivery_at,planned_delivery_date,checked_in_at,checked_out_at")
        .eq("needs_loaner", true)
        .is("checked_out_at", null)
        .limit(300);
      if (workError) throw workError;
      const works = (workData || []) as WorkOrder[];

      if (!works.length) {
        setRows([]);
        setMessage("現在、代車が必要な予約はありません。");
        return;
      }

      const workIds = works.map((x) => x.id);
      const vehicleIds = [...new Set(works.map((x) => x.vehicle_id).filter(Boolean))];

      const [scheduleRes, vehicleRes] = await Promise.all([
        supabase
          .from("schedule_entries")
          .select("id,work_order_id,vehicle_id,entry_type,starts_at")
          .in("work_order_id", workIds)
          .order("starts_at", { ascending: true }),
        supabase
          .from("vehicles")
          .select("id,customer_id,registration_number_last4,registration_number")
          .in("id", vehicleIds),
      ]);
      if (scheduleRes.error) throw scheduleRes.error;
      if (vehicleRes.error) throw vehicleRes.error;

      const schedules = (scheduleRes.data || []) as ScheduleEntry[];
      const vehicles = (vehicleRes.data || []) as Vehicle[];
      const customerIds = [...new Set(vehicles.map((x) => x.customer_id).filter(Boolean))] as string[];

      let customers: Customer[] = [];
      if (customerIds.length) {
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name")
          .in("id", customerIds);
        if (error) throw error;
        customers = (data || []) as Customer[];
      }

      const scheduleMap = new Map<string, ScheduleEntry>();
      for (const entry of schedules) {
        if (!entry.work_order_id || scheduleMap.has(entry.work_order_id)) continue;
        scheduleMap.set(entry.work_order_id, entry);
      }
      const vehicleMap = new Map(vehicles.map((x) => [x.id, x]));
      const customerMap = new Map(customers.map((x) => [x.id, x]));

      const nextRows = works.map((work) => {
        const vehicle = vehicleMap.get(work.vehicle_id) || null;
        const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
        return { work, schedule: scheduleMap.get(work.id) || null, vehicle, customer };
      }).sort((a, b) => {
        const av = a.schedule?.starts_at ? Date.parse(a.schedule.starts_at) : Number.MAX_SAFE_INTEGER;
        const bv = b.schedule?.starts_at ? Date.parse(b.schedule.starts_at) : Number.MAX_SAFE_INTEGER;
        return av - bv;
      });

      setRows(nextRows);
      setMessage(`${nextRows.length}件の代車必要予約があります。`);
    } catch (error: any) {
      setRows([]);
      setMessage("代車予約の読み込みエラー: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    let waiting = 0;
    let active = 0;
    let returnWait = 0;
    for (const { work } of rows) {
      if (work.work_completed || work.status === "completed") returnWait += 1;
      else if (work.status === "in_progress") active += 1;
      else waiting += 1;
    }
    return { waiting, active, returnWait };
  }, [rows]);

  return (
    <main className="loanerPage">
      <header className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <div><b>代車管理</b><span>必要予約一覧</span></div>
        <strong>icb</strong>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">既存予約から自動抽出</div>
          <h1>代車が必要な予約</h1>
          <p>{busy ? "読み込み中…" : message}</p>
        </div>
        <button onClick={() => void load()} disabled={busy}>再読込</button>
      </section>

      <section className="summary">
        <div><b>{summary.waiting}</b><span>予約・入庫待ち</span></div>
        <div><b>{summary.active}</b><span>貸出中候補</span></div>
        <div><b>{summary.returnWait}</b><span>返却待ち候補</span></div>
      </section>

      <section className="board">
        {rows.map(({ work, schedule, vehicle, customer }) => (
          <article className="row" key={work.id}>
            <div className="when">
              <b>{dateTimeLabel(schedule?.starts_at || null)}</b>
              <span>{schedule?.entry_type || "予定未登録"}</span>
            </div>
            <div className="main">
              <b>{customerName(customer)}</b>
              <span>{work.reason}</span>
            </div>
            <div className="meta">
              {last4(vehicle) && <span>下4桁 {last4(vehicle)}</span>}
              {work.worker_name && <span>担当 {work.worker_name}</span>}
              {work.planned_delivery_at && <span>返却目安 {dateTimeLabel(work.planned_delivery_at)}</span>}
              {!work.planned_delivery_at && work.planned_delivery_date && <span>返却目安 {work.planned_delivery_date}</span>}
            </div>
            <div className="state">{stateLabel(work)}</div>
            {schedule && <button onClick={() => location.assign("/schedule/edit?id=" + schedule.id)}>予約を開く</button>}
          </article>
        ))}
        {!busy && rows.length === 0 && <div className="empty">代車が必要な予約はありません。</div>}
      </section>

      <div className="note">自社代車/レンタカーの車両在庫マスターはまだ追加せず、現在の予約データだけで必要台数を見える化しています。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit;border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}.loanerPage{max-width:1100px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}.hero{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px;margin-bottom:10px}.eyebrow{font-weight:800;color:#2674e8}.hero h1{margin:4px 0;font-size:30px}.hero p{margin:0;color:#687587}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}.summary>div{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:14px;display:grid}.summary b{font-size:28px}.summary span{font-size:12px;color:#687587}.board{display:grid;gap:8px}.row{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:12px;display:grid;grid-template-columns:130px minmax(180px,1.2fr) minmax(220px,1fr) auto auto;gap:10px;align-items:center}.when,.main{display:grid}.when span,.main span{font-size:12px;color:#687587}.meta{display:flex;gap:5px;flex-wrap:wrap}.meta span{font-size:11px;background:#f1f4f8;border-radius:999px;padding:4px 6px}.state{font-size:11px;font-weight:900;background:#edf3fb;border-radius:999px;padding:5px 8px;white-space:nowrap}.empty{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:28px;text-align:center;color:#8a96a5}.note{margin-top:10px;color:#7a8696;font-size:12px}@media(max-width:760px){.hero{display:block}.hero button{margin-top:12px;width:100%}.summary{grid-template-columns:1fr}.row{grid-template-columns:1fr}.row>button{width:100%}}
      `}</style>
    </main>
  );
}
