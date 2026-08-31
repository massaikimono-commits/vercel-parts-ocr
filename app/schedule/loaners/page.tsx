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

type DemandDay = {
  day: string;
  count: number;
  unknownReturn: number;
};

function customerName(customer: Customer | null) {
  return customer?.schedule_display_name || customer?.company_name || customer?.name || "未登録";
}

function last4(vehicle: Vehicle | null) {
  return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "";
}

function dayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
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

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(day + "T00:00:00Z"));
}

function addDays(day: string, amount: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function stateLabel(work: WorkOrder) {
  if (work.work_completed || work.status === "completed") return "作業完了・返却待ち";
  if (work.status === "in_progress") return "作業中";
  return "予約・入庫待ち";
}

function loanerStart(row: Row) {
  return row.work.checked_in_at || row.schedule?.starts_at || null;
}

function loanerEndDay(work: WorkOrder) {
  if (work.planned_delivery_at) return dayKey(work.planned_delivery_at);
  return work.planned_delivery_date || null;
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
        if (!entry.work_order_id) continue;
        const current = scheduleMap.get(entry.work_order_id);
        if (!current || (current.entry_type === "delivery" && entry.entry_type !== "delivery")) {
          scheduleMap.set(entry.work_order_id, entry);
        }
      }
      const vehicleMap = new Map(vehicles.map((x) => [x.id, x]));
      const customerMap = new Map(customers.map((x) => [x.id, x]));

      const nextRows = works.map((work) => {
        const vehicle = vehicleMap.get(work.vehicle_id) || null;
        const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
        return { work, schedule: scheduleMap.get(work.id) || null, vehicle, customer };
      }).sort((a, b) => {
        const av = loanerStart(a) ? Date.parse(loanerStart(a) as string) : Number.MAX_SAFE_INTEGER;
        const bv = loanerStart(b) ? Date.parse(loanerStart(b) as string) : Number.MAX_SAFE_INTEGER;
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

  const demandDays = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    const horizon = addDays(today, 13);
    const map = new Map<string, DemandDay>();
    for (let day = today; day <= horizon; day = addDays(day, 1)) {
      map.set(day, { day, count: 0, unknownReturn: 0 });
    }

    for (const row of rows) {
      const startValue = loanerStart(row);
      if (!startValue) continue;
      const start = dayKey(startValue);
      const end = loanerEndDay(row.work);
      const effectiveStart = start < today ? today : start;
      const effectiveEnd = end ? (end > horizon ? horizon : end) : effectiveStart;
      if (effectiveStart > horizon || effectiveEnd < today) continue;

      for (let day = effectiveStart; day <= effectiveEnd; day = addDays(day, 1)) {
        const item = map.get(day);
        if (!item) continue;
        item.count += 1;
        if (!end) item.unknownReturn += 1;
      }
    }
    return [...map.values()];
  }, [rows]);

  const peakDemand = useMemo(() => Math.max(0, ...demandDays.map((x) => x.count)), [demandDays]);

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
        <div className="heroActions">
          <button onClick={() => location.assign("/loaners")}>実在庫ボード</button>
          <button onClick={() => void load()} disabled={busy}>再読込</button>
        </div>
      </section>

      <section className="summary">
        <div><b>{summary.waiting}</b><span>予約・入庫待ち</span></div>
        <div><b>{summary.active}</b><span>貸出中候補</span></div>
        <div><b>{summary.returnWait}</b><span>返却待ち候補</span></div>
        <div><b>{peakDemand}</b><span>今後14日の最大必要台数</span></div>
      </section>

      <section className="demandPanel">
        <div className="sectionTitle">
          <div><b>今後14日の代車需要</b><span>予約開始〜返却予定日で必要台数を集計</span></div>
        </div>
        <div className="demandGrid">
          {demandDays.map((item) => (
            <div className={`demandDay ${item.count === peakDemand && peakDemand > 0 ? "peak" : ""}`} key={item.day}>
              <span>{dayLabel(item.day)}</span>
              <b>{item.count}台</b>
              {item.unknownReturn > 0 && <small>返却未定 {item.unknownReturn}</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="board">
        {rows.map(({ work, schedule, vehicle, customer }) => (
          <article className="row" key={work.id}>
            <div className="when">
              <b>{dateTimeLabel(work.checked_in_at || schedule?.starts_at || null)}</b>
              <span>{work.checked_in_at ? "入庫済み" : schedule?.entry_type || "予定未登録"}</span>
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
              {!work.planned_delivery_at && !work.planned_delivery_date && <span className="warning">返却予定未定</span>}
            </div>
            <div className="state">{stateLabel(work)}</div>
            {schedule && <button onClick={() => location.assign("/schedule/edit?id=" + schedule.id)}>予約を開く</button>}
          </article>
        ))}
        {!busy && rows.length === 0 && <div className="empty">代車が必要な予約はありません。</div>}
      </section>

      <div className="note">実在庫の空き・貸出・返却は「実在庫ボード」で管理し、この画面では既存予約から必要台数と重なりを確認します。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit;border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}.loanerPage{max-width:1100px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}.hero{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px;margin-bottom:10px}.heroActions{display:flex;gap:8px;align-items:center}.eyebrow{font-weight:800;color:#2674e8}.hero h1{margin:4px 0;font-size:30px}.hero p{margin:0;color:#687587}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}.summary>div{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:14px;display:grid}.summary b{font-size:28px}.summary span{font-size:12px;color:#687587}.demandPanel{background:#fff;border:1px solid #d9e0ea;border-radius:16px;padding:14px;margin-bottom:10px}.sectionTitle>div{display:grid}.sectionTitle span{font-size:12px;color:#687587}.demandGrid{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin-top:10px}.demandDay{border:1px solid #e0e6ef;border-radius:11px;padding:9px;display:grid;gap:2px}.demandDay>span{font-size:11px;color:#687587}.demandDay>b{font-size:20px}.demandDay small{font-size:10px;color:#a45f00;font-weight:800}.demandDay.peak{border-color:#e2a82e;background:#fff8e7}.board{display:grid;gap:8px}.row{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:12px;display:grid;grid-template-columns:130px minmax(180px,1.2fr) minmax(220px,1fr) auto auto;gap:10px;align-items:center}.when,.main{display:grid}.when span,.main span{font-size:12px;color:#687587}.meta{display:flex;gap:5px;flex-wrap:wrap}.meta span{font-size:11px;background:#f1f4f8;border-radius:999px;padding:4px 6px}.meta .warning{background:#fff1df;color:#9a5700;font-weight:900}.state{font-size:11px;font-weight:900;background:#edf3fb;border-radius:999px;padding:5px 8px;white-space:nowrap}.empty{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:28px;text-align:center;color:#8a96a5}.note{margin-top:10px;color:#7a8696;font-size:12px}@media(max-width:760px){.hero{display:block}.heroActions{margin-top:12px;display:grid;grid-template-columns:1fr 1fr}.heroActions button{width:100%}.summary{grid-template-columns:repeat(2,1fr)}.demandGrid{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}.row>button{width:100%}}
      `}</style>
    </main>
  );
}
