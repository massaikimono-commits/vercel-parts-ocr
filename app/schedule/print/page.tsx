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
};

type PrintRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const LABEL: Record<Entry["entry_type"], string> = {
  delivery: "納車",
  pickup: "引取",
  customer_visit: "来社",
  onsite_repair: "出張",
};

// 日報印刷プレビュー専用。共通予定画面へ影響させない。
const PRINT_LAYOUT = {
  page: { widthMm: 297, heightMm: 420 },
  rows: { count: 23, top: 260 / 2482, bottom: 1734 / 2482, groupHeight: 67 / 2482 },
  regions: {
    delivery: { x: 77 / 1755, y: 260 / 2482, width: (876 - 77) / 1755, height: (1801 - 260) / 2482 },
    inbound: { x: 929 / 1755, y: 260 / 2482, width: (1704 - 929) / 1755, height: (1801 - 260) / 2482 },
    messages: { x: 239 / 1755, y: 1802 / 2482, width: (1142 - 239) / 1755, height: (1935 - 1802) / 2482 },
    stayingVehicles: { x: 130 / 1755, y: 2037 / 2482, width: (663 - 130) / 1755, height: (2404 - 2037) / 2482 },
    bodyShopVehicles: { x: 716 / 1755, y: 2037 / 2482, width: (1142 - 716) / 1755, height: (2404 - 2037) / 2482 },
    plannedDeliveries: { x: 1195 / 1755, y: 1836 / 2482, width: (1704 - 1195) / 1755, height: (2404 - 1836) / 2482 },
  },
  columns: {
    delivery: [266 / 799, 160 / 799, 160 / 799, 213 / 799],
    inbound: [266 / 775, 160 / 775, 164 / 775, 185 / 775],
    stayingVehicles: [53 / 533, 160 / 533, 213 / 533, 53 / 533, 54 / 533],
    bodyShopVehicles: [53 / 426, 160 / 426, 106 / 426, 54 / 426, 53 / 426],
    plannedDeliveries: [213 / 509, 164 / 509, 132 / 509],
  },
  secondaryRows: { stayingVehicles: 11, bodyShopVehicles: 11, plannedDeliveries: 17 },
  date: {
    month: { x: 286 / 1755, y: 72 / 2482, width: 42 / 1755, height: 72 / 2482 },
    day: { x: 407 / 1755, y: 72 / 2482, width: 42 / 1755, height: 72 / 2482 },
    weekday: { x: 520 / 1755, y: 72 / 2482, width: 42 / 1755, height: 72 / 2482 },
  },
} as const;

function jstDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function bounds(day: string) {
  const start = new Date(`${day}T00:00:00+09:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

function jstHour(value: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).format(new Date(value)));
}

function jstTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function shortDay(value: string | null) {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  return String(Number(m[3]));
}

function exactDueParts(value: string) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  return {
    day: String(Number(parts.find((part) => part.type === "day")?.value || "0")),
    hour: String(Number(parts.find((part) => part.type === "hour")?.value || "0")),
    minute: minute ? String(minute) : "",
    broad: "",
  };
}

function dueParts(entry: PreviewEntry) {
  const delivery = entry.deliveryEntry;
  if (!delivery) return { day: "", hour: "", minute: "", broad: "" };
  if (delivery.print_time_mode === "unspecified") {
    return { day: shortDay(delivery.starts_at), hour: "", minute: "", broad: "中" };
  }
  if (delivery.print_time_mode === "morning") {
    return { day: shortDay(delivery.starts_at), hour: "", minute: "", broad: "A中" };
  }
  return exactDueParts(delivery.starts_at);
}

function reportDateParts(day: string) {
  const date = new Date(`${day}T00:00:00+09:00`);
  return {
    month: String(Number(day.slice(5, 7))),
    day: String(Number(day.slice(8, 10))),
    weekday: new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(date).replace("曜日", ""),
  };
}

function regionStyle(region: PrintRegion) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}

function gridColumns(columns: readonly number[]) {
  return columns.map((value) => `${(value * 100).toFixed(2)}%`).join(" ");
}

function secondaryRowStyle(columns: readonly number[], rowCount: number) {
  return {
    gridTemplateColumns: gridColumns(columns),
    height: `${100 / rowCount}%`,
  };
}

function printRowSlots() {
  const { count, top, bottom } = PRINT_LAYOUT.rows;
  const step = count <= 1 ? 0 : (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, index) => ({ index, y: top + step * index }));
}

export default function DailyReportPrintPage() {
  const [day, setDay] = useState(() => {
    if (typeof window === "undefined") return jstDay();
    const q = new URLSearchParams(location.search).get("day");
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : jstDay();
  });
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
        supabase.from("work_orders").select("id,vehicle_id,reason,inspection_schedule_type,worker_name,outsource_vendor_name,expected_completion_date,stay_reason,status,work_completed").neq("status", "cancelled"),
        supabase.from("app_settings").select("setting_value").eq("setting_key", "daily_report_template").maybeSingle(),
      ]);
      for (const res of [scheduleRes, stateEntryRes, vehicleRes, customerRes, workRes]) if (res.error) throw res.error;
      setEntries((scheduleRes.data || []) as Entry[]);
      setStateEntries((stateEntryRes.data || []) as BusinessScheduleEntry[]);
      setVehicles((vehicleRes.data || []) as Vehicle[]);
      setCustomers((customerRes.data || []) as Customer[]);
      setWorkOrders((workRes.data || []) as WorkOrder[]);

      const value = settingRes.data?.setting_value as any;
      setBackgroundUrl(typeof value?.backgroundUrl === "string" && value.backgroundUrl ? value.backgroundUrl : null);
      setMessage(`${scheduleRes.data?.length || 0}件を既存日報の配置ルールで確認できます。`);
    } catch (error: any) {
      setMessage(safeActionError("日報プレビューの読み込み", error));
    }
  }

  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);
  const workMap = useMemo(() => new Map(workOrders.map((x) => [x.id, x])), [workOrders]);
  const stateEntriesByWork = useMemo(() => {
    const map = new Map<string, BusinessScheduleEntry[]>();
    for (const entry of stateEntries) {
      if (!entry.work_order_id) continue;
      const rows = map.get(entry.work_order_id) || [];
      rows.push(entry);
      map.set(entry.work_order_id, rows);
    }
    return map;
  }, [stateEntries]);

  const enriched = useMemo<PreviewEntry[]>(() => entries.map((entry) => {
    const vehicle = entry.vehicle_id ? vehicleMap.get(entry.vehicle_id) : null;
    const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null;
    const work = entry.work_order_id ? workMap.get(entry.work_order_id) : null;
    const deliveryEntry = work
      ? [...(stateEntriesByWork.get(work.id) || [])]
          .filter((row) => row.entry_type === "delivery")
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] || null
      : null;
    return {
      ...entry,
      customerName: customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録",
      last4: (() => {
        const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || "";
        if (!raw) return "----";
        return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
      })(),
      reason: work?.reason || "",
      inspectionScheduleType: work?.inspection_schedule_type || null,
      workerName: work?.worker_name || "",
      outsourceVendorName: work?.outsource_vendor_name || "",
      deliveryEntry,
      workCompleted: Boolean(work?.work_completed || work?.status === "completed"),
    };
  }), [entries, vehicleMap, customerMap, workMap, stateEntriesByWork]);

  const morning = enriched.filter((x) => jstHour(x.starts_at) < 12);
  const afternoon = enriched.filter((x) => jstHour(x.starts_at) >= 12);
  const model = useMemo(() => buildDailyReportPreviewModel(morning, afternoon), [morning, afternoon]);
  const slots = printRowSlots();
  const printedDate = useMemo(() => reportDateParts(day), [day]);
  const messages = useMemo(() => collectDailyReportMessages(entries), [entries]);
  const businessStates = useMemo(
    () => classifyVehicleBusinessStates(workOrders, stateEntries, day),
    [workOrders, stateEntries, day],
  );

  function customerForVehicle(vehicleId: string) {
    const vehicle = vehicleMap.get(vehicleId);
    const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null;
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
  }

  function last4ForVehicle(vehicleId: string) {
    const vehicle = vehicleMap.get(vehicleId);
    const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || "";
    if (!raw) return "----";
    return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
  }

  function deliveryCell(entry: PreviewEntry | null) {
    if (!entry) return null;
    return (
      <div className="reportEntry deliveryEntry">
        <div className="reportCustomer">{entry.customerName}</div>
        <div className="reportVehicle">
          <b>{entry.last4}</b>
          <small>{dailyReportWorkCode(entry.reason, entry.inspectionScheduleType)}</small>
        </div>
        <div className="reportTime">{dailyReportTimeLabel(entry)}</div>
        <div className="reportProgress" aria-hidden="true" />
      </div>
    );
  }

  function inboundCell(entry: PreviewEntry | null) {
    if (!entry) return null;
    const due = dueParts(entry);
    return (
      <div className="reportEntry inboundEntry">
        <div className="reportCustomer">{entry.customerName}</div>
        <div className="reportVehicle">
          <b>{entry.last4}</b>
          <small>{dailyReportWorkCode(entry.reason, entry.inspectionScheduleType)}</small>
        </div>
        <div className="reportTime">
          {(entry.entry_type === "customer_visit" || entry.entry_type === "onsite_repair") && (
            <span className="reportVisitType">{LABEL[entry.entry_type]}</span>
          )}
          <span>{dailyReportTimeLabel(entry)}</span>
        </div>
        <div className="reportDue">
          <span className="dueDayValue">{due.day}</span>
          {due.broad ? (
            <span className="dueBroadValue">{due.broad}</span>
          ) : (
            <>
              <span className="dueHourValue">{due.hour}</span>
              <span className="dueMinuteValue">{due.minute}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  function stayingRow(state: BusinessVehicleState<WorkOrder>) {
    const work = state.work;
    return (
      <div
        key={work.id}
        className="secondaryRow stayingRow"
        style={secondaryRowStyle(
          PRINT_LAYOUT.columns.stayingVehicles,
          PRINT_LAYOUT.secondaryRows.stayingVehicles,
        )}
      >
        <span>{work.worker_name || ""}</span>
        <span>{customerForVehicle(work.vehicle_id)}</span>
        <span className="vehicleWork"><b>{last4ForVehicle(work.vehicle_id)}</b><small>{dailyReportWorkCode(work.reason, work.inspection_schedule_type)}</small></span>
        <span>{String(Number(state.inboundDay.slice(8, 10)))}</span>
        <span>{shortDay(work.expected_completion_date)}</span>
      </div>
    );
  }

  function bodyShopRow(state: BusinessVehicleState<WorkOrder>) {
    const work = state.work;
    return (
      <div
        key={work.id}
        className="secondaryRow bodyShopRow"
        style={secondaryRowStyle(
          PRINT_LAYOUT.columns.bodyShopVehicles,
          PRINT_LAYOUT.secondaryRows.bodyShopVehicles,
        )}
      >
        <span>{work.outsource_vendor_name || ""}</span>
        <span>{customerForVehicle(work.vehicle_id)}</span>
        <span><b>{last4ForVehicle(work.vehicle_id)}</b></span>
        <span>{String(Number(state.inboundDay.slice(8, 10)))}</span>
        <span>{state.deliveryDay ? String(Number(state.deliveryDay.slice(8, 10))) : shortDay(work.expected_completion_date)}</span>
      </div>
    );
  }

  function plannedDeliveryRow(state: BusinessVehicleState<WorkOrder>) {
    const work = state.work;
    const deliveryDay = state.deliveryDay ? String(Number(state.deliveryDay.slice(8, 10))) : "";
    return (
      <div
        key={work.id}
        className="secondaryRow plannedRow"
        style={secondaryRowStyle(
          PRINT_LAYOUT.columns.plannedDeliveries,
          PRINT_LAYOUT.secondaryRows.plannedDeliveries,
        )}
      >
        <span>{customerForVehicle(work.vehicle_id)}</span>
        <span className="vehicleWork"><b>{last4ForVehicle(work.vehicle_id)}</b><small>{dailyReportWorkCode(work.reason, work.inspection_schedule_type)}</small></span>
        <span className="secondaryDue"><b>{deliveryDay}</b><small>{deliveryTimeLabel(state.deliveryEntry)}</small></span>
      </div>
    );
  }

  return (
    <main>
      <div className="toolbar noPrint">
        <button onClick={() => location.assign(`/schedule?day=${day}`)}>← スケジュールへ</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button onClick={() => window.print()}>🖨 日報を印刷</button>
        <span>{message}</span>
      </div>

      {!backgroundUrl && <div className="warning noPrint">既成の日報用紙へ直接印字するモードです。プリンターに日報用紙をセットして「日報を印刷」を押してください。印刷されるのは文字だけです。</div>}
      {(model.overflow.deliveries.length > 0 || model.overflow.inbound.length > 0) && <div className="overflow noPrint">⚠ 日報の既存欄に収まらない予定があります。納車 {model.overflow.deliveries.length}件／引取系 {model.overflow.inbound.length}件</div>}

      <section className="sheet" aria-label="既存日報プレビュー">
        {backgroundUrl && <img className="background" src={backgroundUrl} alt="既存の日報用紙" />}
        <div className="dateToken dateMonth">{printedDate.month}</div>
        <div className="dateToken dateDay">{printedDate.day}</div>
        <div className="dateToken dateWeekday">{printedDate.weekday}</div>
        {model.rows.map((row) => {
          const slot = slots[row.slotIndex];
          return <div key={row.slotIndex} className="row" style={{ top: `${slot.y * 100}%` }}>
            <div className="delivery">{deliveryCell(row.delivery)}</div>
            <div className="inbound">{inboundCell(row.inbound)}</div>
          </div>;
        })}

        <div className="secondary messages" style={regionStyle(PRINT_LAYOUT.regions.messages)}>
          {messages.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)}
        </div>
        <div className="secondary staying" style={regionStyle(PRINT_LAYOUT.regions.stayingVehicles)}>
          {businessStates.stayingVehicles
            .slice(0, PRINT_LAYOUT.secondaryRows.stayingVehicles)
            .map(stayingRow)}
        </div>
        <div className="secondary bodyShop" style={regionStyle(PRINT_LAYOUT.regions.bodyShopVehicles)}>
          {businessStates.bodyShopVehicles
            .slice(0, PRINT_LAYOUT.secondaryRows.bodyShopVehicles)
            .map(bodyShopRow)}
        </div>
        <div className="secondary planned" style={regionStyle(PRINT_LAYOUT.regions.plannedDeliveries)}>
          {businessStates.plannedDeliveries
            .slice(0, PRINT_LAYOUT.secondaryRows.plannedDeliveries)
            .map(plannedDeliveryRow)}
        </div>

        {!backgroundUrl && <div className="placeholder">既成の日報用紙へ重ね印刷<br /><small>画面上は位置確認用／印刷時は文字だけ出力</small></div>}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#182235;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}.toolbar{max-width:1100px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar button,.toolbar input{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:9px 12px}.toolbar button{font-weight:800;color:#2367d1}.toolbar button:disabled{opacity:.45;cursor:not-allowed}.warning,.overflow{max-width:1100px;margin:10px auto;padding:12px 14px;border-radius:12px;background:#fff8dd;border:1px solid #ead486}.overflow{background:#fff0ee;border-color:#efb4ad}.sheet{position:relative;width:min(96vw,1400px);aspect-ratio:297/420;margin:18px auto 60px;background:white;box-shadow:0 10px 35px #0002;overflow:hidden}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.dateToken{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;font-size:clamp(8px,1.15vw,16px);font-weight:800;line-height:1}.dateMonth{left:${PRINT_LAYOUT.date.month.x * 100}%;top:${PRINT_LAYOUT.date.month.y * 100}%;width:${PRINT_LAYOUT.date.month.width * 100}%;height:${PRINT_LAYOUT.date.month.height * 100}%}.dateDay{left:${PRINT_LAYOUT.date.day.x * 100}%;top:${PRINT_LAYOUT.date.day.y * 100}%;width:${PRINT_LAYOUT.date.day.width * 100}%;height:${PRINT_LAYOUT.date.day.height * 100}%}.dateWeekday{left:${PRINT_LAYOUT.date.weekday.x * 100}%;top:${PRINT_LAYOUT.date.weekday.y * 100}%;width:${PRINT_LAYOUT.date.weekday.width * 100}%;height:${PRINT_LAYOUT.date.weekday.height * 100}%}.row{position:absolute;left:0;width:100%;height:${PRINT_LAYOUT.rows.groupHeight * 100}%;z-index:2}.delivery,.inbound{position:absolute;height:100%;display:flex;align-items:center;overflow:hidden}.delivery{left:${PRINT_LAYOUT.regions.delivery.x * 100}%;width:${PRINT_LAYOUT.regions.delivery.width * 100}%}.inbound{left:${PRINT_LAYOUT.regions.inbound.x * 100}%;width:${PRINT_LAYOUT.regions.inbound.width * 100}%}.reportEntry{width:100%;height:100%;display:grid;align-items:center;white-space:nowrap;font-size:clamp(7px,.92vw,11px);line-height:1.05}.deliveryEntry{grid-template-columns:${gridColumns(PRINT_LAYOUT.columns.delivery)}}.inboundEntry{grid-template-columns:${gridColumns(PRINT_LAYOUT.columns.inbound)}}.reportCustomer,.reportTime,.reportDue{overflow:hidden;text-overflow:ellipsis;padding:0 2px}.reportCustomer,.reportTime{height:50%;align-self:start;display:flex;align-items:center}.reportCustomer{justify-content:flex-start;padding-left:3px}.reportVehicle{min-width:0;height:100%;display:grid;grid-template-rows:50% 50%;align-items:center;overflow:hidden;padding:0 2px;text-align:center}.reportVehicle b{font-size:1em;line-height:1;align-self:center;overflow:hidden;text-overflow:ellipsis}.reportVehicle small{font-size:.62em;line-height:1;color:#172033;overflow:hidden;text-overflow:ellipsis;align-self:center;justify-self:end;padding-right:9%;max-width:78%}.reportProgress{height:100%}.reportTime{justify-content:center;gap:2px}.reportDue{position:relative;height:100%;line-height:1}.dueDayValue,.dueHourValue,.dueMinuteValue,.dueBroadValue{position:absolute;display:flex;align-items:center;justify-content:center;font-weight:800;overflow:hidden}.dueDayValue{left:31%;top:0;width:23%;height:50%}.dueHourValue{left:0;top:50%;width:18%;height:50%}.dueMinuteValue{left:48%;top:50%;width:18%;height:50%}.dueBroadValue{left:26%;top:50%;width:42%;height:50%}.reportVisitType{font-weight:800;font-size:.78em}.secondary{position:absolute;z-index:2;overflow:hidden;font-size:clamp(6px,.8vw,10px);line-height:1;padding:0}.messages{padding:2px}.messages>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.secondaryRow{width:100%;display:grid;align-items:center;white-space:nowrap;overflow:hidden}.secondaryRow>span{min-width:0;height:100%;padding:0 2px;display:flex;align-items:center;justify-content:center;overflow:hidden;text-overflow:ellipsis}.secondaryRow .vehicleWork{display:grid;grid-template-rows:1fr 1fr;align-items:center;justify-content:stretch;text-align:center}.secondaryRow .vehicleWork b{align-self:end;overflow:hidden;text-overflow:ellipsis}.secondaryRow .vehicleWork small{align-self:start;font-size:.72em;overflow:hidden;text-overflow:ellipsis}.secondaryDue{display:grid!important;grid-template-rows:1fr 1fr!important;align-items:center!important;justify-items:center!important}.secondaryDue b{align-self:end}.secondaryDue small{align-self:start;font-size:.72em}.placeholder{position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:28px;border:2px dashed #cbd5e1;pointer-events:none}.placeholder small{font-size:16px}@page{size:A3 portrait;margin:0}@media print{body{background:white}.noPrint{display:none!important}.background,.placeholder{display:none!important}.sheet{width:${PRINT_LAYOUT.page.widthMm}mm;height:${PRINT_LAYOUT.page.heightMm}mm;margin:0;box-shadow:none;background:transparent}.dateToken{font-size:3.2mm}.reportEntry{font-size:2.35mm}.reportVehicle small{font-size:1.65mm}.secondary{font-size:2.1mm;padding:0}.messages{padding:.4mm}}`}</style>
    </main>
  );
}
