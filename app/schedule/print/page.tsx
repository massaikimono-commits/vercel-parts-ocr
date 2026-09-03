/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { safeActionError } from "../../lib/client-security";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { buildDailyReportPreviewModel } from "../daily-report-print-model";
import { collectDailyReportMessages, selectDailyReportSecondaryWorks } from "../daily-report-secondary-sections";
import { dailyReportTimeLabel } from "../print-rules";
import { DAILY_REPORT_TEMPLATE, dailyReportRowSlots, type DailyReportRegion } from "../daily-report-template";

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
  worker_name: string | null;
  outsource_vendor_name: string | null;
  expected_completion_date: string | null;
  planned_delivery_at: string | null;
  planned_delivery_date: string | null;
  stay_reason: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  status: string;
  work_completed: boolean;
  work_completed_at: string | null;
};

type PreviewEntry = Entry & {
  customerName: string;
  last4: string;
  reason: string;
  workerName: string;
  outsourceVendorName: string;
  plannedDeliveryAt: string | null;
  plannedDeliveryDate: string | null;
  expectedCompletionDate: string | null;
  workCompleted: boolean;
};

const LABEL: Record<Entry["entry_type"], string> = {
  delivery: "納車",
  pickup: "引取",
  customer_visit: "来社",
  onsite_repair: "出張",
};

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

function shortDate(value: string | null) {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function dueLabel(entry: PreviewEntry) {
  if (entry.plannedDeliveryAt) {
    const d = new Date(entry.plannedDeliveryAt);
    const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    return `${date} ${time}`;
  }
  if (entry.plannedDeliveryDate) return shortDate(entry.plannedDeliveryDate);
  if (entry.expectedCompletionDate) return shortDate(entry.expectedCompletionDate);
  return "";
}

function stayDayCountForReport(work: WorkOrder, day: string) {
  if (!work.checked_in_at) return null;
  const checkedInDay = jstDay(new Date(work.checked_in_at));
  const start = new Date(`${checkedInDay}T00:00:00+09:00`).getTime();
  const reportDay = new Date(`${day}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(reportDay) || reportDay < start) return null;
  return Math.floor((reportDay - start) / 86400000) + 1;
}

function workCompletedOnReportDay(work: WorkOrder, day: string) {
  const { end } = bounds(day);
  const endMs = new Date(end).getTime();
  if (work.work_completed_at) {
    return new Date(work.work_completed_at).getTime() < endMs;
  }
  const checkedOutAt = work.checked_out_at ? new Date(work.checked_out_at).getTime() : null;
  const legacyLaterCheckout = endMs < Date.now() && checkedOutAt !== null && checkedOutAt >= endMs;
  if (legacyLaterCheckout) return false;
  return work.work_completed || work.status === "completed";
}

function regionStyle(region: DailyReportRegion) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
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
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundOpacity, setBackgroundOpacity] = useState(1);
  const [showBackground, setShowBackground] = useState(true);
  const [message, setMessage] = useState("日報データを読み込みます。");

  useEffect(() => { void load(); }, [day]);

  async function load() {
    const { start, end } = bounds(day);
    try {
      const [scheduleRes, vehicleRes, customerRes, workRes, settingRes] = await Promise.all([
        supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,completed,notes,print_time_mode,print_time_label_override").gte("starts_at", start).lt("starts_at", end),
        supabase.from("vehicles").select("id,customer_id,registration_number,registration_number_last4"),
        supabase.from("customers").select("id,name,company_name,schedule_display_name"),
        supabase.from("work_orders").select("id,vehicle_id,reason,worker_name,outsource_vendor_name,expected_completion_date,planned_delivery_at,planned_delivery_date,stay_reason,checked_in_at,checked_out_at,status,work_completed,work_completed_at"),
        supabase.from("app_settings").select("setting_value").eq("setting_key", "daily_report_template").maybeSingle(),
      ]);
      for (const res of [scheduleRes, vehicleRes, customerRes, workRes]) if (res.error) throw res.error;
      setEntries((scheduleRes.data || []) as Entry[]);
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

  const enriched = useMemo<PreviewEntry[]>(() => entries.map((entry) => {
    const vehicle = entry.vehicle_id ? vehicleMap.get(entry.vehicle_id) : null;
    const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null;
    const work = entry.work_order_id ? workMap.get(entry.work_order_id) : null;
    return {
      ...entry,
      customerName: customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録",
      last4: (() => {
        const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || "";
        if (!raw) return "----";
        return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
      })(),
      reason: work?.reason || "",
      workerName: work?.worker_name || "",
      outsourceVendorName: work?.outsource_vendor_name || "",
      plannedDeliveryAt: work?.planned_delivery_at || null,
      plannedDeliveryDate: work?.planned_delivery_date || null,
      expectedCompletionDate: work?.expected_completion_date || null,
      workCompleted: work ? workCompletedOnReportDay(work, day) : false,
    };
  }), [entries, vehicleMap, customerMap, workMap]);

  const morning = enriched.filter((x) => jstHour(x.starts_at) < 12);
  const afternoon = enriched.filter((x) => jstHour(x.starts_at) >= 12);
  const model = useMemo(() => buildDailyReportPreviewModel(morning, afternoon), [morning, afternoon]);
  const slots = dailyReportRowSlots();
  const messages = useMemo(() => collectDailyReportMessages(entries), [entries]);
  const secondary = useMemo(() => selectDailyReportSecondaryWorks(workOrders, day), [workOrders, day]);

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
          {entry.reason && <small>{entry.reason}</small>}
        </div>
        <div className="reportTime">{dailyReportTimeLabel(entry)}</div>
      </div>
    );
  }

  function inboundCell(entry: PreviewEntry | null) {
    if (!entry) return null;
    return (
      <div className="reportEntry inboundEntry">
        <div className="reportCustomer">{entry.customerName}</div>
        <div className="reportVehicle">
          <b>{entry.last4}</b>
          {entry.reason && <small>{entry.reason}</small>}
        </div>
        <div className="reportTime">
          {(entry.entry_type === "customer_visit" || entry.entry_type === "onsite_repair") && (
            <span className="reportVisitType">{LABEL[entry.entry_type]}</span>
          )}
          <span>{dailyReportTimeLabel(entry)}</span>
        </div>
        <div className="reportDue">{dueLabel(entry)}</div>
      </div>
    );
  }

  function dateOnly(value: string | null | undefined) {
    if (!value) return "";
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return `${Number(m[2])}/${Number(m[3])}`;
  }

  function futureDeliveryDue(work: WorkOrder) {
    if (work.planned_delivery_at) {
      const d = new Date(work.planned_delivery_at);
      const date = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
      }).format(d);
      const time = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
      return `${date} ${time}`;
    }
    return dateOnly(work.planned_delivery_date || work.expected_completion_date);
  }

  function lowerVehicle(work: WorkOrder) {
    return (
      <span className="lowerVehicle">
        <b>{last4ForVehicle(work.vehicle_id)}</b>
        <small>{work.reason}</small>
      </span>
    );
  }

  function stayingRow(work: WorkOrder) {
    return (
      <div className="lowerRow stayingRow" key={work.id}>
        <span>{work.worker_name || ""}</span>
        <span>{customerForVehicle(work.vehicle_id)}</span>
        {lowerVehicle(work)}
        <span>{dateOnly(work.checked_in_at)}</span>
        <span>{dateOnly(work.planned_delivery_date || work.expected_completion_date)}</span>
      </div>
    );
  }

  function bodyShopRow(work: WorkOrder) {
    return (
      <div className="lowerRow bodyShopRow" key={work.id}>
        <span>{work.outsource_vendor_name || ""}</span>
        <span>{customerForVehicle(work.vehicle_id)}</span>
        {lowerVehicle(work)}
        <span>{dateOnly(work.checked_in_at)}</span>
        <span>{dateOnly(work.planned_delivery_date || work.expected_completion_date)}</span>
      </div>
    );
  }

  function plannedDeliveryRow(work: WorkOrder) {
    return (
      <div className="lowerRow plannedDeliveryRow" key={work.id}>
        <span>{customerForVehicle(work.vehicle_id)}</span>
        {lowerVehicle(work)}
        <span>{futureDeliveryDue(work)}</span>
      </div>
    );
  }

  return (
    <main>
      <div className="toolbar noPrint">
        <button onClick={() => location.assign(`/schedule?day=${day}`)}>← スケジュールへ</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button onClick={() => window.print()}>🖨 日報を印刷</button>
        {backgroundUrl && <>
          <button onClick={() => setShowBackground((old) => !old)}>{showBackground ? "背景を隠す" : "背景を表示"}</button>
          <label className="backgroundControl">
            背景濃度
            <input
              type="range"
              min="0.25"
              max="1"
              step="0.05"
              value={backgroundOpacity}
              onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
            />
            <b>{Math.round(backgroundOpacity * 100)}%</b>
          </label>
        </>}
        <span>{message}</span>
      </div>

      {!backgroundUrl && <div className="warning noPrint">既成の日報用紙へ直接印字するモードです。プリンターに日報用紙をセットして「日報を印刷」を押してください。印刷されるのは文字だけです。</div>}
      {(model.overflow.deliveries.length > 0 || model.overflow.inbound.length > 0) && <div className="overflow noPrint">⚠ 日報の既存欄に収まらない予定があります。納車 {model.overflow.deliveries.length}件／引取系 {model.overflow.inbound.length}件</div>}

      <section className="sheet" aria-label="既存日報プレビュー">
        {backgroundUrl && showBackground && <img className="background" style={{ opacity: backgroundOpacity }} src={backgroundUrl} alt="実際の日報PDF背景" />}
        <div className="date">{day.replaceAll("-", "/")}</div>
        {model.rows.map((row) => {
          const slot = slots[row.slotIndex];
          return <div key={row.slotIndex} className="row" style={{ top: `${slot.y * 100}%` }}>
            <div className="delivery">{deliveryCell(row.delivery)}</div>
            <div className="inbound">{inboundCell(row.inbound)}</div>
          </div>;
        })}

        <div className="secondary messages" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.messages)}>
          {messages.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)}
        </div>
        <div className="secondary staying" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.stayingVehicles)}>
          {secondary.stayingVehicles.map(stayingRow)}
        </div>
        <div className="secondary bodyShop" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.bodyShopVehicles)}>
          {secondary.bodyShopVehicles.map(bodyShopRow)}
        </div>
        <div className="secondary planned" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.plannedDeliveries)}>
          {secondary.plannedDeliveries.map(plannedDeliveryRow)}
        </div>

        {!backgroundUrl && <div className="placeholder">既成の日報用紙へ重ね印刷<br /><small>画面上は位置確認用／印刷時は文字だけ出力</small></div>}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}body{margin:0;background:#eef2f7;color:#182235;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}.toolbar{max-width:1100px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar button,.toolbar input{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:9px 12px}.backgroundControl{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:800;color:#516173;background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:6px 10px}.backgroundControl input[type=range]{width:110px;padding:0;border:0}.backgroundControl b{min-width:34px;text-align:right}.toolbar button{font-weight:800;color:#2367d1}.toolbar button:disabled{opacity:.45;cursor:not-allowed}.warning,.overflow{max-width:1100px;margin:10px auto;padding:12px 14px;border-radius:12px;background:#fff8dd;border:1px solid #ead486}.overflow{background:#fff0ee;border-color:#efb4ad}.sheet{--sheet-w:min(96vw,842px);position:relative;width:var(--sheet-w);aspect-ratio:297/420;margin:18px auto 60px;background:white;box-shadow:0 10px 35px #0002;overflow:hidden}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;z-index:0}.date{position:absolute;left:${DAILY_REPORT_TEMPLATE.regions.date.x * 100}%;top:${DAILY_REPORT_TEMPLATE.regions.date.y * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.date.width * 100}%;height:${DAILY_REPORT_TEMPLATE.regions.date.height * 100}%;font-size:calc(var(--sheet-w) * .01077);font-weight:800;display:flex;align-items:center;z-index:2}.row{position:absolute;left:0;width:100%;height:${DAILY_REPORT_TEMPLATE.rows.height * 100}%;z-index:2}.delivery,.inbound{position:absolute;height:100%;display:flex;align-items:center;overflow:hidden}.delivery{left:${DAILY_REPORT_TEMPLATE.regions.delivery.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.delivery.width * 100}%}.inbound{left:${DAILY_REPORT_TEMPLATE.regions.inbound.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.inbound.width * 100}%}.reportEntry{width:100%;height:100%;display:grid;align-items:center;white-space:nowrap;font-size:calc(var(--sheet-w) * .00791);line-height:1.05.deliveryEntry{grid-template-columns:${DAILY_REPORT_TEMPLATE.columns.delivery.customer * 100}% ${DAILY_REPORT_TEMPLATE.columns.delivery.vehicle * 100}% ${DAILY_REPORT_TEMPLATE.columns.delivery.time * 100}%}.inboundEntry{grid-template-columns:${DAILY_REPORT_TEMPLATE.columns.inbound.customer * 100}% ${DAILY_REPORT_TEMPLATE.columns.inbound.vehicle * 100}% ${DAILY_REPORT_TEMPLATE.columns.inbound.time * 100}% ${DAILY_REPORT_TEMPLATE.columns.inbound.due * 100}%}.reportCustomer,.reportTime,.reportDue{overflow:hidden;text-overflow:ellipsis;padding:0 calc(var(--sheet-w) * .0016)}.reportVehicle{min-width:0;display:flex;flex-direction:column;justify-content:center;overflow:hidden;padding:0 calc(var(--sheet-w) * .0016)}.reportVehicle b{font-size:1em;line-height:1}.reportVehicle small{font-size:.68em;line-height:1;color:#4b5563;overflow:hidden;text-overflow:ellipsis}.reportTime,.reportDue{text-align:center}.reportTime{display:flex;align-items:center;justify-content:center;gap:calc(var(--sheet-w) * .0016)}.reportVisitType{font-weight:800;font-size:.78em}.secondary{position:absolute;z-index:2;overflow:hidden;font-size:calc(var(--sheet-w) * .00707);line-height:1;padding:0;display:grid;align-content:start.secondary.messages{display:block;padding:calc(var(--sheet-w) * .0016)}.secondary.messages>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.secondary.staying{grid-template-rows:repeat(${DAILY_REPORT_TEMPLATE.secondaryRows.stayingVehicles},1fr)}.secondary.bodyShop{grid-template-rows:repeat(${DAILY_REPORT_TEMPLATE.secondaryRows.bodyShopVehicles},1fr)}.secondary.planned{grid-template-rows:repeat(${DAILY_REPORT_TEMPLATE.secondaryRows.plannedDeliveries},1fr)}.lowerRow{display:grid;align-items:center;min-width:0;white-space:nowrap;overflow:hidden}.lowerRow>span{min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0 calc(var(--sheet-w) * .0008)}.stayingRow{grid-template-columns:${DAILY_REPORT_TEMPLATE.lowerColumns.stayingVehicles.worker * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.stayingVehicles.customer * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.stayingVehicles.vehicle * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.stayingVehicles.checkIn * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.stayingVehicles.due * 100}%}.bodyShopRow{grid-template-columns:${DAILY_REPORT_TEMPLATE.lowerColumns.bodyShopVehicles.factory * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.bodyShopVehicles.customer * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.bodyShopVehicles.vehicle * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.bodyShopVehicles.checkIn * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.bodyShopVehicles.due * 100}%}.plannedDeliveryRow{grid-template-columns:${DAILY_REPORT_TEMPLATE.lowerColumns.plannedDeliveries.customer * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.plannedDeliveries.vehicle * 100}% ${DAILY_REPORT_TEMPLATE.lowerColumns.plannedDeliveries.due * 100}%}.lowerVehicle{display:flex;flex-direction:column;justify-content:center;line-height:1}.lowerVehicle b{font-size:1em}.lowerVehicle small{font-size:.68em;color:#4b5563;overflow:hidden;text-overflow:ellipsis}.placeholder{position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:calc(var(--sheet-w) * .02);border:1px dashed #cbd5e1;pointer-events:none}.placeholder small{font-size:calc(var(--sheet-w) * .0114)}@page{size:A3 portrait;margin:0}@media print{body{background:white}.noPrint{display:none!important}.background,.placeholder{display:none!important}.sheet{--sheet-w:297mm;width:297mm;height:420mm;margin:0;box-shadow:none;background:transparent}.date{font-size:3.2mm}.reportEntry{font-size:2.35mm}.reportVehicle small{font-size:1.65mm}.secondary{font-size:2.1mm;padding:.4mm}}`}</style>
    </main>
  );
}
