/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

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

function jstDayNumber(value: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", day: "numeric" }).format(new Date(value)));
}

function jstDeadlineTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  return minute ? `${hour}時${minute}分` : `${hour}時`;
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
  const [message, setMessage] = useState("日報データを読み込みます。");

  useEffect(() => { void load(); }, [day]);

  async function load() {
    const { start, end } = bounds(day);
    try {
      const [scheduleRes, vehicleRes, customerRes, workRes, settingRes] = await Promise.all([
        supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,completed,notes,print_time_mode,print_time_label_override").gte("starts_at", start).lt("starts_at", end),
        supabase.from("vehicles").select("id,customer_id,registration_number,registration_number_last4"),
        supabase.from("customers").select("id,name,company_name,schedule_display_name"),
        supabase.from("work_orders").select("id,vehicle_id,reason,worker_name,expected_completion_date,planned_delivery_at,planned_delivery_date,stay_reason,checked_in_at,checked_out_at,status,work_completed,work_completed_at"),
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
      setMessage(`日報プレビューの読み込みエラー: ${error?.message || error}`);
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
      last4: vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "----",
      reason: work?.reason || "",
      workerName: work?.worker_name || "",
      workCompleted: work ? workCompletedOnReportDay(work, day) : false,
    };
  }), [entries, vehicleMap, customerMap, workMap]);

  const morning = enriched.filter((x) => jstHour(x.starts_at) < 12);
  const afternoon = enriched.filter((x) => jstHour(x.starts_at) >= 12);
  const model = useMemo(() => buildDailyReportPreviewModel(morning, afternoon), [morning, afternoon]);
  const slots = dailyReportRowSlots();
  const messages = useMemo(() => collectDailyReportMessages(entries), [entries]);
  const secondary = useMemo(() => selectDailyReportSecondaryWorks(workOrders, day, entries), [workOrders, day, entries]);
  const deliveryEntryMap = useMemo(() => new Map(
    entries
      .filter((entry) => entry.entry_type === "delivery" && entry.work_order_id)
      .map((entry) => [String(entry.work_order_id), entry]),
  ), [entries]);

  function customerForVehicle(vehicleId: string) {
    const vehicle = vehicleMap.get(vehicleId);
    const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null;
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
  }

  function last4ForVehicle(vehicleId: string) {
    const vehicle = vehicleMap.get(vehicleId);
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "----";
  }

  function deliveryDeadlineParts(work: WorkOrder | null) {
    if (!work) return null;
    const deliveryEntry = deliveryEntryMap.get(work.id);
    if (deliveryEntry) {
      return {
        day: String(jstDayNumber(deliveryEntry.starts_at)),
        time: deliveryEntry.print_time_mode === "exact" ? jstDeadlineTime(deliveryEntry.starts_at) : "中",
      };
    }
    if (work.planned_delivery_at) {
      return {
        day: String(jstDayNumber(work.planned_delivery_at)),
        time: jstDeadlineTime(work.planned_delivery_at),
      };
    }
    if (work.planned_delivery_date) {
      return { day: String(Number(work.planned_delivery_date.slice(-2))), time: "中" };
    }
    return null;
  }

  function deliveryDeadlineLabel(work: WorkOrder) {
    const parts = deliveryDeadlineParts(work);
    return parts ? `${parts.day} ${parts.time}` : "";
  }

  function cell(entry: PreviewEntry | null) {
    if (!entry) return null;
    const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
    const deadline = entry.entry_type === "delivery" ? null : deliveryDeadlineParts(work);
    return <div className="entry">
      <b className="entryName">{entry.customerName}</b>
      <span className="entryTimeText">{dailyReportTimeLabel(entry)}</span>
      <span className="entryPlate">{entry.last4}</span>
      <span className="entryReason">{entry.reason}</span>
      <span className="entryKind">{LABEL[entry.entry_type]}</span>
      {deadline && <span className="entryDeadline"><b>{deadline.day}</b><em>{deadline.time}</em></span>}
      {entry.workCompleted && <strong className="entryDone">○</strong>}
    </div>;
  }

  function secondaryWorkItem(work: WorkOrder, kind: "staying" | "bodyShop") {
    const stayDays = stayDayCountForReport(work, day);
    const detail = [
      last4ForVehicle(work.vehicle_id),
      work.reason,
      stayDays ? `入庫${stayDays}日目` : "",
      work.stay_reason || "",
    ].filter(Boolean).join(" ");
    const deadline = deliveryDeadlineLabel(work);
    return <div className={`secondaryItem ${kind}`} key={work.id}>
      <b className="secondaryName">{customerForVehicle(work.vehicle_id)}</b>
      <span className="secondaryDetail">{detail}</span>
      {deadline && <strong className="secondaryDeadline">{deadline}</strong>}
    </div>;
  }

  function plannedDeliveryItem(work: WorkOrder) {
    const deadline = deliveryDeadlineParts(work);
    return <div className="plannedRow" key={work.id}>
      <b className="plannedCustomer">{customerForVehicle(work.vehicle_id)}</b>
      <span className="plannedVehicle">
        <b>{last4ForVehicle(work.vehicle_id)}</b>
        <em>{work.reason}</em>
      </span>
      <span className="plannedDeadline">
        {deadline ? <><b>{deadline.day}</b><em>{deadline.time}</em></> : null}
      </span>
    </div>;
  }

  return (
    <main>
      <div className="toolbar noPrint">
        <button onClick={() => location.assign(`/schedule?day=${day}`)}>← スケジュールへ</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button onClick={() => window.print()} disabled={!backgroundUrl}>🖨 日報を印刷</button>
        <span>{message}</span>
      </div>

      {!backgroundUrl && <div className="warning noPrint">既存の日報原本は公開GitHubへ置かない方針のため、背景ファイルが安全な保存先に設定されるまでは最終印刷を無効にしています。既存欄への配置結果は下で確認できます。</div>}
      {(model.overflow.deliveries.length > 0 || model.overflow.inbound.length > 0) && <div className="overflow noPrint">⚠ 日報の既存欄に収まらない予定があります。納車 {model.overflow.deliveries.length}件／引取系 {model.overflow.inbound.length}件</div>}

      <section className="sheet" aria-label="既存日報プレビュー">
        {backgroundUrl && <img className="background" src={backgroundUrl} alt="既存の日報用紙" />}
        <div className="date">{day.replaceAll("-", "/")}</div>
        {model.rows.map((row) => {
          const slot = slots[row.slotIndex];
          return <div key={row.slotIndex} className="row" style={{ top: `${slot.y * 100}%` }}>
            <div className="delivery">{cell(row.delivery)}</div>
            <div className="inbound">{cell(row.inbound)}</div>
          </div>;
        })}

        <div className="secondary messages" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.messages)}>
          {messages.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)}
        </div>
        <div className="secondary staying" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.stayingVehicles)}>
          {secondary.stayingVehicles.map((work) => secondaryWorkItem(work, "staying"))}
        </div>
        <div className="secondary bodyShop" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.bodyShopVehicles)}>
          {secondary.bodyShopVehicles.map((work) => secondaryWorkItem(work, "bodyShop"))}
        </div>
        <div className="secondary planned" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.plannedDeliveries)}>
          <div className="plannedGrid">
            {secondary.plannedDeliveries.slice(0, 15).map(plannedDeliveryItem)}
          </div>
        </div>

        {!backgroundUrl && <div className="placeholder">既存「日報用紙」背景待ち<br /><small>配置確認専用プレビュー</small></div>}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#182235;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}.toolbar{max-width:1100px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar button,.toolbar input{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:9px 12px}.toolbar button{font-weight:800;color:#2367d1}.toolbar button:disabled{opacity:.45;cursor:not-allowed}.warning,.overflow{max-width:1100px;margin:10px auto;padding:12px 14px;border-radius:12px;background:#fff8dd;border:1px solid #ead486}.overflow{background:#fff0ee;border-color:#efb4ad}.sheet{position:relative;width:min(96vw,1400px);aspect-ratio:297/420;margin:18px auto 60px;background:white;box-shadow:0 10px 35px #0002;overflow:hidden}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.date{position:absolute;left:${DAILY_REPORT_TEMPLATE.regions.date.x * 100}%;top:${DAILY_REPORT_TEMPLATE.regions.date.y * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.date.width * 100}%;height:${DAILY_REPORT_TEMPLATE.regions.date.height * 100}%;font-size:1.4vw;font-weight:800;display:flex;align-items:center;z-index:2}.row{position:absolute;left:0;width:100%;height:2.5%;z-index:2}.delivery,.inbound{position:absolute;height:100%;overflow:hidden}.delivery{left:${DAILY_REPORT_TEMPLATE.regions.delivery.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.delivery.width * 100}%}.inbound{left:${DAILY_REPORT_TEMPLATE.regions.inbound.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.inbound.width * 100}%}.entry{position:relative;width:100%;height:100%;white-space:nowrap;font-size:clamp(7px,1.05vw,13px)}.entryName{position:absolute;left:1%;top:0;width:32%;height:48%;display:flex;align-items:flex-start;overflow:hidden;text-overflow:ellipsis;font-weight:900;line-height:1}.entryPlate,.entryTimeText{position:absolute;top:0;height:48%;display:flex;align-items:flex-start;overflow:hidden;text-overflow:ellipsis;color:#111827;font-size:.82em;line-height:1;font-weight:800}.entryPlate{left:34%;width:18%}.entryTimeText{left:54%;width:18%}.entryReason,.entryKind{position:absolute;bottom:0;height:48%;display:flex;align-items:flex-end;overflow:hidden;text-overflow:ellipsis;color:#374151;font-size:.76em;line-height:1}.entryReason{left:34%;width:20%;justify-content:center;font-weight:900}.entryKind{left:55%;width:17%;justify-content:center;font-weight:800}.entryDeadline{position:absolute;right:1%;top:0;width:23%;height:100%;display:grid;grid-template-rows:1fr 1fr;align-items:center;justify-items:center;line-height:1;font-size:.76em;font-style:normal}.entryDeadline b,.entryDeadline em{font:inherit;font-weight:900;font-style:normal}.entryDone{position:absolute;right:0;top:0;font-size:1.3em;line-height:1}.secondary{position:absolute;z-index:2;overflow:hidden;font-size:clamp(6px,.8vw,10px);line-height:1.15;padding:2px}.secondaryItem{position:relative;min-height:2.45em;padding:0 1px 1px;overflow:hidden}.secondaryName{display:block;height:1.12em;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:900}.secondaryDetail{display:block;height:1.05em;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#4b5563}.secondaryDeadline{position:absolute;right:1px;bottom:0;background:#fff;padding-left:3px;font-weight:900}.bodyShop .secondaryItem{margin-left:10%;width:90%}.planned{padding:0}.plannedGrid{position:absolute;left:0;right:0;top:6.25%;bottom:0;display:grid;grid-template-rows:repeat(15,minmax(0,1fr))}.plannedRow{display:grid;grid-template-columns:42% 32% 26%;min-height:0;overflow:hidden;font-size:clamp(6px,.78vw,10px);line-height:1}.plannedCustomer,.plannedVehicle,.plannedDeadline{min-width:0;overflow:hidden}.plannedCustomer{display:flex;align-items:flex-start;padding:1px 3px 0;font-weight:900;white-space:nowrap;text-overflow:ellipsis}.plannedVehicle,.plannedDeadline{display:grid;grid-template-rows:1fr 1fr;align-items:center;justify-items:center}.plannedVehicle b,.plannedVehicle em,.plannedDeadline b,.plannedDeadline em{font:inherit;font-style:normal;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.plannedVehicle em{font-size:.88em}.plannedDeadline em{font-size:.9em}.placeholder{position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:28px;border:2px dashed #cbd5e1;pointer-events:none}.placeholder small{font-size:16px}@page{size:A3 portrait;margin:0}@media print{body{background:white}.noPrint{display:none!important}.sheet{width:297mm;height:420mm;margin:0;box-shadow:none}.date{font-size:3.2mm}.entry{font-size:2.5mm}.secondary{font-size:2.1mm;padding:.4mm}.entryName{top:.15mm}.entryPlate,.entryTimeText{font-size:2.1mm}.entryReason{font-size:1.95mm}.entryDeadline{font-size:1.95mm}.secondaryName{font-size:2.2mm}.secondaryDeadline{font-size:2.1mm}.plannedRow{font-size:2mm}}`}</style>
    </main>
  );
}