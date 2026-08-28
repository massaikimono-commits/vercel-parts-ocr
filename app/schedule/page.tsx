/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

type ScheduleEntry = {
  id: string;
  vehicle_id: string | null;
  work_order_id: string | null;
  entry_type: "delivery" | "pickup" | "customer_visit" | "onsite_repair";
  starts_at: string;
  ends_at: string;
  completed: boolean;
  notes: string | null;
  print_time_mode: "exact" | "morning" | "unspecified";
  print_time_label_override: string | null;
};

type WorkOrder = {
  id: string;
  reason: "点検" | "車検" | "一般整備" | "板金塗装";
  status: string;
  worker_name: string | null;
  expected_completion_date: string | null;
  delivery_completed: boolean;
  work_completed: boolean;
};

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number: string | null;
  registration_number_last4: string | null;
  vehicle_number: string | null;
  chassis_number: string | null;
  maker: string | null;
  model: string | null;
};

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  schedule_display_name: string | null;
};

const ENTRY_LABEL: Record<ScheduleEntry["entry_type"], string> = {
  delivery: "納車",
  pickup: "引き取り",
  customer_visit: "来社",
  onsite_repair: "出張整備",
};

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function jstBounds(day: string) {
  const start = new Date(`${day}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function timeLabel(entry: ScheduleEntry) {
  if (entry.print_time_label_override) return entry.print_time_label_override;
  if (entry.print_time_mode === "morning") return "午前";
  if (entry.print_time_mode === "unspecified") return "時間未定";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(entry.starts_at));
}

function hourInJst(value: string) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(value)));
}

function dateLabel(day: string) {
  const d = new Date(`${day}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

function addDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + delta);
  return localDateString(d);
}

export default function SchedulePage() {
  const [day, setDay] = useState(() => localDateString());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("当日の入出庫予定を読み込みます。");

  useEffect(() => {
    void load();
  }, [day]);

  async function load() {
    setBusy(true);
    const { start, end } = jstBounds(day);
    try {
      const [scheduleRes, workRes, vehicleRes, customerRes] = await Promise.all([
        supabase
          .from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,completed,notes,print_time_mode,print_time_label_override")
          .gte("starts_at", start)
          .lt("starts_at", end)
          .order("starts_at", { ascending: true }),
        supabase
          .from("work_orders")
          .select("id,reason,status,worker_name,expected_completion_date,delivery_completed,work_completed"),
        supabase
          .from("vehicles")
          .select("id,customer_id,registration_number,registration_number_last4,vehicle_number,chassis_number,maker,model"),
        supabase
          .from("customers")
          .select("id,name,company_name,phone,schedule_display_name"),
      ]);

      for (const result of [scheduleRes, workRes, vehicleRes, customerRes]) {
        if (result.error) throw result.error;
      }

      setEntries((scheduleRes.data || []) as ScheduleEntry[]);
      setWorkOrders((workRes.data || []) as WorkOrder[]);
      setVehicles((vehicleRes.data || []) as Vehicle[]);
      setCustomers((customerRes.data || []) as Customer[]);
      setMessage(`${scheduleRes.data?.length || 0}件の予定があります。`);
    } catch (error: any) {
      setMessage(`予定の読み込みエラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  const workMap = useMemo(() => new Map(workOrders.map((x) => [x.id, x])), [workOrders]);
  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);

  const enriched = useMemo(() => entries.map((entry) => {
    const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
    const vehicle = entry.vehicle_id ? vehicleMap.get(entry.vehicle_id) || null : null;
    const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
    return { entry, work, vehicle, customer };
  }), [entries, workMap, vehicleMap, customerMap]);

  const morning = enriched.filter(({ entry }) => hourInJst(entry.starts_at) < 12);
  const afternoon = enriched.filter(({ entry }) => hourInJst(entry.starts_at) >= 12);

  async function toggleCompleted(entry: ScheduleEntry) {
    const next = !entry.completed;
    setEntries((old) => old.map((x) => x.id === entry.id ? { ...x, completed: next } : x));
    const { error } = await supabase.from("schedule_entries").update({ completed: next }).eq("id", entry.id);
    if (error) {
      setEntries((old) => old.map((x) => x.id === entry.id ? { ...x, completed: !next } : x));
      setMessage(`完了状態の保存エラー: ${error.message}`);
      return;
    }
    setMessage(next ? "予定を完了にしました。" : "予定を未完了へ戻しました。");
  }

  function setActiveVehicle(vehicle: Vehicle | null) {
    if (!vehicle) return;
    localStorage.setItem("parts-active-vehicle", JSON.stringify({
      id: vehicle.id,
      number: vehicle.vehicle_number || vehicle.chassis_number || "",
      registration: vehicle.registration_number || "",
      last4: vehicle.registration_number_last4 || "",
      chassis: vehicle.chassis_number || "",
      model: vehicle.model || "",
    }));
    location.assign("/customer-vehicles");
  }

  function renderCard(item: typeof enriched[number]) {
    const { entry, work, vehicle, customer } = item;
    const customerName =
      customer?.schedule_display_name ||
      customer?.company_name ||
      customer?.name ||
      "お客様未登録";
    const last4 =
      vehicle?.registration_number_last4 ||
      vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] ||
      "----";
    return (
      <article key={entry.id} className={`scheduleItem ${entry.completed ? "done" : ""}`}>
        <div className="itemTop">
          <div>
            <b>{timeLabel(entry)}　{ENTRY_LABEL[entry.entry_type]}</b>
            <div className="customer">{customerName}</div>
          </div>
          <button className={entry.completed ? "complete active" : "complete"} onClick={() => void toggleCompleted(entry)}>
            {entry.completed ? "✓ 完了" : "完了"}
          </button>
        </div>
        <div className="meta">
          <span>下4桁 <b>{last4}</b></span>
          <span>{work?.reason || "入庫要因未設定"}</span>
          {work?.worker_name && <span>担当 {work.worker_name}</span>}
          {work?.expected_completion_date && <span>完成予定 {work.expected_completion_date}</span>}
        </div>
        {(vehicle?.maker || vehicle?.model) && (
          <div className="sub">{[vehicle?.maker, vehicle?.model].filter(Boolean).join(" / ")}</div>
        )}
        {entry.notes && <div className="note">{entry.notes}</div>}
        {vehicle && <button className="open" onClick={() => setActiveVehicle(vehicle)}>車両を開く →</button>}
      </article>
    );
  }

  function section(title: string, items: typeof enriched, period: "morning" | "afternoon") {
    const deliveries = items.filter(({ entry }) => entry.entry_type === "delivery");
    const arrivals = items.filter(({ entry }) => entry.entry_type !== "delivery");
    return (
      <section className="card">
        <div className="sectionTitle">
          <h2>{title}</h2>
          <span>{items.length}件</span>
        </div>
        <div className="columns">
          <div>
            <h3>納車予定</h3>
            {!deliveries.length && <div className="empty">予定なし</div>}
            {deliveries.map(renderCard)}
          </div>
          <div>
            <h3>引き取り・来社・出張</h3>
            {!arrivals.length && <div className="empty">予定なし</div>}
            {arrivals.map(renderCard)}
          </div>
        </div>
        <div className="printPeriod">{period === "morning" ? "午前" : "午後"}</div>
      </section>
    );
  }

  const morningCount = morning.length;
  const afternoonCount = afternoon.length;
  const vehicleInspectionMorning = morning.filter(({ work, entry }) => work?.reason === "車検" && entry.entry_type !== "delivery").length;

  return (
    <main className="page">
      <header className="top noPrint">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <strong>icb</strong>
      </header>

      <section className="card hero">
        <div>
          <div className="eyebrow">1日のスケジュール</div>
          <h1>{dateLabel(day)}</h1>
          <div className="notice">{busy ? "予定を読み込み中…" : message}</div>
        </div>
        <div className="summary">
          <div><small>午前</small><b>{morningCount}</b></div>
          <div><small>午後</small><b>{afternoonCount}</b></div>
          <div><small>午前車検</small><b>{vehicleInspectionMorning}</b><small>/ 4台目安</small></div>
        </div>
      </section>

      <div className="dateNav noPrint">
        <button onClick={() => setDay(addDay(day, -1))}>← 前日</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button onClick={() => setDay(localDateString())}>今日</button>
        <button onClick={() => setDay(addDay(day, 1))}>翌日 →</button>
        <button className="print" onClick={() => window.print()}>🖨 1日予定を印刷</button>
      </div>

      {section("午前", morning, "morning")}
      {section("午後", afternoon, "afternoon")}

      <section className="card noPrint">
        <h2>次の機能へ</h2>
        <div className="quick">
          <button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>
          <button onClick={() => location.assign("/vehicle-workflow")}>車検証・車両登録</button>
          <button onClick={() => location.assign("/ocr/auto")}>部品伝票OCR</button>
          <button onClick={() => location.assign("/parts-data")}>部品データ</button>
        </div>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}
        body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button,input{font:inherit}
        button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:10px 13px;font-weight:800}
        .page{max-width:1100px;margin:0 auto;padding:18px 14px 60px}
        .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
        .card{position:relative;background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}
        .hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
        .eyebrow{font-weight:800;color:#2674e8}
        h1{font-size:32px;margin:5px 0 8px}
        h2{margin:0}
        h3{margin:0 0 10px;color:#5d6878;font-size:16px}
        .notice{color:#5d6878}
        .summary{display:flex;gap:9px;flex-wrap:wrap}
        .summary>div{min-width:92px;background:#f7f9fc;border-radius:14px;padding:11px 13px;display:grid}
        .summary b{font-size:25px}
        .summary small{color:#718096}
        .dateNav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
        .dateNav input{border:1px solid #ccd7e5;border-radius:12px;padding:10px 12px;background:#fff}
        .dateNav .print{margin-left:auto;background:#2f6fe4;color:#fff;border-color:#2f6fe4}
        .sectionTitle{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}
        .columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .scheduleItem{border:1px solid #dbe3ee;border-radius:15px;padding:14px;margin-bottom:9px;break-inside:avoid}
        .scheduleItem.done{opacity:.62;background:#f5f7f9}
        .itemTop{display:flex;justify-content:space-between;gap:10px}
        .customer{font-size:19px;font-weight:800;margin-top:4px}
        .complete{min-width:70px}
        .complete.active{background:#e9f7ef;border-color:#aad6b9;color:#237443}
        .meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .meta span{background:#f2f6fb;border-radius:999px;padding:5px 9px;font-size:13px}
        .sub,.note{margin-top:9px;color:#5d6878}
        .note{background:#fff9e8;padding:8px 10px;border-radius:9px}
        .open{margin-top:10px}
        .empty{padding:17px;background:#f8fafc;color:#8793a5;border-radius:12px;text-align:center}
        .quick{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:14px}
        .printPeriod{display:none}
        @media(max-width:720px){
          .hero{display:block}.summary{margin-top:12px}.columns{grid-template-columns:1fr}
          .quick{grid-template-columns:1fr 1fr}.dateNav .print{margin-left:0}
        }
        @media print{
          body{background:#fff}
          .page{max-width:none;padding:0}
          .noPrint{display:none!important}
          .card{border:0;border-radius:0;padding:10mm 8mm;margin:0;box-shadow:none}
          .hero{display:block;padding-bottom:4mm;border-bottom:1px solid #aaa}
          .hero .summary{display:none}
          .columns{grid-template-columns:1fr 1fr;gap:8mm}
          .scheduleItem{border:1px solid #777;padding:3mm;margin-bottom:2.5mm}
          .complete,.open{display:none}
          .printPeriod{display:block;position:absolute;right:8mm;top:10mm;font-weight:800;color:#666}
          h1{font-size:20pt}
        }
      `}</style>
    </main>
  );
}
