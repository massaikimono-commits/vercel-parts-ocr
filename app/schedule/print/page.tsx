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
  checked_in_at: string | null;
  checked_out_at: string | null;
  status: string;
  work_completed: boolean;
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

function jstTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
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
        supabase.from("work_orders").select("id,vehicle_id,reason,worker_name,expected_completion_date,planned_delivery_at,checked_in_at,checked_out_at,status,work_completed"),
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
      workCompleted: Boolean(work?.work_completed),
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
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "----";
  }

  function cell(entry: PreviewEntry | null) {
    if (!entry) return null;
    return <div className="entry"><b>{dailyReportTimeLabel(entry)} {entry.customerName}</b><span>{entry.last4} {entry.reason} {LABEL[entry.entry_type]}</span>{entry.workCompleted && <strong>○</strong>}</div>;
  }

  function workLine(work: WorkOrder, prefix = "") {
    const completion = work.expected_completion_date ? ` 完成:${work.expected_completion_date}` : "";
    return `${prefix}${customerForVehicle(work.vehicle_id)} ${last4ForVehicle(work.vehicle_id)} ${work.reason}${completion}`.trim();
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
          {secondary.stayingVehicles.map((work) => <div key={work.id}>{workLine(work)}</div>)}
        </div>
        <div className="secondary bodyShop" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.bodyShopVehicles)}>
          {secondary.bodyShopVehicles.map((work) => <div key={work.id}>{workLine(work)}</div>)}
        </div>
        <div className="secondary planned" style={regionStyle(DAILY_REPORT_TEMPLATE.regions.plannedDeliveries)}>
          {secondary.plannedDeliveries.map((work) => <div key={work.id}>{workLine(work, `${jstTime(work.planned_delivery_at)} `)}</div>)}
        </div>

        {!backgroundUrl && <div className="placeholder">既存「日報用紙」背景待ち<br /><small>配置確認専用プレビュー</small></div>}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#182235;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}.toolbar{max-width:1100px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar button,.toolbar input{border:1px solid #cbd5e1;background:white;border-radius:10px;padding:9px 12px}.toolbar button{font-weight:800;color:#2367d1}.toolbar button:disabled{opacity:.45;cursor:not-allowed}.warning,.overflow{max-width:1100px;margin:10px auto;padding:12px 14px;border-radius:12px;background:#fff8dd;border:1px solid #ead486}.overflow{background:#fff0ee;border-color:#efb4ad}.sheet{position:relative;width:min(96vw,1100px);aspect-ratio:210/297;margin:18px auto 60px;background:white;box-shadow:0 10px 35px #0002;overflow:hidden}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.date{position:absolute;left:${DAILY_REPORT_TEMPLATE.regions.date.x * 100}%;top:${DAILY_REPORT_TEMPLATE.regions.date.y * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.date.width * 100}%;height:${DAILY_REPORT_TEMPLATE.regions.date.height * 100}%;font-size:1.4vw;font-weight:800;display:flex;align-items:center;z-index:2}.row{position:absolute;left:0;width:100%;height:2.5%;z-index:2}.delivery,.inbound{position:absolute;height:100%;display:flex;align-items:center;overflow:hidden}.delivery{left:${DAILY_REPORT_TEMPLATE.regions.delivery.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.delivery.width * 100}%}.inbound{left:${DAILY_REPORT_TEMPLATE.regions.inbound.x * 100}%;width:${DAILY_REPORT_TEMPLATE.regions.inbound.width * 100}%}.entry{width:100%;display:grid;grid-template-columns:1fr auto;column-gap:8px;align-items:center;white-space:nowrap;font-size:clamp(7px,1.05vw,13px)}.entry b{overflow:hidden;text-overflow:ellipsis}.entry span{grid-column:1;color:#4b5563;font-size:.8em;overflow:hidden;text-overflow:ellipsis}.entry strong{grid-column:2;grid-row:1/3;font-size:1.4em}.secondary{position:absolute;z-index:2;overflow:hidden;font-size:clamp(6px,.8vw,10px);line-height:1.3;padding:2px}.secondary>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.placeholder{position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;text-align:center;color:#94a3b8;font-size:28px;border:2px dashed #cbd5e1;pointer-events:none}.placeholder small{font-size:16px}@page{size:A4 portrait;margin:0}@media print{body{background:white}.noPrint{display:none!important}.sheet{width:210mm;height:297mm;margin:0;box-shadow:none}.date{font-size:3.2mm}.entry{font-size:2.5mm}.secondary{font-size:2.1mm;padding:.4mm}}`}</style>
    </main>
  );
}
