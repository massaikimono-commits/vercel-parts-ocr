/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { dailyReportTimeLabel, prepareDailyReportSection } from "./print-rules";

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
  vehicle_id: string;
  reason: "点検" | "車検" | "一般整備" | "板金塗装";
  status: string;
  worker_name: string | null;
  expected_completion_date: string | null;
  delivery_completed: boolean;
  work_completed: boolean;
  scheduled_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  planned_delivery_at: string | null;
  is_urgent: boolean;
  needs_loaner: boolean;
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

type ColumnLayout = "delivery-left" | "delivery-right";
type CompletionPosition = "name" | "meta";

const ENTRY_LABEL: Record<ScheduleEntry["entry_type"], string> = {
  delivery: "納車",
  pickup: "引き取り",
  customer_visit: "来社",
  onsite_repair: "出張整備",
};

const LAYOUT_KEY = "icb-schedule-column-layout";
const LAYOUT_SETTING_KEY = "schedule_layout";

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
  return dailyReportTimeLabel(entry);
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
  const [columnLayout, setColumnLayout] = useState<ColumnLayout>("delivery-left");
  const [completionPosition, setCompletionPosition] = useState<CompletionPosition>("name");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("当日の入出庫予定を読み込みます。");

  useEffect(() => {
    void loadLayout();
  }, []);

  async function loadLayout() {
    try {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_value")
        .eq("setting_key", LAYOUT_SETTING_KEY)
        .maybeSingle();
      const value = data?.setting_value || {};
      if (value.columnLayout === "delivery-left" || value.columnLayout === "delivery-right") {
        setColumnLayout(value.columnLayout);
      } else {
        const saved = localStorage.getItem(LAYOUT_KEY);
        if (saved === "delivery-left" || saved === "delivery-right") setColumnLayout(saved);
      }
      if (value.completionPosition === "name" || value.completionPosition === "meta") {
        setCompletionPosition(value.completionPosition);
      }
    } catch {}
  }

  async function saveLayout(nextColumn: ColumnLayout, nextCompletion: CompletionPosition) {
    setColumnLayout(nextColumn);
    setCompletionPosition(nextCompletion);
    try { localStorage.setItem(LAYOUT_KEY, nextColumn); } catch {}
    const { error } = await supabase.from("app_settings").upsert({
      setting_key: LAYOUT_SETTING_KEY,
      setting_value: {
        columnLayout: nextColumn,
        completionPosition: nextCompletion,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "setting_key" });
    if (error) setMessage("表示設定の保存エラー: " + error.message);
  }

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q !== day) {
      setDay(q);
      return;
    }
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
          .select("id,vehicle_id,reason,status,worker_name,expected_completion_date,delivery_completed,work_completed,scheduled_at,checked_in_at,checked_out_at,planned_delivery_at,is_urgent,needs_loaner")
          .neq("status", "cancelled"),
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

  const stayingVehicles = useMemo(() => {
    const endOfDay = new Date(`${day}T23:59:59+09:00`).getTime();
    return workOrders
      .filter((work) => {
        if (work.work_completed || work.checked_out_at || work.status === "completed") return false;
        const activelyCheckedIn = Boolean(work.checked_in_at);
        const inProgress = work.status === "in_progress";
        if (!activelyCheckedIn && !inProgress) return false;
        const base = work.checked_in_at || work.scheduled_at;
        return !base || new Date(base).getTime() <= endOfDay;
      })
      .map((work) => {
        const vehicle = vehicleMap.get(work.vehicle_id) || null;
        const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
        return { work, vehicle, customer };
      })
      .sort((a, b) => {
        if (a.work.is_urgent !== b.work.is_urgent) return a.work.is_urgent ? -1 : 1;
        const ad = a.work.expected_completion_date || "9999-12-31";
        const bd = b.work.expected_completion_date || "9999-12-31";
        return ad.localeCompare(bd);
      });
  }, [workOrders, vehicleMap, customerMap, day]);

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

  async function toggleWorkCompleted(work: WorkOrder) {
    const next = !work.work_completed;
    try {
      const rpc = next ? "complete_work_order_one_tap" : "reopen_work_order";
      const { data, error } = await supabase.rpc(rpc, { p_work_order_id: work.id, p_actor: "schedule" });
      if (error) throw error;
      setWorkOrders((old) => old.map((x) => x.id === work.id ? {
        ...x,
        work_completed: next,
        status: data?.status || (next ? "completed" : "scheduled"),
      } : x));
      setMessage(next ? "作業完了を○で表示しました。" : "作業完了を解除しました。");
    } catch (error: any) {
      setMessage(`作業状態の保存エラー: ${error?.message || error}`);
    }
  }

  async function toggleWorkProgress(work: WorkOrder) {
    if (work.work_completed || work.status === "completed") return;
    const nextStatus = work.status === "in_progress" ? "scheduled" : "in_progress";
    try {
      const { data, error } = await supabase.rpc("set_work_order_progress_state", {
        p_work_order_id: work.id,
        p_state: nextStatus,
        p_actor: "schedule",
      });
      if (error) throw error;
      setWorkOrders((old) => old.map((x) => x.id === work.id ? {
        ...x,
        status: data?.status || nextStatus,
      } : x));
      setMessage(nextStatus === "in_progress" ? "作業中にしました。" : "作業未実施へ戻しました。");
    } catch (error: any) {
      setMessage(`作業状態の保存エラー: ${error?.message || error}`);
    }
  }

  function changeColumnLayout(next: ColumnLayout) {
    void saveLayout(next, completionPosition);
  }

  function changeCompletionPosition(next: CompletionPosition) {
    void saveLayout(columnLayout, next);
  }

  function customerLabel(customer: Customer | null) {
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
  }

  function last4Label(vehicle: Vehicle | null) {
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "----";
  }

  function workFlags(work: WorkOrder | null) {
    if (!work) return null;
    return (
      <div className="flags">
        {work.is_urgent && <span className="flag urgent">急ぎ</span>}
        {work.needs_loaner && <span className="flag loaner">代車あり</span>}
      </div>
    );
  }

  function workStateControl(work: WorkOrder | null) {
    if (!work) return null;
    if (work.work_completed || work.status === "completed") {
      return (
        <>
          <button className="workCircle active noPrint" onClick={() => void toggleWorkCompleted(work)} aria-label="作業完了を解除">○</button>
          <span className="printWorkCircle">○</span>
        </>
      );
    }
    const running = work.status === "in_progress";
    return (
      <>
        <button
          className={running ? "workState running noPrint" : "workState pending noPrint"}
          onClick={() => void toggleWorkProgress(work)}
          aria-label={running ? "作業未実施へ戻す" : "作業中にする"}
        >
          {running ? "作業中" : "作業未実施"}
        </button>
        <span className={running ? "printWorkState running" : "printWorkState pending"}>
          {running ? "作業中" : "作業未実施"}
        </span>
      </>
    );
  }

  function renderStayingVehicle(item: typeof stayingVehicles[number]) {
    const { work, vehicle, customer } = item;
    return (
      <article key={work.id} className={`stayItem ${work.is_urgent ? "urgentItem" : ""}`}>
        <div className="itemTop">
          <div>
            <div className="customerRow"><b>{customerLabel(customer)}</b>{workFlags(work)}</div>
            <div className="sub">下4桁 {last4Label(vehicle)}　{work.reason}</div>
          </div>
          <div className="workStateSlot">{workStateControl(work)}</div>
        </div>
        <div className="meta">
          {work.worker_name && <span>担当 {work.worker_name}</span>}
          <span>完成予定 {work.expected_completion_date || "未定"}</span>
          {work.planned_delivery_at && <span>納車予定あり</span>}
        </div>
        {(vehicle?.maker || vehicle?.model) && <div className="sub">{[vehicle?.maker, vehicle?.model].filter(Boolean).join(" / ")}</div>}
        {vehicle && <button className="open noPrint" onClick={() => setActiveVehicle(vehicle)}>車両を開く →</button>}
      </article>
    );
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
    const isDelivery = entry.entry_type === "delivery";
    return (
      <article key={entry.id} className={`scheduleItem ${!isDelivery && entry.completed ? "done" : ""} ${work?.is_urgent ? "urgentItem" : ""}`}>
        <div className="itemTop">
          <div className="itemMain">
            <b>{timeLabel(entry)}　{ENTRY_LABEL[entry.entry_type]}</b>
            <div className="customerRow">
              <div className="customer">{customerLabel(customer)}</div>
              {completionPosition === "name" && <div className="workStateSlot">{workStateControl(work)}</div>}
              {workFlags(work)}
            </div>
          </div>
          {!isDelivery && (
            <button className={entry.completed ? "complete active noPrint" : "complete noPrint"} onClick={() => void toggleCompleted(entry)} aria-label="入出庫予定完了切替">
              {entry.completed ? "✓ 完了" : "完了"}
            </button>
          )}
        </div>
        <div className="meta">
          <span>下4桁 <b>{last4Label(vehicle)}</b></span>
          <span>{work?.reason || "入庫要因未設定"}</span>
          {work?.worker_name && <span>担当 {work.worker_name}</span>}
          {work?.expected_completion_date && <span>完成予定 {work.expected_completion_date}</span>}
          {completionPosition === "meta" && <div className="workStateSlot">{workStateControl(work)}</div>}
        </div>
        {(vehicle?.maker || vehicle?.model) && <div className="sub">{[vehicle?.maker, vehicle?.model].filter(Boolean).join(" / ")}</div>}
        {entry.notes && <div className="note">{entry.notes}</div>}
        {vehicle && <button className="open noPrint" onClick={() => setActiveVehicle(vehicle)}>車両を開く →</button>}
      </article>
    );
  }

  function section(title: string, items: typeof enriched, period: "morning" | "afternoon") {
    const itemMap = new Map(items.map((item) => [item.entry.id, item]));
    const prepared = prepareDailyReportSection(items.map(({ entry }) => entry), period);
    const deliveries = prepared.deliveries.map((entry) => itemMap.get(entry.id)).filter(Boolean) as typeof enriched;
    const arrivals = prepared.inbound.map((entry) => itemMap.get(entry.id)).filter(Boolean) as typeof enriched;
    const deliveryColumn = <div key="delivery"><h3>納車予定</h3>{!deliveries.length && <div className="empty">予定なし</div>}{deliveries.map(renderCard)}</div>;
    const arrivalColumn = <div key="arrivals"><h3>引き取り・来社・出張</h3>{!arrivals.length && <div className="empty">予定なし</div>}{arrivals.map(renderCard)}</div>;
    const columns = columnLayout === "delivery-left" ? [deliveryColumn, arrivalColumn] : [arrivalColumn, deliveryColumn];
    return (
      <section className={`card periodSection ${period === "afternoon" ? "afternoonSection" : "morningSection"}`}>
        <div className="sectionTitle"><h2>{title}</h2><span>{items.length}件</span></div>
        <div className="columns">{columns}</div>
        <div className="printPeriod">{period === "morning" ? "午前" : "午後"}</div>
      </section>
    );
  }

  const morningCount = morning.length;
  const afternoonCount = afternoon.length;
  const vehicleInspectionMorning = morning.filter(({ work, entry }) => work?.reason === "車検" && entry.entry_type !== "delivery").length;

  return (
    <main className="page">
      <header className="top noPrint"><button onClick={() => location.assign("/")}>← メインへ</button><strong>icb</strong></header>

      <section className="card hero">
        <div><div className="eyebrow">1日のスケジュール</div><h1>{dateLabel(day)}</h1><div className="notice">{busy ? "予定を読み込み中…" : message}</div></div>
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
        <button className="newEntry" onClick={() => location.assign(`/schedule/new?day=${day}`)}>＋ 予定を登録</button>
        <label className="layoutControl">配置<select value={columnLayout} onChange={(e) => changeColumnLayout(e.target.value as ColumnLayout)}><option value="delivery-left">納車を左</option><option value="delivery-right">納車を右</option></select></label>
        <label className="layoutControl">作業○<select value={completionPosition} onChange={(e) => changeCompletionPosition(e.target.value as CompletionPosition)}><option value="name">名前の横</option><option value="meta">詳細欄</option></select></label>
        <button className="print" onClick={() => window.print()}>🖨 1日予定を印刷</button>
      </div>

      {section("午前", morning, "morning")}
      {section("午後", afternoon, "afternoon")}

      <section className="card staySection">
        <div className="sectionTitle"><h2>滞留車両</h2><span>{stayingVehicles.length}台</span></div>
        {!stayingVehicles.length && <div className="empty">現在の滞留車両はありません。</div>}
        <div className="stayGrid">{stayingVehicles.map(renderStayingVehicle)}</div>
      </section>

      <section className="card noPrint">
        <h2>次の機能へ</h2>
        <div className="quick">
          <button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>
          <button onClick={() => location.assign("/vehicle-workflow")}>車検証・車両登録</button>
          <button onClick={() => location.assign("/ocr/auto")}>部品伝票OCR</button>
          <button onClick={() => location.assign("/parts-data")}>部品データ</button>
          <button onClick={() => location.assign("/settings/staff")}>社員名管理</button>
        </div>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:10px 13px;font-weight:800}.page{max-width:1100px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.card{position:relative;background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}.hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.eyebrow{font-weight:800;color:#2674e8}h1{font-size:32px;margin:5px 0 8px}h2{margin:0}h3{margin:0 0 10px;color:#5d6878;font-size:16px}.notice{color:#5d6878}.summary{display:flex;gap:9px;flex-wrap:wrap}.summary>div{min-width:92px;background:#f7f9fc;border-radius:14px;padding:11px 13px;display:grid}.summary b{font-size:25px}.summary small{color:#718096}.dateNav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px;align-items:center}.dateNav input,.layoutControl select{border:1px solid #ccd7e5;border-radius:12px;padding:10px 12px;background:#fff}.dateNav .newEntry{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.dateNav .print{margin-left:auto}.layoutControl{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:800;color:#5d6878}.sectionTitle{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.scheduleItem{border:1px solid #dbe3ee;border-radius:15px;padding:14px;margin-bottom:9px;break-inside:avoid}.scheduleItem.done{opacity:.62;background:#f5f7f9}.urgentItem{border-color:#e6aa5a;box-shadow:inset 4px 0 0 #e6aa5a}.itemTop{display:flex;justify-content:space-between;gap:10px}.itemMain{min-width:0}.customerRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.customer{font-size:19px;font-weight:800;margin-top:4px}.complete{min-width:70px}.complete.active{background:#e9f7ef;border-color:#aad6b9;color:#237443}.workStateSlot{display:inline-flex;align-items:center;gap:6px}.workState{border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;white-space:nowrap}.workState.pending{background:#f0f2f5;border-color:#cdd4dd;color:#657180}.workState.running{background:#fff0d8;border-color:#e7b465;color:#9a5d00}.workCircle{width:34px;height:34px;padding:0;border-radius:50%;font-size:13px;flex:0 0 auto}.workCircle.active{background:#e9f7ef;border-color:#78bc8e;color:#176b37;font-size:23px}.printWorkCircle,.printWorkState{display:none;font-weight:900}.printWorkCircle{font-size:22px}.printWorkState{font-size:11px}.printWorkState.running{color:#7c4d00}.printWorkState.pending{color:#667180}.flags{display:flex;gap:5px;flex-wrap:wrap}.flag{border-radius:999px;padding:4px 8px;font-size:12px;font-weight:900}.flag.urgent{background:#fff0db;color:#995b00}.flag.loaner{background:#eaf3ff;color:#245ca8}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.meta span{background:#f2f6fb;border-radius:999px;padding:5px 9px;font-size:13px}.sub,.note{margin-top:9px;color:#5d6878}.note{background:#fff9e8;padding:8px 10px;border-radius:9px}.open{margin-top:10px}.empty{padding:17px;background:#f8fafc;color:#8793a5;border-radius:12px;text-align:center}.quick{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-top:14px}.stayGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stayItem{border:1px solid #dbe3ee;border-radius:15px;padding:14px;break-inside:avoid}.printPeriod{display:none}@media(max-width:720px){.hero{display:block}.summary{margin-top:12px}.columns,.stayGrid{grid-template-columns:1fr}.quick{grid-template-columns:1fr 1fr}.dateNav .print{margin-left:0}}@media print{body{background:#fff}.page{max-width:none;padding:0}.noPrint{display:none!important}.card{border:0;border-radius:0;padding:10mm 8mm;margin:0;box-shadow:none}.hero{display:block;padding-bottom:4mm;border-bottom:1px solid #aaa}.hero .summary{display:none}.columns{grid-template-columns:1fr 1fr;gap:8mm}.scheduleItem{border:1px solid #777;padding:3mm;margin-bottom:2.5mm}.printWorkCircle,.printWorkState{display:inline}.printPeriod{display:block;position:absolute;right:8mm;top:10mm;font-weight:800;color:#666}.afternoonSection .columns>div{display:flex;flex-direction:column;justify-content:flex-end}.afternoonSection .scheduleItem{flex:0 0 auto}h1{font-size:20pt}}
      `}</style>
    </main>
  );
}
