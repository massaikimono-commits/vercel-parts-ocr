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
  const inboundEntryMap = useMemo(() => new Map(
    entries
      .filter((entry) => entry.entry_type !== "delivery" && entry.work_order_id)
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

  function inboundDay(work: WorkOrder) {
    const entry = inboundEntryMap.get(work.id);
    if (entry) return String(jstDayNumber(entry.starts_at));
    if (work.checked_in_at) return String(jstDayNumber(work.checked_in_at));
    return "";
  }

  function deadlineStack(parts: { day: string; time: string } | null, className: string) {
    if (!parts) return <span className={className} />;
    return <span className={className}><b>{parts.day}</b><em>{parts.time}</em></span>;
  }

  function cell(entry: PreviewEntry | null, side: "delivery" | "inbound") {
    if (!entry) return null;
    const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
    const deadline = side === "inbound" ? deliveryDeadlineParts(work) : null;
    const kindText = side === "inbound"
      ? entry.entry_type === "customer_visit" ? "来社" : entry.entry_type === "onsite_repair" ? "出張" : ""
      : "";
    return <div className={`entry ${side}Entry`}>
      <b className="entryName">{entry.customerName}</b>
      <span className="entryPlate">{entry.last4}</span>
      <span className="entryTimeText">{dailyReportTimeLabel(entry)}</span>
      {kindText && <span className="entryKind">{kindText}</span>}
      <span className="entryReason">{entry.reason}</span>
      <span className="entryWorker">{entry.workerName}</span>
      {deadlineStack(deadline, "entryDeadline")}
      {entry.workCompleted && <strong className="entryDone">○</strong>}
    </div>;
  }

  function stayingItem(work: WorkOrder) {
    const deadline = deliveryDeadlineParts(work);
    return <div className="stayingRow" key={work.id}>
      <span className="stayWorker">{work.worker_name || ""}</span>
      <b className="stayCustomer">{customerForVehicle(work.vehicle_id)}</b>
      <span className="stayVehicle"><b>{last4ForVehicle(work.vehicle_id)}</b><em>{work.reason}</em></span>
      <span className="stayInbound">{inboundDay(work)}</span>
      {deadlineStack(deadline, "stayDeadline")}
    </div>;
  }

  function bodyShopItem(work: WorkOrder) {
    const deadline = deliveryDeadlineParts(work);
    return <div className="bodyShopRow" key={work.id}>
      <span className="bodyFactory">{work.outsource_vendor_name || ""}</span>
      <b className="bodyCustomer">{customerForVehicle(work.vehicle_id)}</b>
      <span className="bodyVehicle">{last4ForVehicle(work.vehicle_id)}</span>
      <span className="bodyInbound">{inboundDay(work)}</span>
      {deadlineStack(deadline, "bodyDeadline")}
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
      {deadlineStack(deadline, "plannedDeadline")}
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
            <div className="delivery">{cell(row.delivery, "delivery")}</div>
            <div className="inbound">{cell(row.inbound, "inbound")}</div>
          </div>;
        })}

        <div className="secondary messages" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.messages)}>
          {messages.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)}
        </div>
        <div className="secondary staying" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.stayingVehicles)}>
          <div className="stayingGrid">{secondary.stayingVehicles.slice(0, 11).map(stayingItem)}</div>
        </div>
        <div className="secondary bodyShop" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.bodyShopVehicles)}>
          <div className="bodyShopGrid">{secondary.bodyShopVehicles.slice(0, 11).map(bodyShopItem)}</div>
        </div>
        <div className="secondary planned" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.plannedDeliveries)}>
          <div className="plannedGrid">{secondary.plannedDeliveries.slice(0, 17).map(plannedDeliveryItem)}</div>
        </div>

        {!backgroundUrl && <div className="placeholder">既存「日報用紙」背景待ち<br /><small>配置確認専用プレビュー</small></div>}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#182235;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}.toolbar{max-width:1100px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar button,.toolbar input{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:9px 12px}.toolbar button{font-weight:800;color:#2367d1}.toolbar button:disabled{opacity:.45;cursor:not-allowed}.warning,.overflow{max-width:1100px;margin:10px auto;padding:12px 14px;border-radius:12px;background:#fff8dd;border:1px solid #ead486}.overflow{background:#fff0ee;border-color:#efb4ad}.sheet{position:relative;width:min(96vw,1400px);aspect-ratio:297/420;margin:18px auto 60px;background:white;box-shadow:0 10px 35px #0002;overflow:hidden}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.date{position:absolute;left:${DAILY_REPORT_TEMPLATE.regions.date.x * 100}%;top:${DAILY_REPORT_TEMPLATE.regions.date.y * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.date.width * 100}%;height:${DAILY_REPORT_TEMPLATE.regions.date.height * 100}%;font-size:1.4vw;font-weight:800;display:flex;align-items:center;z-index:2}.row{position:absolute;left:0;width:100%;height:2.70%;z-index:2}.delivery,.inbound{position:absolute;height:100%;overflow:hidden}.delivery{left:${DAILY_REPORT_TEMPLATE.regions.delivery.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.delivery.width * 100}%}.inbound{left:${DAILY_REPORT_TEMPLATE.regions.inbound.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.inbound.width * 100}%}.entry{position:relative;width:100%;height:100%;white-space:nowrap;font-size:clamp(7px,.92vw,12px);line-height:1}.entryName,.entryPlate,.entryTimeText,.entryKind,.entryReason,.entryWorker{position:absolute;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.entryName,.entryPlate,.entryTimeText{top:3%;height:44%;display:flex;align-items:flex-start}.entryName{font-weight:900}.entryPlate,.entryTimeText{font-weight:800}.entryKind,.entryReason,.entryWorker{bottom:3%;height:43%;display:flex;align-items:flex-end;font-size:.78em;color:#374151}.entryReason{justify-content:center;font-weight:900}.entryWorker{justify-content:center;font-weight:800}.deliveryEntry .entryName{left:.8%;width:31.6%}.deliveryEntry .entryPlate{left:33.3%;width:19.9%}.deliveryEntry .entryTimeText{left:53.3%;width:19.9%}.deliveryEntry .entryKind{display:none}.deliveryEntry .entryReason{left:33.3%;width:19.9%}.deliveryEntry .entryWorker{left:53.3%;width:19.9%}.inboundEntry .entryName{left:.8%;width:33.4%}.inboundEntry .entryPlate{left:34.4%;width:20.6%}.inboundEntry .entryTimeText{left:55.0%;width:21.2%}.inboundEntry .entryKind{left:.8%;width:33.4%}.inboundEntry .entryReason{left:34.4%;width:20.6%}.inboundEntry .entryWorker{left:55.0%;width:21.2%}.entryDeadline{position:absolute;left:83.1%;top:0;width:16.9%;height:100%;display:grid;grid-template-rows:1fr 1fr;align-items:center;justify-items:center;line-height:1;font-size:.78em}.entryDeadline b,.entryDeadline em,.stayDeadline b,.stayDeadline em,.bodyDeadline b,.bodyDeadline em,.plannedDeadline b,.plannedDeadline em{font:inherit;font-weight:900;font-style:normal}.entryDone{position:absolute;right:.5%;top:2%;font-size:1.25em;line-height:1}.secondary{position:absolute;z-index:2;overflow:hidden;padding:0;font-size:clamp(6px,.72vw,9px);line-height:1}.stayingGrid,.bodyShopGrid,.plannedGrid{position:absolute;inset:0;display:grid;min-height:0}.stayingGrid,.bodyShopGrid{grid-template-rows:repeat(11,minmax(0,1fr))}.plannedGrid{grid-template-rows:repeat(17,minmax(0,1fr))}.stayingRow,.bodyShopRow,.plannedRow{display:grid;min-height:0;overflow:hidden;align-items:center}.stayingRow{grid-template-columns:9.9% 29.9% 40.1% 10% 10.1%}.bodyShopRow{grid-template-columns:10.8% 33.6% 22.1% 11.3% 22.2%}.plannedRow{grid-template-columns:35.5% 35.8% 28.7%}.stayWorker,.stayCustomer,.stayVehicle,.stayInbound,.stayDeadline,.bodyFactory,.bodyCustomer,.bodyVehicle,.bodyInbound,.bodyDeadline,.plannedCustomer,.plannedVehicle,.plannedDeadline{min-width:0;max-width:100%;height:100%;overflow:hidden;padding:1px 2px}.stayWorker,.stayCustomer,.bodyFactory,.bodyCustomer,.bodyVehicle,.bodyInbound,.plannedCustomer{display:flex;align-items:flex-start;white-space:nowrap;text-overflow:ellipsis}.stayCustomer,.bodyCustomer,.plannedCustomer{font-weight:900}.stayVehicle,.stayDeadline,.bodyDeadline,.plannedVehicle,.plannedDeadline{display:grid;grid-template-rows:1fr 1fr;align-items:center;justify-items:center}.stayVehicle b,.stayVehicle em,.plannedVehicle b,.plannedVehicle em{font:inherit;font-style:normal;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.stayVehicle em,.plannedVehicle em{font-size:.85em}.stayInbound,.bodyInbound{justify-content:center;font-weight:800}.bodyVehicle{justify-content:center;font-weight:900}.bodyFactory{font-size:.88em}.stayDeadline,.bodyDeadline,.plannedDeadline{font-size:.9em}.placeholder{position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:28px;border:2px dashed #cbd5e1;pointer-events:none}.placeholder small{font-size:16px}@page{size:A3 portrait;margin:0}@media print{body{background:white}.noPrint{display:none!important}.sheet{width:297mm;height:420mm;margin:0;box-shadow:none}.date{font-size:3.2mm}.entry{font-size:2.35mm}.entryPlate,.entryTimeText{font-size:2.1mm}.entryKind,.entryReason,.entryWorker{font-size:1.9mm}.entryDeadline{font-size:1.9mm}.secondary{font-size:1.9mm}.stayingRow,.bodyShopRow,.plannedRow{font-size:1.9mm}}`}</style>
    </main>
  );
}