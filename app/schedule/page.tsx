/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { dailyReportTimeLabel, prepareDailyReportSection } from "./print-rules";
import { safeActionError } from "../lib/client-security";

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
  outsource_vendor_name: string | null;
  expected_completion_date: string | null;
  delivery_completed: boolean;
  work_completed: boolean;
  work_completed_at: string | null;
  scheduled_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  planned_delivery_at: string | null;
  planned_delivery_date: string | null;
  stay_reason: string | null;
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
  pickup: "",
  customer_visit: "来社",
  onsite_repair: "出張",
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

function stayDayCount(start: string | null, day: string) {
  if (!start) return null;
  const s = new Date(start);
  const e = new Date(`${day}T23:59:59+09:00`);
  const diff = Math.floor((e.getTime() - s.getTime()) / 86400000);
  return Math.max(1, diff + 1);
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
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState("当日の入出庫予定を読み込みます。");
  const [focusWorkId, setFocusWorkId] = useState("");

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
    if (error) setMessage(safeActionError("表示設定の保存", error));
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get("day");
    setFocusWorkId(params.get("focus") || "");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDay(q);
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void load();
  }, [initialized, day]);

  useEffect(() => {
    if (busy || !focusWorkId) return;
    const target = document.querySelector<HTMLElement>(`[data-work-id="${focusWorkId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [busy, focusWorkId, entries]);

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
          .select("id,vehicle_id,reason,status,worker_name,outsource_vendor_name,expected_completion_date,delivery_completed,work_completed,work_completed_at,scheduled_at,checked_in_at,checked_out_at,planned_delivery_at,planned_delivery_date,stay_reason,is_urgent,needs_loaner")
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
      setMessage(safeActionError("予定の読み込み", error));
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

  const workload = useMemo(() => {
    const map = new Map<string, { name: string; unfinished: number; running: number; urgent: number }>();
    for (const work of workOrders) {
      if (work.checked_out_at || work.work_completed || work.status === "completed" || work.status === "cancelled") continue;
      const name = work.worker_name?.trim() || "担当未設定";
      const row = map.get(name) || { name, unfinished: 0, running: 0, urgent: 0 };
      row.unfinished += 1;
      if (work.status === "in_progress") row.running += 1;
      if (work.is_urgent) row.urgent += 1;
      map.set(name, row);
    }
    return [...map.values()].sort((a,b) => {
      if (a.name === "担当未設定") return 1;
      if (b.name === "担当未設定") return -1;
      return b.unfinished - a.unfinished || a.name.localeCompare(b.name, "ja");
    });
  }, [workOrders]);

  const stayingVehicles = useMemo(() => {
    const endOfDay = new Date(`${day}T23:59:59+09:00`).getTime();
    return workOrders
      .filter((work) => {
        const checkedOutAt = work.checked_out_at ? new Date(work.checked_out_at).getTime() : null;
        if (checkedOutAt !== null && checkedOutAt <= endOfDay) return false;

        const completedAt = work.work_completed_at ? new Date(work.work_completed_at).getTime() : null;
        const isHistoricalDay = endOfDay < Date.now();
        const legacyLaterCheckout = isHistoricalDay && checkedOutAt !== null && checkedOutAt > endOfDay;
        const completedByDayEnd = completedAt !== null
          ? completedAt <= endOfDay
          : (work.work_completed || work.status === "completed") && !legacyLaterCheckout;
        if (completedByDayEnd) return false;

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
      setMessage(safeActionError("完了状態の保存", error));
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
      setMessage(next ? "作業完了にしました。" : "作業完了を解除しました。");
    } catch (error: any) {
      setMessage(safeActionError("作業状態の保存", error));
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
      setMessage(safeActionError("作業状態の保存", error));
    }
  }

  async function advanceWorkState(work: WorkOrder) {
    if (work.work_completed || work.status === "completed") {
      await toggleWorkCompleted(work);
      return;
    }
    if (work.status === "in_progress") {
      await toggleWorkCompleted(work);
      return;
    }
    await toggleWorkProgress(work);
  }

  async function saveStayInfo(event: React.FormEvent<HTMLFormElement>, work: WorkOrder) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stayReason = String(form.get("stay_reason") || "").trim();
    const plannedDeliveryDate = String(form.get("planned_delivery_date") || "").trim() || null;
    try {
      const { data, error } = await supabase.rpc("set_work_order_stay_info", {
        p_work_order_id: work.id,
        p_stay_reason: stayReason || null,
        p_planned_delivery_date: plannedDeliveryDate,
        p_actor: "schedule",
      });
      if (error) throw error;
      setWorkOrders((old) => old.map((x) => x.id === work.id ? {
        ...x,
        stay_reason: data?.stayReason || null,
        planned_delivery_date: data?.plannedDeliveryDate || null,
      } : x));
      setMessage("滞留理由・納車予定日を保存しました。");
    } catch (error: any) {
      setMessage(safeActionError("滞留情報の保存", error));
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
    const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || "";
    if (!raw) return "----";
    return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
  }

  function reasonClassName(work: WorkOrder | null) {
    if (!work) return "reason-none";
    if (work.reason === "車検") return "reason-shaken";
    if (work.reason === "点検") return "reason-check";
    if (work.reason === "一般整備") return work.outsource_vendor_name ? "reason-body" : "reason-repair";
    if (work.reason === "板金塗装") return "reason-body";
    return "reason-none";
  }

  function openVehicleFromCard(event: React.MouseEvent<HTMLElement>, vehicle: Vehicle | null) {
    if (!vehicle) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input,select,textarea,summary,details,form,label,a")) return;
    setActiveVehicle(vehicle);
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
    const completed = work.work_completed || work.status === "completed";
    const running = !completed && work.status === "in_progress";
    const state = completed ? "completed" : running ? "running" : "pending";
    const label = completed ? "作業完了" : running ? "作業中" : "作業未実施";
    const nextLabel = completed ? "作業未実施へ戻す" : running ? "作業完了にする" : "作業中にする";
    return (
      <>
        <button
          className={`workState ${state} noPrint`}
          onClick={() => void advanceWorkState(work)}
          aria-label={nextLabel}
          title={`${label} → ${nextLabel}`}
        >
          {label}
        </button>
        <span className={`printWorkState ${state}`}>{label}</span>
      </>
    );
  }

  function renderStayingVehicle(item: typeof stayingVehicles[number]) {
    const { work, vehicle, customer } = item;
    return (
      <article
        key={work.id}
        data-work-id={work.id}
        className={`stayItem ${reasonClassName(work)} ${work.is_urgent ? "urgentItem" : ""} ${focusWorkId === work.id ? "focusedWork" : ""}`}
        onClick={(event) => openVehicleFromCard(event, vehicle)}
      >
        <div className="itemTop">
          <div>
            <div className="customerRow"><b>{customerLabel(customer)}</b>{workFlags(work)}</div>
            <div className="sub">{last4Label(vehicle)}　{work.reason}</div>
          </div>
          <div className="workStateSlot">{workStateControl(work)}</div>
        </div>
        <div className="stayInfo">
          <div className="stayReason"><b>滞留理由</b><span>{work.stay_reason || "未登録"}</span></div>
          <div className="stayDelivery"><b>納車予定日</b><span>{work.planned_delivery_date || "未定"}</span></div>
          {work.worker_name && <div className="stayReason"><b>作業担当</b><span>{work.worker_name}</span></div>}
          {work.outsource_vendor_name && <div className="stayDelivery"><b>外注先</b><span>{work.outsource_vendor_name}</span></div>}
        </div>
        <div className="meta">
          {work.worker_name && <span>担当 {work.worker_name}</span>}
          <span className={stayDayCount(work.checked_in_at || work.scheduled_at, day) && (stayDayCount(work.checked_in_at || work.scheduled_at, day) || 0) >= 3 ? "stayAge alert" : "stayAge"}>
            入庫 {stayDayCount(work.checked_in_at || work.scheduled_at, day) || 1}日目
          </span>
          <span>完成予定 {work.expected_completion_date || "未定"}</span>
        </div>
        {(vehicle?.maker || vehicle?.model) && <div className="sub">{[vehicle?.maker, vehicle?.model].filter(Boolean).join(" / ")}</div>}
        <details className="stayEdit noPrint">
          <summary>滞留情報を編集</summary>
          <form onSubmit={(e) => void saveStayInfo(e, work)}>
            <label>滞留理由
              <input name="stay_reason" defaultValue={work.stay_reason || ""} list="stay-reason-options" placeholder="例：部品待ち" />
            </label>
            <label>納車予定日
              <input name="planned_delivery_date" type="date" defaultValue={work.planned_delivery_date || ""} />
            </label>
            <button type="submit">保存</button>
          </form>
        </details>
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
    const visitLabel = entry.entry_type === "customer_visit" || entry.entry_type === "onsite_repair"
      ? ENTRY_LABEL[entry.entry_type]
      : "";
    return (
      <article
        key={entry.id}
        data-work-id={work?.id || undefined}
        className={`scheduleItem ${reasonClassName(work)} ${!isDelivery && entry.completed ? "done" : ""} ${work?.is_urgent ? "urgentItem" : ""} ${work && focusWorkId === work.id ? "focusedWork" : ""}`}
        onClick={(event) => openVehicleFromCard(event, vehicle)}
      >
        <div className="itemTop">
          <div className="itemMain">
            <div className="customerRow">
              <div className="customer">{customerLabel(customer)}</div>
              {completionPosition === "name" && <div className="workStateSlot">{workStateControl(work)}</div>}
              {workFlags(work)}
            </div>
            <div className="scheduleIdentityRow">
              <div className="scheduleVehicle">
                <b>{last4Label(vehicle)}</b>
                <small>{work?.reason || "入庫要因未設定"}</small>
              </div>
              <div className="scheduleTime">
                {visitLabel && <span>{visitLabel}</span>}
                <b>{timeLabel(entry)}</b>
              </div>
            </div>
          </div>
        </div>
        <div className="meta">
          {work?.worker_name && <span>担当 {work.worker_name}</span>}
          {work?.outsource_vendor_name && <span>外注 {work.outsource_vendor_name}</span>}
          {work?.expected_completion_date && <span>完成予定 {work.expected_completion_date}</span>}
          {completionPosition === "meta" && <div className="workStateSlot">{workStateControl(work)}</div>}
        </div>
        {(vehicle?.maker || vehicle?.model) && <div className="sub">{[vehicle?.maker, vehicle?.model].filter(Boolean).join(" / ")}</div>}
        {entry.notes && <div className="note">{entry.notes}</div>}
      </article>
    );
  }

  function section(title: string, items: typeof enriched, period: "morning" | "afternoon") {
    const itemMap = new Map(items.map((item) => [item.entry.id, item]));
    const prepared = prepareDailyReportSection(items.map(({ entry }) => entry), period);
    const deliveries = prepared.deliveries.map((entry) => itemMap.get(entry.id)).filter(Boolean) as typeof enriched;
    const arrivals = prepared.inbound.map((entry) => itemMap.get(entry.id)).filter(Boolean) as typeof enriched;
    const deliveryColumn = <div key="delivery" className="deliveryColumn"><h3>納車予定</h3>{!deliveries.length && <div className="empty">予定なし</div>}{deliveries.map(renderCard)}</div>;
    const arrivalColumn = <div key="arrivals" className="inboundColumn"><h3>入庫予定</h3>{!arrivals.length && <div className="empty">予定なし</div>}{arrivals.map(renderCard)}</div>;
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
      <datalist id="stay-reason-options">
        <option value="部品待ち" />
        <option value="外注作業待ち" />
        <option value="お客様連絡待ち" />
        <option value="見積了承待ち" />
        <option value="保険会社連絡待ち" />
      </datalist>
      <header className="top noPrint"><button onClick={() => location.assign("/")}>← メインへ</button><strong>icb</strong></header>

      <section className="card hero">
        <div><div className="eyebrow">1日の予定</div><h1>{dateLabel(day)}</h1><div className="notice">{busy ? "予定を読み込み中…" : message}</div></div>
        <div className="summary">
          <div><small>午前</small><b>{morningCount}</b></div>
          <div><small>午後</small><b>{afternoonCount}</b></div>
          <div><small>午前車検</small><b>{vehicleInspectionMorning}</b><small>/ 4台目安</small></div>
        </div>
      </section>

      <div className="dateNav noPrint">
        <div className="dayNavRow" aria-label="日付移動">
          <button onClick={() => setDay(addDay(day, -1))}>← 前日</button>
          <button onClick={() => setDay(localDateString())}>今日</button>
          <button onClick={() => setDay(addDay(day, 1))}>明日 →</button>
        </div>
        <input className="datePicker" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button onClick={() => location.assign(`/schedule/week?day=${day}`)}>1週間のスケジュール</button>
        <button onClick={() => location.assign(`/schedule/month?day=${day}`)}>月全体の予定</button>
        <button className="newEntry" onClick={() => location.assign(`/schedule/new?day=${day}`)}>＋ 予定を登録</button>
        <label className="layoutControl">配置<select value={columnLayout} onChange={(e) => changeColumnLayout(e.target.value as ColumnLayout)}><option value="delivery-left">納車を左</option><option value="delivery-right">納車を右</option></select></label>
        <label className="layoutControl">作業状態<select value={completionPosition} onChange={(e) => changeCompletionPosition(e.target.value as CompletionPosition)}><option value="name">名前の横</option><option value="meta">詳細欄</option></select></label>
        <button className="print" onClick={() => location.assign(`/schedule/print?day=${day}`)}>🖨 日報プレビュー</button>
      </div>

      {section("午前", morning, "morning")}
      {section("午後", afternoon, "afternoon")}

      <section className="card staySection">
        <div className="sectionTitle"><h2>滞留車両</h2><span>{stayingVehicles.length}台</span></div>
        {!stayingVehicles.length && <div className="empty">現在の滞留車両はありません。</div>}
        <div className="stayGrid">{stayingVehicles.map(renderStayingVehicle)}</div>
      </section>

      <section className="card workloadSection noPrint">
        <div className="sectionTitle"><h2>作業担当の負荷</h2><span>{workload.reduce((sum,x)=>sum+x.unfinished,0)}台</span></div>
        {!workload.length && <div className="empty">未完了の担当車両はありません。</div>}
        <div className="workloadGrid">
          {workload.map((row) => (
            <button
              className={`workloadCard ${row.name === "担当未設定" ? "unassigned" : ""}`}
              key={row.name}
              onClick={() => location.assign("/schedule/workload?worker=" + encodeURIComponent(row.name) + "&filter=unfinished")}
            >
              <b>{row.name}</b>
              <span>未完了 <strong>{row.unfinished}</strong>台</span>
              <span>作業中 <strong>{row.running}</strong>台</span>
              {row.urgent > 0 && <em>急ぎ {row.urgent}台</em>}
            </button>
          ))}
        </div>
      </section>

      <section className="card noPrint">
        <h2>次の機能へ</h2>
        <div className="quick">
          <button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>
          <button onClick={() => location.assign("/vehicle-workflow")}>車検証・車両登録</button>
          <button onClick={() => location.assign("/ocr/auto")}>部品伝票OCR</button>
          <button onClick={() => location.assign("/parts-data")}>部品データ</button>
          <button onClick={() => location.assign("/settings/staff")}>社員名管理</button>
          <button onClick={() => location.assign("/schedule/search")}>予定検索</button>
          <button onClick={() => location.assign("/loaners")}>代車管理</button>
        </div>
      </section>

      <style jsx>{`
        .dayNavRow {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          width: 100%;
        }
        .dayNavRow button {
          min-width: 0;
          white-space: nowrap;
        }
        .datePicker {
          flex: 1 1 220px;
        }
        @media (max-width: 720px) {
          .dayNavRow button {
            padding: 11px 6px;
            font-size: 15px;
          }
          .datePicker {
            flex-basis: 100%;
            width: 100%;
          }
        }
      `}</style>
      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:10px 13px;font-weight:800}.page{max-width:1100px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.card{position:relative;background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}.hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.eyebrow{font-weight:800;color:#2674e8}h1{font-size:32px;margin:5px 0 8px}h2{margin:0}h3{margin:0 0 10px;color:#5d6878;font-size:16px}.notice{color:#5d6878}.summary{display:flex;gap:9px;flex-wrap:wrap}.summary>div{min-width:92px;background:#f7f9fc;border-radius:14px;padding:11px 13px;display:grid}.summary b{font-size:25px}.summary small{color:#718096}.dateNav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px;align-items:center}.dateNav input,.layoutControl select{border:1px solid #ccd7e5;border-radius:12px;padding:10px 12px;background:#fff}.dateNav .newEntry{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.dateNav .print{margin-left:auto}.layoutControl{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:800;color:#5d6878}.sectionTitle{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.scheduleItem{border:1px solid #dbe3ee;border-radius:15px;padding:14px;margin-bottom:9px;break-inside:avoid;cursor:pointer}.scheduleItem.done{opacity:.62}.scheduleItem.reason-shaken,.stayItem.reason-shaken{background:#fff0f0;border-color:#e99a9a}.scheduleItem.reason-check,.stayItem.reason-check{background:#eef5ff;border-color:#9dbce8}.scheduleItem.reason-repair,.stayItem.reason-repair{background:#fff8d8;border-color:#e4cd67}.scheduleItem.reason-body,.stayItem.reason-body{background:#fff;border-color:#cfd8e3}.urgentItem{border-color:#e6aa5a;box-shadow:inset 4px 0 0 #e6aa5a}.itemTop{display:flex;justify-content:space-between;gap:10px}.itemMain{min-width:0;width:100%}.customerRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.customer{font-size:19px;font-weight:800;margin-top:4px}.scheduleIdentityRow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:5px}.scheduleVehicle{display:flex;flex-direction:column;min-width:0}.scheduleVehicle>b{font-size:15px;line-height:1.05}.scheduleVehicle>small{font-size:10px;color:#5d6878;line-height:1.05;margin-top:2px}.scheduleTime{display:flex;align-items:center;gap:5px;white-space:nowrap}.scheduleTime>span{font-size:11px;font-weight:900;color:#5d6878}.scheduleTime>b{font-size:14px}.complete{min-width:88px}.complete.active{background:#e9f7ef;border-color:#aad6b9;color:#237443}.workStateSlot{display:inline-flex;align-items:center;gap:6px}.workState{border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900;white-space:nowrap}.workState.pending{background:#f0f2f5;border-color:#cdd4dd;color:#657180}.workState.running{background:#fff0d8;border-color:#e7b465;color:#9a5d00}.workState.completed{background:#e9f7ef;border-color:#78bc8e;color:#176b37}.printWorkState{display:none;font-weight:900;font-size:11px}.printWorkState.running{color:#7c4d00}.printWorkState.pending{color:#667180}.printWorkState.completed{color:#176b37}.flags{display:flex;gap:5px;flex-wrap:wrap}.flag{border-radius:999px;padding:4px 8px;font-size:12px;font-weight:900}.flag.urgent{background:#fff0db;color:#995b00}.flag.loaner{background:#eaf3ff;color:#245ca8}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.meta span{background:#f2f6fb;border-radius:999px;padding:5px 9px;font-size:13px}.meta .stayAge{background:#eef5ff;color:#315f98;font-weight:800}.meta .stayAge.alert{background:#fff0db;color:#995b00}.workloadGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.workloadCard{border:1px solid #dbe3ee;border-radius:13px;padding:12px;display:grid;gap:4px;background:#fff}.workloadCard>b{font-size:16px}.workloadCard span{font-size:12px;color:#5d6878}.workloadCard strong{font-size:18px;color:#172033}.workloadCard em{font-size:11px;font-style:normal;font-weight:900;color:#995b00;background:#fff0db;border-radius:999px;padding:3px 7px;justify-self:start}.workloadCard.unassigned{border-color:#e6aa5a}.sub,.note{margin-top:9px;color:#5d6878}.note{background:#fff9e8;padding:8px 10px;border-radius:9px}.rowActions{display:flex;gap:7px;flex-wrap:wrap}.open{margin-top:10px}.empty{padding:17px;background:#f8fafc;color:#8793a5;border-radius:12px;text-align:center}.quick{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-top:14px}.stayGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stayItem{border:1px solid #dbe3ee;border-radius:15px;padding:14px;break-inside:avoid;cursor:pointer}.stayInfo{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.stayReason,.stayDelivery{display:grid;gap:3px;border-radius:11px;padding:9px 10px;background:#f7f9fc}.stayReason b,.stayDelivery b{font-size:11px;color:#6c7889}.stayReason span,.stayDelivery span{font-weight:900}.stayReason span{color:#8b5a0a}.stayEdit{margin-top:10px;border-top:1px solid #edf0f4;padding-top:8px}.stayEdit summary{cursor:pointer;color:#2674e8;font-weight:800;font-size:13px}.stayEdit form{display:grid;grid-template-columns:1fr 180px auto;gap:8px;align-items:end;margin-top:8px}.stayEdit label{display:grid;gap:4px;font-size:12px;font-weight:800;color:#5d6878}.stayEdit input{border:1px solid #ccd7e5;border-radius:9px;padding:8px;background:#fff}.printPeriod{display:none}@media screen and (min-width:721px){.page{max-width:1440px;padding:10px 12px 36px}.top{margin-bottom:7px}.card{padding:12px 14px;margin-bottom:8px;border-radius:14px}.hero{gap:10px}.eyebrow{font-size:12px}h1{font-size:24px;margin:2px 0 3px}.notice{font-size:12px}.summary{gap:5px}.summary>div{min-width:70px;padding:6px 8px;border-radius:9px}.summary b{font-size:19px}.dateNav{gap:5px;margin-bottom:8px}.dateNav button,.dateNav input,.layoutControl select{padding:6px 8px;border-radius:8px;font-size:12px}.layoutControl{font-size:11px}.sectionTitle{margin-bottom:6px}.sectionTitle h2{font-size:18px}h3{margin-bottom:4px;font-size:12px}.columns{gap:8px}.scheduleItem{padding:6px 8px;margin-bottom:4px;border-radius:8px}.itemTop{gap:5px;align-items:center}.itemMain{display:block;min-width:0;flex:1}.customerRow{gap:4px;flex-wrap:nowrap;min-width:0}.customer{font-size:14px;line-height:1.1;margin-top:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}.scheduleIdentityRow{margin-top:3px;gap:5px}.scheduleVehicle>b{font-size:11px}.scheduleVehicle>small{font-size:8px}.scheduleTime{gap:3px}.scheduleTime>span{font-size:8px}.scheduleTime>b{font-size:10px}.complete{min-width:58px;padding:4px 6px;border-radius:7px;font-size:10px;line-height:1.1}.workState{padding:2px 5px;font-size:9px}.flags{gap:3px;flex-wrap:nowrap}.flag{padding:2px 5px;font-size:9px}.meta{gap:3px;margin-top:3px}.meta span{padding:2px 5px;font-size:10px;line-height:1.15}.sub{margin-top:2px;font-size:10px;line-height:1.15}.note{margin-top:3px;padding:3px 5px;border-radius:5px;font-size:10px;line-height:1.2}.open{margin-top:3px;padding:2px 6px;border-radius:6px;font-size:10px;line-height:1.15}.empty{padding:7px;font-size:11px}}@media(max-width:720px){.hero{display:block}h1{font-size:24px;margin:3px 0 6px}.summary{margin-top:10px}.periodSection{padding:12px 9px}.periodSection .columns{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px}.periodSection .deliveryColumn{grid-column:1;grid-row:1}.periodSection .inboundColumn{grid-column:2;grid-row:1}.periodSection h3{font-size:11px;line-height:1.2;margin-bottom:5px}.periodSection .scheduleItem{padding:6px 5px;margin-bottom:5px;border-radius:9px}.periodSection .itemTop{gap:4px}.periodSection .itemMain>b{font-size:10px}.periodSection .customerRow{gap:3px}.periodSection .customer{font-size:13px;line-height:1.15;margin-top:2px}.periodSection .complete{min-width:0;padding:4px 5px;font-size:9px;border-radius:7px}.periodSection .workState{padding:2px 4px;font-size:8px}.periodSection .flag{padding:2px 4px;font-size:8px}.periodSection .meta{gap:3px;margin-top:4px}.periodSection .meta span{padding:2px 4px;font-size:9px}.periodSection .sub{margin-top:4px;font-size:9px}.periodSection .note{margin-top:4px;padding:4px;font-size:9px}.periodSection .open{margin-top:4px;padding:3px 5px;font-size:9px}.periodSection .empty{padding:9px 3px;font-size:10px}.stayGrid{grid-template-columns:1fr}.stayInfo{grid-template-columns:1fr}.stayEdit form{grid-template-columns:1fr}.workloadGrid{grid-template-columns:1fr 1fr}.quick{grid-template-columns:1fr 1fr}.dateNav .print{margin-left:0}}@media print{body{background:#fff}.page{max-width:none;padding:0}.noPrint{display:none!important}.card{border:0;border-radius:0;padding:10mm 8mm;margin:0;box-shadow:none}.hero{display:block;padding-bottom:4mm;border-bottom:1px solid #aaa}.hero .summary{display:none}.columns{grid-template-columns:1fr 1fr;gap:8mm}.scheduleItem{border:1px solid #777;padding:3mm;margin-bottom:2.5mm}.printWorkState{display:inline}.printPeriod{display:block;position:absolute;right:8mm;top:10mm;font-weight:800;color:#666}.afternoonSection .columns>div{display:flex;flex-direction:column;justify-content:flex-end}.afternoonSection .scheduleItem{flex:0 0 auto}h1{font-size:20pt}}
      `}</style>
    </main>
  );
}
