/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { dailyReportTimeLabel } from "../print-rules";
import { safeActionError } from "../../lib/client-security";

type ScheduleEntry = {
  id: string;
  vehicle_id: string | null;
  work_order_id: string | null;
  entry_type: "delivery" | "pickup" | "customer_visit" | "onsite_repair";
  starts_at: string;
  ends_at: string;
  print_time_mode: "exact" | "morning" | "unspecified";
  print_time_label_override: string | null;
};

type WorkOrder = {
  id: string;
  vehicle_id: string;
  reason: string;
  worker_name: string | null;
  outsource_vendor_name: string | null;
  is_urgent: boolean;
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

type CalendarDay = {
  business_date: string;
  is_business_day: boolean;
  label: string | null;
};

type MonthRow = {
  entry: ScheduleEntry;
  work: WorkOrder | null;
  vehicle: Vehicle | null;
  customer: Customer | null;
};

const ENTRY_LABEL: Record<ScheduleEntry["entry_type"], string> = {
  delivery: "納車",
  pickup: "",
  customer_visit: "来社",
  onsite_repair: "出張",
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function firstOfMonth(day: string) {
  return day.slice(0, 7) + "-01";
}

function addMonths(day: string, delta: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + delta, 1);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(day: string) {
  const d = new Date(day + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function addDays(day: string, delta: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function jstIso(day: string) {
  return new Date(day + "T00:00:00+09:00").toISOString();
}

function dateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function monthTitle(day: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC", year: "numeric", month: "long",
  }).format(new Date(day + "T00:00:00Z"));
}

function reasonOrder(reason: string | null | undefined) {
  if (reason === "点検") return 0;
  if (reason === "一般整備") return 1;
  if (reason === "板金" || reason === "板金塗装") return 2;
  if (reason === "車検") return 3;
  return 9;
}

function last4(vehicle: Vehicle | null) {
  const raw = vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] || "";
  if (!raw) return "----";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function customerName(customer: Customer | null) {
  return customer?.schedule_display_name || customer?.company_name || customer?.name || "未登録";
}

export default function MonthlySchedulePage() {
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(todayJst()));
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [calendar, setCalendar] = useState<Record<string, CalendarDay>>({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("月間予定を読み込みます。");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setMonthStart(firstOfMonth(q));
  }, []);

  useEffect(() => {
    void loadMonth();
  }, [monthStart]);

  async function loadMonth() {
    setBusy(true);
    setMessage("月間予定を読み込み中…");
    const nextMonth = addMonths(monthStart, 1);
    try {
      const [entryRes, calendarRes] = await Promise.all([
        supabase
          .from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode,print_time_label_override")
          .gte("starts_at", jstIso(monthStart))
          .lt("starts_at", jstIso(nextMonth))
          .order("starts_at", { ascending: true }),
        supabase
          .from("business_calendar")
          .select("business_date,is_business_day,label")
          .gte("business_date", monthStart)
          .lt("business_date", nextMonth),
      ]);
      if (entryRes.error) throw entryRes.error;
      if (calendarRes.error) throw calendarRes.error;

      const nextEntries = (entryRes.data || []) as ScheduleEntry[];
      const workIds = [...new Set(nextEntries.map((x) => x.work_order_id).filter(Boolean))] as string[];

      let nextWorks: WorkOrder[] = [];
      if (workIds.length) {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id,vehicle_id,reason,worker_name,outsource_vendor_name,is_urgent")
          .in("id", workIds);
        if (error) throw error;
        nextWorks = (data || []) as WorkOrder[];
      }

      const vehicleIds = [...new Set([
        ...nextEntries.map((x) => x.vehicle_id).filter(Boolean),
        ...nextWorks.map((x) => x.vehicle_id).filter(Boolean),
      ])] as string[];

      let nextVehicles: Vehicle[] = [];
      if (vehicleIds.length) {
        const { data, error } = await supabase
          .from("vehicles")
          .select("id,customer_id,registration_number_last4,registration_number")
          .in("id", vehicleIds);
        if (error) throw error;
        nextVehicles = (data || []) as Vehicle[];
      }

      const customerIds = [...new Set(nextVehicles.map((x) => x.customer_id).filter(Boolean))] as string[];
      let nextCustomers: Customer[] = [];
      if (customerIds.length) {
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name")
          .in("id", customerIds);
        if (error) throw error;
        nextCustomers = (data || []) as Customer[];
      }

      setEntries(nextEntries);
      setWorks(nextWorks);
      setVehicles(nextVehicles);
      setCustomers(nextCustomers);
      setCalendar(Object.fromEntries(((calendarRes.data || []) as CalendarDay[]).map((x) => [x.business_date, x])));
      setMessage(monthTitle(monthStart) + " の予定を表示しています。");
    } catch (error: any) {
      setMessage(safeActionError("月間予定の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  const workMap = useMemo(() => new Map(works.map((x) => [x.id, x])), [works]);
  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);

  const rowsByDay = useMemo(() => {
    const grouped: Record<string, MonthRow[]> = {};
    for (const entry of entries) {
      const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
      const vehicleId = entry.vehicle_id || work?.vehicle_id || null;
      const vehicle = vehicleId ? vehicleMap.get(vehicleId) || null : null;
      const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
      const key = dateKey(entry.starts_at);
      (grouped[key] ||= []).push({ entry, work, vehicle, customer });
    }
    for (const key of Object.keys(grouped)) {
      grouped[key] = grouped[key]
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
          const reasonDiff = reasonOrder(a.row.work?.reason) - reasonOrder(b.row.work?.reason);
          if (reasonDiff) return reasonDiff;
          return new Date(a.row.entry.starts_at).getTime() - new Date(b.row.entry.starts_at).getTime() || a.index - b.index;
        })
        .map(({ row }) => row);
    }
    return grouped;
  }, [entries, workMap, vehicleMap, customerMap]);

  function overlapIds(rows: MonthRow[]) {
    const ids = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i].entry;
        const b = rows[j].entry;
        if (a.print_time_mode !== "exact" || b.print_time_mode !== "exact") continue;
        if (a.entry_type !== b.entry_type) continue;
        if (new Date(a.starts_at) < new Date(b.ends_at) && new Date(a.ends_at) > new Date(b.starts_at)) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }

  function reasonClass(work: WorkOrder | null) {
    if (!work) return "reason-none";
    if (work.reason === "点検") return "reason-check";
    if (work.reason === "車検") return "reason-shaken";
    if (work.reason === "一般整備") return work.outsource_vendor_name ? "reason-body" : "reason-repair";
    if (work.reason === "板金" || work.reason === "板金塗装") return "reason-body";
    return "reason-none";
  }

  const cells = useMemo(() => {
    const total = daysInMonth(monthStart);
    const lead = new Date(monthStart + "T00:00:00Z").getUTCDay();
    const out: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let i = 0; i < total; i++) out.push(addDays(monthStart, i));
    while (out.length % 7) out.push(null);
    return out;
  }, [monthStart]);

  function openDay(day: string) {
    window.location.href = "/schedule?day=" + day;
  }

  return (
    <main className="monthPage">
      <header className="top">
        <button onClick={() => { window.location.href = "/"; }}>← メインへ</button>
        <div><b>スケジュール</b><span>月間表示</span></div>
        <strong>icb</strong>
      </header>

      <section className="monthHero">
        <div>
          <div className="eyebrow">月全体の予定</div>
          <h1>{monthTitle(monthStart)}</h1>
          <p>{busy ? "読み込み中…" : message}</p>
        </div>
        <div className="monthNav">
          <button onClick={() => setMonthStart(addMonths(monthStart, -1))}>← 前月</button>
          <button onClick={() => setMonthStart(firstOfMonth(todayJst()))}>今月</button>
          <button onClick={() => setMonthStart(addMonths(monthStart, 1))}>翌月 →</button>
          <button onClick={() => { window.location.href = "/schedule/week?day=" + monthStart; }}>週間</button>
        </div>
      </section>

      <section className="weekdayRow">
        {["日","月","火","水","木","金","土"].map((x) => <b key={x}>{x}</b>)}
      </section>

      <section className="monthGrid">
        {cells.map((day, index) => {
          if (!day) return <div className="dayCell blank" key={"blank-" + index} />;
          const rows = rowsByDay[day] || [];
          const overlaps = overlapIds(rows);
          const cal = calendar[day];
          const isToday = day === todayJst();
          const dayNumber = Number(day.slice(-2));
          return (
            <article className={"dayCell " + (isToday ? "today " : "") + (cal && !cal.is_business_day ? "closed" : "")} key={day}>
              <button className="dayHead" onClick={() => openDay(day)}>
                <b>{dayNumber}</b>
                <span>{rows.length}件</span>
              </button>
              {cal && !cal.is_business_day && <small className="closedLabel">{cal.label || "休業日"}</small>}
              <div className="monthRows">
                {rows.slice(0, 3).map(({ entry, work, vehicle, customer }) => {
                  const visitLabel = entry.entry_type === "customer_visit" || entry.entry_type === "onsite_repair"
                    ? ENTRY_LABEL[entry.entry_type]
                    : "";
                  return (
                    <button
                      key={entry.id}
                      className={"monthRow " + reasonClass(work) + (overlaps.has(entry.id) ? " overlapping" : "")}
                      onClick={() => { window.location.href = "/schedule/edit?id=" + encodeURIComponent(entry.id); }}
                    >
                      <span className="customer">{customerName(customer)}</span>
                      <span className="identity">
                        <span className="vehicle"><b>{last4(vehicle)}</b><small>{work?.reason || ""}</small></span>
                        <span className="time">{visitLabel && <em>{visitLabel}</em>}<b>{dailyReportTimeLabel(entry)}</b></span>
                      </span>
                      {overlaps.has(entry.id) && <small className="overlapTag">重複</small>}
                    </button>
                  );
                })}
                {rows.length > 3 && <button className="more" onClick={() => openDay(day)}>ほか {rows.length - 3}件</button>}
              </div>
            </article>
          );
        })}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button,input{font:inherit}.monthPage{max-width:1500px;margin:0 auto;padding:16px 12px 50px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top>div{display:flex;flex-direction:column}.top button,.monthNav button{border:1px solid #ccd7e5;background:white;color:#2674e8;border-radius:10px;padding:9px 12px;font-weight:800}
        .monthHero{background:white;border:1px solid #d9e0ea;border-radius:20px;padding:18px;display:flex;justify-content:space-between;gap:14px;align-items:center}.eyebrow{font-weight:900;color:#2674e8}.monthHero h1{margin:3px 0 4px;font-size:30px}.monthHero p{margin:0;color:#68778a}.monthNav{display:flex;gap:7px;flex-wrap:wrap}
        .weekdayRow,.monthGrid{display:grid;grid-template-columns:repeat(7,1fr)}.weekdayRow{margin-top:12px}.weekdayRow b{text-align:center;padding:7px}.monthGrid{border-left:1px solid #d9e0ea;border-top:1px solid #d9e0ea;background:white}.dayCell{min-height:180px;border-right:1px solid #d9e0ea;border-bottom:1px solid #d9e0ea;padding:6px;background:white}.dayCell.blank{background:#f7f9fc}.dayCell.today{box-shadow:inset 0 0 0 3px #2674e8}.dayCell.closed{background:#f8f8f8}.dayHead{width:100%;display:flex;justify-content:space-between;border:0;background:transparent;padding:2px 3px;color:#172033}.dayHead b{font-size:17px}.dayHead span{font-size:10px;color:#68778a}.closedLabel{display:block;color:#a24a4a;font-weight:800;margin:1px 3px 4px}
        .monthRows{display:grid;gap:4px}.monthRow{border:1px solid #d8e0e9;border-radius:8px;padding:5px;text-align:left;background:white;min-width:0}.monthRow.reason-check{background:#edf6ff}.monthRow.reason-repair{background:#fff8cc}.monthRow.reason-body{background:white}.monthRow.reason-shaken{background:#ffe9e7}.monthRow.overlapping{border:2px solid #d73535}.customer{display:block;font-size:10px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.identity{display:flex;justify-content:space-between;align-items:center;gap:3px;margin-top:2px}.vehicle{display:flex;flex-direction:column;min-width:0}.vehicle>b{font-size:9px}.vehicle>small{font-size:6px;line-height:1;color:#5f6c7c}.time{display:flex;align-items:center;gap:2px;white-space:nowrap}.time em{font-style:normal;font-size:7px;font-weight:900}.time b{font-size:9px}.overlapTag{display:inline-block;color:#b42318;font-weight:900;font-size:7px}.more{border:0;background:#f4f7fb;color:#2674e8;border-radius:7px;padding:5px;font-weight:800;font-size:9px}
        @media(max-width:700px){.monthPage{padding:8px 4px 35px}.top{padding:0 4px}.monthHero{padding:12px;display:block}.monthHero h1{font-size:22px}.monthNav{margin-top:9px}.monthNav button{padding:7px 8px;font-size:11px}.weekdayRow b{font-size:10px;padding:4px 0}.dayCell{min-height:92px;padding:2px}.dayHead{padding:1px}.dayHead b{font-size:12px}.dayHead span{font-size:7px}.closedLabel{font-size:7px}.monthRows{gap:2px}.monthRows .monthRow:nth-child(n+3){display:none}.monthRow{padding:3px;border-radius:5px}.customer{font-size:7px}.vehicle>b{font-size:7px}.vehicle>small{font-size:5px}.time em{font-size:5px}.time b{font-size:6px}.more{font-size:6px;padding:2px}}
      `}</style>
    </main>
  );
}
