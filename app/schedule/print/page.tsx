/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { safeActionError } from "../../lib/client-security";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { buildDailyReportPreviewModel } from "../daily-report-print-model";
import { collectDailyReportMessages } from "../daily-report-secondary-sections";
import { dailyReportTimeLabel } from "../print-rules";
import { dailyReportWorkCode } from "../daily-report-work-code";
import { classifyVehicleBusinessStates, deliveryTimeLabel, type BusinessScheduleEntry, type BusinessVehicleState } from "../business-vehicle-state";

type Entry = {
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

type Vehicle = { id: string; customer_id: string | null; registration_number: string | null; registration_number_last4: string | null };
type Customer = { id: string; name: string; company_name: string | null; schedule_display_name: string | null };
type WorkOrder = {
  id: string;
  vehicle_id: string;
  reason: string;
  inspection_schedule_type: "schedule" | "legal_6m" | "legal_12m" | null;
  worker_name: string | null;
  outsource_vendor_name: string | null;
  expected_completion_date: string | null;
  stay_reason: string | null;
  status: string;
  work_completed: boolean;
  work_completed_at: string | null;
  is_waiting_service: boolean;
};

type PreviewEntry = Entry & {
  customerName: string;
  last4: string;
  reason: string;
  inspectionScheduleType: "schedule" | "legal_6m" | "legal_12m" | null;
  workerName: string;
  outsourceVendorName: string;
  deliveryEntry: BusinessScheduleEntry | null;
  workCompleted: boolean;
  isWaitingService: boolean;
};

type PrintRegion = { x: number; y: number; width: number; height: number };
type FieldAnchor = { x: number; y: number; width: number; height: number; align: "left" | "center" | "right"; vAlign: "top" | "center" | "bottom" };

const LABEL: Record<Entry["entry_type"], string> = {
  delivery: "納車", pickup: "引取", customer_visit: "来社", onsite_repair: "出張",
};

// 原本PDF (1755 x 2482 render) を唯一の帳票座標系とする。
// 各fieldは実際の手書き見本の記入位置に合わせ、generic centerではなく個別anchorを持つ。
const DAILY_REPORT_PRINT_LAYOUT = {
  page: { widthMm: 297, heightMm: 420, sourceWidth: 1755, sourceHeight: 2482 },
  rows: { count: 23, top: 260 / 2482, bottom: 1734 / 2482, groupHeight: 67 / 2482 },
  regions: {
    delivery: { x: 77 / 1755, y: 260 / 2482, width: (876 - 77) / 1755, height: (1801 - 260) / 2482 },
    inbound: { x: 929 / 1755, y: 260 / 2482, width: (1704 - 929) / 1755, height: (1801 - 260) / 2482 },
    messages: { x: 239 / 1755, y: 1802 / 2482, width: (1142 - 239) / 1755, height: (1935 - 1802) / 2482 },
    stayingVehicles: { x: 130 / 1755, y: 2037 / 2482, width: (663 - 130) / 1755, height: (2404 - 2037) / 2482 },
    bodyShopVehicles: { x: 716 / 1755, y: 2037 / 2482, width: (1142 - 716) / 1755, height: (2404 - 2037) / 2482 },
    plannedDeliveries: { x: 1195 / 1755, y: 1836 / 2482, width: (1704 - 1195) / 1755, height: (2404 - 1836) / 2482 },
  },
  fieldAnchors: {
    delivery: {
      customerName: { x: 0.01, y: 0.02, width: 0.315, height: 0.30, align: "left", vAlign: "center" },
      vehicleNo: { x: 0.335, y: 0.02, width: 0.19, height: 0.30, align: "center", vAlign: "center" },
      time: { x: 0.535, y: 0.02, width: 0.19, height: 0.30, align: "center", vAlign: "center" },
      assignee: { x: 0.79, y: 0.34, width: 0.195, height: 0.28, align: "center", vAlign: "center" },
      workCode: { x: 0.36, y: 0.66, width: 0.145, height: 0.28, align: "right", vAlign: "center" },
      progress: { x: 0.79, y: 0.66, width: 0.195, height: 0.28, align: "center", vAlign: "center" },
    },
    inbound: {
      customerName: { x: 0.012, y: 0.02, width: 0.325, height: 0.30, align: "left", vAlign: "center" },
      vehicleNo: { x: 0.35, y: 0.02, width: 0.19, height: 0.30, align: "center", vAlign: "center" },
      time: { x: 0.555, y: 0.02, width: 0.19, height: 0.30, align: "center", vAlign: "center" },
      assignee: { x: 0.555, y: 0.34, width: 0.19, height: 0.28, align: "center", vAlign: "center" },
      visitLabel: { x: 0.35, y: 0.34, width: 0.12, height: 0.28, align: "left", vAlign: "center" },
      workCode: { x: 0.45, y: 0.66, width: 0.085, height: 0.28, align: "right", vAlign: "center" },
      dueDay: { x: 0.805, y: 0.03, width: 0.075, height: 0.28, align: "center", vAlign: "center" },
      dueHour: { x: 0.765, y: 0.66, width: 0.07, height: 0.28, align: "right", vAlign: "center" },
      dueMinute: { x: 0.885, y: 0.66, width: 0.07, height: 0.28, align: "left", vAlign: "center" },
      dueBroad: { x: 0.785, y: 0.66, width: 0.17, height: 0.28, align: "center", vAlign: "center" },
    },
    secondary: {
      messages: { x: 0.005, y: 0.04, width: 0.985, height: 0.90, align: "left", vAlign: "top" },
      stayingAssignee: { x: 0.00, y: 0.00, width: 0.10, height: 1, align: "center", vAlign: "center" },
      stayingCustomer: { x: 0.10, y: 0.00, width: 0.30, height: 1, align: "left", vAlign: "center" },
      stayingVehicle: { x: 0.40, y: 0.00, width: 0.40, height: 1, align: "center", vAlign: "center" },
      stayingInboundDay: { x: 0.80, y: 0.00, width: 0.10, height: 1, align: "center", vAlign: "center" },
      stayingDueDay: { x: 0.90, y: 0.00, width: 0.10, height: 1, align: "center", vAlign: "center" },
      bodyShopVendor: { x: 0.00, y: 0.00, width: 0.125, height: 1, align: "center", vAlign: "center" },
      bodyShopCustomer: { x: 0.125, y: 0.00, width: 0.375, height: 1, align: "left", vAlign: "center" },
      bodyShopVehicle: { x: 0.50, y: 0.00, width: 0.25, height: 1, align: "center", vAlign: "center" },
      bodyShopInboundDay: { x: 0.75, y: 0.00, width: 0.125, height: 1, align: "center", vAlign: "center" },
      bodyShopDueDay: { x: 0.875, y: 0.00, width: 0.125, height: 1, align: "center", vAlign: "center" },
      plannedCustomer: { x: 0.00, y: 0.00, width: 0.418, height: 1, align: "left", vAlign: "center" },
      plannedVehicle: { x: 0.418, y: 0.00, width: 0.322, height: 1, align: "center", vAlign: "center" },
      plannedDue: { x: 0.74, y: 0.00, width: 0.26, height: 1, align: "center", vAlign: "center" },
    },
    reserved: {
      vehicleInspectionCount: { x: 0.11, y: 0.776, width: 0.11, height: 0.025, align: "left", vAlign: "center" },
      workCompletionPlan: { x: 0.28, y: 0.776, width: 0.25, height: 0.025, align: "left", vAlign: "center" },
      reportAssignee: { x: 0.54, y: 0.776, width: 0.16, height: 0.025, align: "center", vAlign: "center" },
    },
  },
  secondaryRows: { stayingVehicles: 11, bodyShopVehicles: 11, plannedDeliveries: 17 },
  date: {
    month: { x: 286 / 1755, y: 72 / 2482, width: 42 / 1755, height: 72 / 2482 },
    day: { x: 407 / 1755, y: 72 / 2482, width: 42 / 1755, height: 72 / 2482 },
    weekday: { x: 520 / 1755, y: 72 / 2482, width: 42 / 1755, height: 72 / 2482 },
  },
} as const;

function jstDay(value = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
function bounds(day: string) { const start = new Date(`${day}T00:00:00+09:00`); return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() }; }
function jstHour(value: string) { return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).format(new Date(value))); }
function shortDay(value: string | null) { if (!value) return ""; const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? String(Number(m[3])) : value; }
function workCompletedOnReportDay(work: WorkOrder, day: string) { const { end } = bounds(day); const endMs = new Date(end).getTime(); if (work.work_completed_at) return new Date(work.work_completed_at).getTime() < endMs; if (endMs < Date.now()) return false; return work.work_completed || work.status === "completed"; }
function exactDueParts(value: string) { const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)); const minute = Number(parts.find((p) => p.type === "minute")?.value || "0"); return { day: String(Number(parts.find((p) => p.type === "day")?.value || "0")), hour: String(Number(parts.find((p) => p.type === "hour")?.value || "0")), minute: minute ? String(minute) : "", broad: "" }; }
function dueParts(entry: PreviewEntry) { const delivery = entry.deliveryEntry; if (!delivery) return { day: "", hour: "", minute: "", broad: "" }; if (delivery.print_time_mode === "unspecified") return { day: shortDay(delivery.starts_at), hour: "", minute: "", broad: "中" }; if (delivery.print_time_mode === "morning") return { day: shortDay(delivery.starts_at), hour: "", minute: "", broad: "A中" }; return exactDueParts(delivery.starts_at); }
function reportDateParts(day: string) { const date = new Date(`${day}T00:00:00+09:00`); return { month: String(Number(day.slice(5, 7))), day: String(Number(day.slice(8, 10))), weekday: new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" }).format(date).replace("曜日", "") }; }
function regionStyle(region: PrintRegion) { return { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }; }
function anchorStyle(anchor: FieldAnchor) { return { left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%`, width: `${anchor.width * 100}%`, height: `${anchor.height * 100}%`, justifyContent: anchor.align === "left" ? "flex-start" : anchor.align === "right" ? "flex-end" : "center", alignItems: anchor.vAlign === "top" ? "flex-start" : anchor.vAlign === "bottom" ? "flex-end" : "center", textAlign: anchor.align } as const; }
function printRowSlots() { const { count, top, bottom } = DAILY_REPORT_PRINT_LAYOUT.rows; const step = count <= 1 ? 0 : (bottom - top) / (count - 1); return Array.from({ length: count }, (_, index) => ({ index, y: top + step * index })); }

export default function DailyReportPrintPage() {
  const [day, setDay] = useState(() => { if (typeof window === "undefined") return jstDay(); const q = new URLSearchParams(location.search).get("day"); return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : jstDay(); });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [stateEntries, setStateEntries] = useState<BusinessScheduleEntry[]>([]);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("日報データを読み込みます。");

  useEffect(() => { void load(); }, [day]);
  async function load() {
    const { start, end } = bounds(day);
    try {
      const [scheduleRes, stateEntryRes, vehicleRes, customerRes, workRes, settingRes] = await Promise.all([
        supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,completed,notes,print_time_mode,print_time_label_override").gte("starts_at", start).lt("starts_at", end),
        supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at,print_time_mode").in("entry_type", ["pickup", "customer_visit", "delivery"]),
        supabase.from("vehicles").select("id,customer_id,registration_number,registration_number_last4"),
        supabase.from("customers").select("id,name,company_name,schedule_display_name"),
        supabase.from("work_orders").select("id,vehicle_id,reason,inspection_schedule_type,worker_name,outsource_vendor_name,expected_completion_date,stay_reason,status,work_completed,work_completed_at,is_waiting_service").neq("status", "cancelled"),
        supabase.from("app_settings").select("setting_value").eq("setting_key", "daily_report_template").maybeSingle(),
      ]);
      for (const res of [scheduleRes, stateEntryRes, vehicleRes, customerRes, workRes]) if (res.error) throw res.error;
      setEntries((scheduleRes.data || []) as Entry[]); setStateEntries((stateEntryRes.data || []) as BusinessScheduleEntry[]); setVehicles((vehicleRes.data || []) as Vehicle[]); setCustomers((customerRes.data || []) as Customer[]); setWorkOrders((workRes.data || []) as WorkOrder[]);
      const value = settingRes.data?.setting_value as any; setBackgroundUrl(typeof value?.backgroundUrl === "string" && value.backgroundUrl ? value.backgroundUrl : null); setMessage(`${scheduleRes.data?.length || 0}件を既存日報の配置ルールで確認できます。`);
    } catch (error: any) { setMessage(safeActionError("日報プレビューの読み込み", error)); }
  }

  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);
  const workMap = useMemo(() => new Map(workOrders.map((x) => [x.id, x])), [workOrders]);
  const stateEntriesByWork = useMemo(() => { const map = new Map<string, BusinessScheduleEntry[]>(); for (const entry of stateEntries) { if (!entry.work_order_id) continue; const rows = map.get(entry.work_order_id) || []; rows.push(entry); map.set(entry.work_order_id, rows); } return map; }, [stateEntries]);
  const enriched = useMemo<PreviewEntry[]>(() => entries.map((entry) => { const vehicle = entry.vehicle_id ? vehicleMap.get(entry.vehicle_id) : null; const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null; const work = entry.work_order_id ? workMap.get(entry.work_order_id) : null; const deliveryEntry = work ? [...(stateEntriesByWork.get(work.id) || [])].filter((row) => row.entry_type === "delivery").sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] || null : null; const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || ""; return { ...entry, customerName: customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録", last4: raw ? (/^\d+$/.test(raw) ? String(Number(raw)) : raw) : "----", reason: work?.reason || "", inspectionScheduleType: work?.inspection_schedule_type || null, workerName: work?.worker_name || "", outsourceVendorName: work?.outsource_vendor_name || "", deliveryEntry, workCompleted: work ? workCompletedOnReportDay(work, day) : false, isWaitingService: Boolean(work?.is_waiting_service) }; }), [entries, vehicleMap, customerMap, workMap, stateEntriesByWork, day]);
  const morning = enriched.filter((x) => jstHour(x.starts_at) < 12); const afternoon = enriched.filter((x) => jstHour(x.starts_at) >= 12); const model = useMemo(() => buildDailyReportPreviewModel(morning, afternoon), [morning, afternoon]);
  const slots = printRowSlots(); const printedDate = useMemo(() => reportDateParts(day), [day]); const messages = useMemo(() => collectDailyReportMessages(entries), [entries]); const businessStates = useMemo(() => classifyVehicleBusinessStates(workOrders, stateEntries, day), [workOrders, stateEntries, day]);
  function customerForVehicle(vehicleId: string) { const vehicle = vehicleMap.get(vehicleId); const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null; return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録"; }
  function last4ForVehicle(vehicleId: string) { const vehicle = vehicleMap.get(vehicleId); const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || ""; return raw ? (/^\d+$/.test(raw) ? String(Number(raw)) : raw) : "----"; }

  function deliveryCell(entry: PreviewEntry | null) {
    if (!entry) return null; const a = DAILY_REPORT_PRINT_LAYOUT.fieldAnchors.delivery;
    return <div className="reportEntry anchoredEntry deliveryEntry">
      <div className="anchoredField reportCustomer" style={anchorStyle(a.customerName)}>{entry.customerName}</div>
      <div className="anchoredField reportVehicleNo" style={anchorStyle(a.vehicleNo)}><b>{entry.last4}</b></div>
      <div className="anchoredField reportTime" style={anchorStyle(a.time)}>{dailyReportTimeLabel(entry)}</div>
      <div className="anchoredField reportAssignee" style={anchorStyle(a.assignee)}>{entry.workerName}</div>
      <div className="anchoredField reportWorkCode" style={anchorStyle(a.workCode)}>{dailyReportWorkCode(entry.reason, entry.inspectionScheduleType)}</div>
      <div className="anchoredField reportProgress" style={anchorStyle(a.progress)} aria-hidden="true">{entry.workCompleted ? "○" : ""}</div>
    </div>;
  }

  function inboundCell(entry: PreviewEntry | null) {
    if (!entry) return null; const due = dueParts(entry); const a = DAILY_REPORT_PRINT_LAYOUT.fieldAnchors.inbound;
    return <div className="reportEntry anchoredEntry inboundEntry">
      <div className="anchoredField reportCustomer" style={anchorStyle(a.customerName)}>{entry.customerName}</div>
      <div className="anchoredField reportVehicleNo" style={anchorStyle(a.vehicleNo)}><b>{entry.last4}</b></div>
      <div className="anchoredField reportTime" style={anchorStyle(a.time)}>{entry.entry_type === "onsite_repair" && <span className="reportVisitType">{LABEL[entry.entry_type]} </span>}{dailyReportTimeLabel(entry)}</div>
      <div className="anchoredField reportAssignee" style={anchorStyle(a.assignee)}>{entry.workerName}</div>
      {entry.entry_type === "customer_visit" && <div className="anchoredField reportVisitVehicleLabel" style={anchorStyle(a.visitLabel)}>{entry.isWaitingService ? "来社待ち" : "来社"}</div>}
      <div className="anchoredField reportWorkCode" style={anchorStyle(a.workCode)}>{dailyReportWorkCode(entry.reason, entry.inspectionScheduleType)}</div>
      <div className="anchoredField dueDayValue" style={anchorStyle(a.dueDay)}>{due.day}</div>
      {due.broad ? <div className="anchoredField dueBroadValue" style={anchorStyle(a.dueBroad)}>{due.broad}</div> : <><div className="anchoredField dueHourValue" style={anchorStyle(a.dueHour)}>{due.hour}</div><div className="anchoredField dueMinuteValue" style={anchorStyle(a.dueMinute)}>{due.minute}</div></>}
    </div>;
  }

  const rowHeight = (count: number) => `${100 / count}%`;
  function stayingRow(state: BusinessVehicleState<WorkOrder>) { const work = state.work; return <div key={work.id} className="secondaryRow stayingRow" style={{ height: rowHeight(DAILY_REPORT_PRINT_LAYOUT.secondaryRows.stayingVehicles) }}><span className="secAssignee">{work.worker_name || ""}</span><span className="secCustomer">{customerForVehicle(work.vehicle_id)}</span><span className="secVehicle"><b>{last4ForVehicle(work.vehicle_id)}</b><small>{dailyReportWorkCode(work.reason, work.inspection_schedule_type)}</small></span><span className="secInbound">{String(Number(state.inboundDay.slice(8, 10)))}</span><span className="secDue">{shortDay(work.expected_completion_date)}</span></div>; }
  function bodyShopRow(state: BusinessVehicleState<WorkOrder>) { const work = state.work; return <div key={work.id} className="secondaryRow bodyShopRow" style={{ height: rowHeight(DAILY_REPORT_PRINT_LAYOUT.secondaryRows.bodyShopVehicles) }}><span className="secVendor">{work.outsource_vendor_name || ""}</span><span className="secCustomer">{customerForVehicle(work.vehicle_id)}</span><span className="secVehicle"><b>{last4ForVehicle(work.vehicle_id)}</b></span><span className="secInbound">{String(Number(state.inboundDay.slice(8, 10)))}</span><span className="secDue">{state.deliveryDay ? String(Number(state.deliveryDay.slice(8, 10))) : shortDay(work.expected_completion_date)}</span></div>; }
  function plannedDeliveryRow(state: BusinessVehicleState<WorkOrder>) { const work = state.work; const deliveryDay = state.deliveryDay ? String(Number(state.deliveryDay.slice(8, 10))) : ""; return <div key={work.id} className="secondaryRow plannedRow" style={{ height: rowHeight(DAILY_REPORT_PRINT_LAYOUT.secondaryRows.plannedDeliveries) }}><span className="secCustomer">{customerForVehicle(work.vehicle_id)}</span><span className="secVehicle"><b>{last4ForVehicle(work.vehicle_id)}</b><small>{dailyReportWorkCode(work.reason, work.inspection_schedule_type)}</small></span><span className="secDue"><b>{deliveryDay}</b><small>{deliveryTimeLabel(state.deliveryEntry)}</small></span></div>; }

  return <main>
    <div className="toolbar noPrint"><button onClick={() => location.assign(`/schedule?day=${day}`)}>← スケジュールへ</button><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /><button onClick={() => window.print()}>🖨 日報を印刷</button><span>{message}</span></div>
    {!backgroundUrl && <div className="warning noPrint">既成の日報用紙へ直接印字するモードです。プリンターに日報用紙をセットして「日報を印刷」を押してください。印刷されるのは文字だけです。</div>}
    {(model.overflow.deliveries.length > 0 || model.overflow.inbound.length > 0) && <div className="overflow noPrint">⚠ 日報の既存欄に収まらない予定があります。納車 {model.overflow.deliveries.length}件／引取系 {model.overflow.inbound.length}件</div>}
    <section className="sheet" aria-label="既存日報プレビュー">
      {backgroundUrl && <img className="background" src={backgroundUrl} alt="既存の日報用紙" />}
      <div className="dateToken dateMonth">{printedDate.month}</div><div className="dateToken dateDay">{printedDate.day}</div><div className="dateToken dateWeekday">{printedDate.weekday}</div>
      {model.rows.map((row) => { const slot = slots[row.slotIndex]; return <div key={row.slotIndex} className="row" style={{ top: `${slot.y * 100}%` }}><div className="delivery">{deliveryCell(row.delivery)}</div><div className="inbound">{inboundCell(row.inbound)}</div></div>; })}
      <div className="secondary messages" style={regionStyle(DAILY_REPORT_PRINT_LAYOUT.regions.messages)}>{messages.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)}</div>
      <div className="secondary staying" style={regionStyle(DAILY_REPORT_PRINT_LAYOUT.regions.stayingVehicles)}>{businessStates.stayingVehicles.slice(0, DAILY_REPORT_PRINT_LAYOUT.secondaryRows.stayingVehicles).map(stayingRow)}</div>
      <div className="secondary bodyShop" style={regionStyle(DAILY_REPORT_PRINT_LAYOUT.regions.bodyShopVehicles)}>{businessStates.bodyShopVehicles.slice(0, DAILY_REPORT_PRINT_LAYOUT.secondaryRows.bodyShopVehicles).map(bodyShopRow)}</div>
      <div className="secondary planned" style={regionStyle(DAILY_REPORT_PRINT_LAYOUT.regions.plannedDeliveries)}>{businessStates.plannedDeliveries.slice(0, DAILY_REPORT_PRINT_LAYOUT.secondaryRows.plannedDeliveries).map(plannedDeliveryRow)}</div>
      {!backgroundUrl && <div className="placeholder">既成の日報用紙へ重ね印刷<br /><small>画面上は位置確認用／印刷時は文字だけ出力</small></div>}
    </section>
    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#182235;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}.toolbar{max-width:1100px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar button,.toolbar input{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:9px 12px}.toolbar button{font-weight:800;color:#2367d1}.warning,.overflow{max-width:1100px;margin:10px auto;padding:12px 14px;border-radius:12px;background:#fff8dd;border:1px solid #ead486}.overflow{background:#fff0ee;border-color:#efb4ad}.sheet{position:relative;width:min(96vw,1400px);aspect-ratio:297/420;margin:18px auto 60px;background:white;box-shadow:0 10px 35px #0002;overflow:hidden}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.dateToken{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;font-size:clamp(8px,1.15vw,16px);font-weight:800;line-height:1}.dateMonth{left:${DAILY_REPORT_PRINT_LAYOUT.date.month.x * 100}%;top:${DAILY_REPORT_PRINT_LAYOUT.date.month.y * 100}%;width:${DAILY_REPORT_PRINT_LAYOUT.date.month.width * 100}%;height:${DAILY_REPORT_PRINT_LAYOUT.date.month.height * 100}%}.dateDay{left:${DAILY_REPORT_PRINT_LAYOUT.date.day.x * 100}%;top:${DAILY_REPORT_PRINT_LAYOUT.date.day.y * 100}%;width:${DAILY_REPORT_PRINT_LAYOUT.date.day.width * 100}%;height:${DAILY_REPORT_PRINT_LAYOUT.date.day.height * 100}%}.dateWeekday{left:${DAILY_REPORT_PRINT_LAYOUT.date.weekday.x * 100}%;top:${DAILY_REPORT_PRINT_LAYOUT.date.weekday.y * 100}%;width:${DAILY_REPORT_PRINT_LAYOUT.date.weekday.width * 100}%;height:${DAILY_REPORT_PRINT_LAYOUT.date.weekday.height * 100}%}.row{position:absolute;left:0;width:100%;height:${DAILY_REPORT_PRINT_LAYOUT.rows.groupHeight * 100}%;z-index:2}.delivery,.inbound{position:absolute;height:100%;overflow:hidden}.delivery{left:${DAILY_REPORT_PRINT_LAYOUT.regions.delivery.x * 100}%;width:${DAILY_REPORT_PRINT_LAYOUT.regions.delivery.width * 100}%}.inbound{left:${DAILY_REPORT_PRINT_LAYOUT.regions.inbound.x * 100}%;width:${DAILY_REPORT_PRINT_LAYOUT.regions.inbound.width * 100}%}.anchoredEntry{position:relative;width:100%;height:100%;font-size:clamp(7px,.92vw,11px);line-height:1}.anchoredField{position:absolute;display:flex;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px}.reportCustomer{font-weight:500}.reportVehicleNo b{font-size:1em}.reportWorkCode{font-size:.64em;font-weight:700}.reportAssignee{font-size:.78em}.reportProgress{font-weight:900}.reportVisitVehicleLabel,.reportVisitType{font-size:.72em;font-weight:800}.dueDayValue,.dueHourValue,.dueMinuteValue,.dueBroadValue{font-weight:800}.secondary{position:absolute;z-index:2;overflow:hidden;font-size:clamp(6px,.8vw,10px);line-height:1}.messages{padding:.15% .35%;text-align:left}.messages>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}.secondaryRow{position:relative;width:100%;white-space:nowrap;overflow:hidden}.secondaryRow>span{position:absolute;top:0;height:100%;display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;padding:0 2px}.stayingRow .secAssignee{left:0;width:10%;justify-content:center}.stayingRow .secCustomer{left:10%;width:30%;justify-content:flex-start}.stayingRow .secVehicle{left:40%;width:40%;justify-content:center}.stayingRow .secInbound{left:80%;width:10%;justify-content:center}.stayingRow .secDue{left:90%;width:10%;justify-content:center}.bodyShopRow .secVendor{left:0;width:12.5%;justify-content:center}.bodyShopRow .secCustomer{left:12.5%;width:37.5%;justify-content:flex-start}.bodyShopRow .secVehicle{left:50%;width:25%;justify-content:center}.bodyShopRow .secInbound{left:75%;width:12.5%;justify-content:center}.bodyShopRow .secDue{left:87.5%;width:12.5%;justify-content:center}.plannedRow .secCustomer{left:0;width:41.8%;justify-content:flex-start}.plannedRow .secVehicle{left:41.8%;width:32.2%;justify-content:center}.plannedRow .secDue{left:74%;width:26%;justify-content:center}.secVehicle{gap:5%}.secVehicle small,.secDue small{font-size:.78em;font-weight:700}.placeholder{position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:28px;border:2px dashed #cbd5e1;pointer-events:none}.placeholder small{font-size:16px}
      @page{size:A3 portrait;margin:0}
      @media print{html,body{width:297mm!important;height:420mm!important;margin:0!important;padding:0!important;background:white!important;overflow:hidden!important}.noPrint{display:none!important}.background,.placeholder{display:none!important}.sheet{position:fixed!important;left:0!important;top:0!important;width:297mm!important;height:420mm!important;margin:0!important;padding:0!important;box-shadow:none!important;background:transparent!important;transform:none!important;transform-origin:0 0!important;page-break-before:avoid!important;page-break-after:avoid!important;break-before:avoid-page!important;break-after:avoid-page!important}.row,.dateToken,.secondary,.anchoredField{transform:none!important}.dateToken{font-size:3.2mm}.anchoredEntry{font-size:2.35mm}.reportWorkCode{font-size:1.6mm}.reportAssignee,.reportVisitVehicleLabel,.reportVisitType{font-size:1.75mm}.secondary{font-size:2.1mm}.messages{padding:.4mm}}
    `}</style>
  </main>;
}
