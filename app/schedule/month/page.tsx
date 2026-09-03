/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { dailyReportTimeLabel } from "../print-rules";

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
  status: string;
  work_completed: boolean;
  is_urgent: boolean;
  needs_loaner: boolean;
  worker_name: string | null;
  outsource_vendor_name: string | null;
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

const ENTRY_LABEL: Record<ScheduleEntry["entry_type"], string> = {
  delivery: "納車",
  pickup: "引取",
  customer_visit: "来社",
  onsite_repair: "出張",
};

const REASON_ORDER: Record<string, number> = {
  "点検": 0,
  "一般整備": 1,
  "板金塗装": 2,
  "車検": 3,
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthFromDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : "";
}

function monthStart(month: string) {
  return month + "-01";
}

function addMonths(month: string, delta: number) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

function daysInMonth(month: string) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.getUTCDate();
}

function jstIso(day: string) {
  return new Date(day + "T00:00:00+09:00").toISOString();
}

function dateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function monthTitle(month: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(new Date(month + "-01T00:00:00Z"));
}

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(day + "T00:00:00Z"));
}

export default function MonthlySchedulePage() {
  const [month, setMonth] = useState(() => todayJst().slice(0, 7));
  const [jumpMonth, setJumpMonth] = useState(() => todayJst().slice(0, 7));
  const [initialized, setInitialized] = useState(false);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [calendar, setCalendar] = useState<Record<string, CalendarDay>>({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("1か月の予定を読み込みます。");

  const monthDays = useMemo(
    () => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
    [month]
  );
  const leadingBlanks = useMemo(
    () => new Date(monthStart(month) + "T00:00:00Z").getUTCDay(),
    [month]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const day = params.get("day") || "";
    const requestedMonth = params.get("month") || monthFromDay(day);
    if (/^\d{4}-\d{2}$/.test(requestedMonth)) {
      setMonth(requestedMonth);
      setJumpMonth(requestedMonth);
    }
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void loadMonth();
  }, [initialized, month]);

  async function loadMonth() {
    setBusy(true);
    setMessage("1か月の予定を読み込み中…");
    const start = monthStart(month);
    const next = monthStart(addMonths(month, 1));
    const last = monthDays[monthDays.length - 1] || start;

    try {
      const [entryRes, calendarRes] = await Promise.all([
        supabase
          .from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode,print_time_label_override")
          .gte("starts_at", jstIso(start))
          .lt("starts_at", jstIso(next))
          .order("starts_at", { ascending: true }),
        supabase
          .from("business_calendar")
          .select("business_date,is_business_day,label")
          .gte("business_date", start)
          .lte("business_date", last),
      ]);
      if (entryRes.error) throw entryRes.error;
      if (calendarRes.error) throw calendarRes.error;

      const nextEntries = (entryRes.data || []) as ScheduleEntry[];
      const workIds = [...new Set(nextEntries.map((entry) => entry.work_order_id).filter(Boolean))] as string[];
      let nextWorks: WorkOrder[] = [];
      if (workIds.length) {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id,vehicle_id,reason,status,work_completed,is_urgent,needs_loaner,worker_name,outsource_vendor_name")
          .in("id", workIds);
        if (error) throw error;
        nextWorks = (data || []) as WorkOrder[];
      }

      const vehicleIds = [...new Set([
        ...nextEntries.map((entry) => entry.vehicle_id).filter(Boolean),
        ...nextWorks.map((work) => work.vehicle_id).filter(Boolean),
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

      const customerIds = [...new Set(nextVehicles.map((vehicle) => vehicle.customer_id).filter(Boolean))] as string[];
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
      setCalendar(Object.fromEntries(((calendarRes.data || []) as CalendarDay[]).map((row) => [row.business_date, row])));
      setMessage(`${monthTitle(month)}の予定を表示しています。`);
    } catch (error: any) {
      setEntries([]);
      setWorks([]);
      setVehicles([]);
      setCustomers([]);
      setCalendar({});
      setMessage("月間予定の読み込みエラー: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  const workMap = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const vehicleMap = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);

  const rowsByDay = useMemo(() => {
    const out: Record<string, Array<{
      entry: ScheduleEntry;
      work: WorkOrder | null;
      vehicle: Vehicle | null;
      customer: Customer | null;
    }>> = Object.fromEntries(monthDays.map((day) => [day, []]));

    for (const entry of entries) {
      const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
      const vehicleId = entry.vehicle_id || work?.vehicle_id || null;
      const vehicle = vehicleId ? vehicleMap.get(vehicleId) || null : null;
      const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
      const day = dateKey(entry.starts_at);
      if (out[day]) out[day].push({ entry, work, vehicle, customer });
    }

    for (const day of monthDays) {
      out[day].sort((a, b) => {
        const reasonDiff = (REASON_ORDER[a.work?.reason || ""] ?? 99) - (REASON_ORDER[b.work?.reason || ""] ?? 99);
        if (reasonDiff) return reasonDiff;
        return new Date(a.entry.starts_at).getTime() - new Date(b.entry.starts_at).getTime();
      });
    }
    return out;
  }, [entries, workMap, vehicleMap, customerMap, monthDays]);

  function customerName(customer: Customer | null) {
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "未登録";
  }

  function last4(vehicle: Vehicle | null) {
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "";
  }

  function reasonClass(work: WorkOrder | null) {
    if (!work) return "";
    if (work.reason === "車検") return "reasonShaken";
    if (work.reason === "点検") return "reasonInspection";
    if (work.reason === "一般整備" && work.outsource_vendor_name) return "reasonOutsourced";
    if (work.reason === "一般整備") return "reasonGeneral";
    if (work.reason === "板金塗装") return "reasonBodywork";
    return "";
  }

  function workState(work: WorkOrder | null) {
    if (!work) return "";
    if (work.work_completed || work.status === "completed") return "完了";
    if (work.status === "in_progress") return "作業中";
    return "未実施";
  }

  function openDay(day: string) {
    location.assign("/schedule?day=" + day);
  }

  function jump() {
    if (!/^\d{4}-\d{2}$/.test(jumpMonth)) return;
    setMonth(jumpMonth);
  }

  return (
    <main className="monthPage">
      <header className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <div><b>予定検索</b><span>1か月表示</span></div>
        <strong>icb</strong>
      </header>

      <section className="monthHero">
        <div>
          <div className="eyebrow">月間予定</div>
          <h1>{monthTitle(month)}</h1>
          <p>{busy ? "読み込み中…" : message}</p>
        </div>
        <div className="monthNav">
          <button onClick={() => setMonth(addMonths(month, -1))}>← 前月</button>
          <button onClick={() => setMonth(todayJst().slice(0, 7))}>今月</button>
          <button onClick={() => setMonth(addMonths(month, 1))}>翌月 →</button>
        </div>
      </section>

      <section className="monthTools">
        <label>月を選択
          <input type="month" value={jumpMonth} onChange={(event) => setJumpMonth(event.target.value)} />
        </label>
        <button onClick={jump}>この月を見る</button>
        <button onClick={() => location.assign("/schedule/week?day=" + monthStart(month))}>週間予定へ</button>
      </section>

      <section className="monthSummary">
        <div><span>月間予定</span><b>{entries.length}件</b></div>
        <div><span>営業日</span><b>{monthDays.filter((day) => calendar[day]?.is_business_day !== false).length}日</b></div>
        <div><span>休業日</span><b>{monthDays.filter((day) => calendar[day]?.is_business_day === false).length}日</b></div>
      </section>

      <div className="weekdayHeader" aria-hidden="true">
        {["日","月","火","水","木","金","土"].map((label) => <div key={label}>{label}</div>)}
      </div>

      <section className="monthGrid">
        {Array.from({ length: leadingBlanks }, (_, i) => <div className="blankDay" key={"blank-" + i} />)}
        {monthDays.map((day) => {
          const rows = rowsByDay[day] || [];
          const cal = calendar[day];
          const isToday = day === todayJst();
          return (
            <button
              type="button"
              className={`dayCard ${isToday ? "today" : ""} ${cal && !cal.is_business_day ? "closed" : ""}`}
              key={day}
              onClick={() => openDay(day)}
            >
              <div className="dayHead">
                <div>
                  <b>{dayLabel(day)}</b>
                  {cal && !cal.is_business_day && <small>{cal.label || "休業日"}</small>}
                </div>
                <strong>{rows.length}件</strong>
              </div>

              <div className="dayEntries">
                {rows.slice(0, 5).map(({ entry, work, vehicle, customer }, index) => (
                  <div className={`monthEntry ${reasonClass(work)} ${index >= 3 ? "mobileExtra" : ""}`} key={entry.id}>
                    <div className="entryTop">
                      <b>{dailyReportTimeLabel(entry)}</b>
                      <span>{work?.reason || ENTRY_LABEL[entry.entry_type]}</span>
                    </div>
                    <div className="entryCustomer">{customerName(customer)}</div>
                    <div className="entryMeta">
                      {last4(vehicle) && <span>{last4(vehicle)}</span>}
                      <span>{ENTRY_LABEL[entry.entry_type]}</span>
                      {workState(work) && <span>{workState(work)}</span>}
                      {work?.outsource_vendor_name && <span>外注</span>}
                    </div>
                  </div>
                ))}
                {!rows.length && <div className="emptyDay">予定なし</div>}
                {rows.length > 5 && <div className="more desktopMore">＋{rows.length - 5}件</div>}
                {rows.length > 3 && <div className="more mobileMore">＋{rows.length - 3}件</div>}
              </div>
            </button>
          );
        })}
      </section>

      <div className="hint">日付をタップするとその日の「1日の予定」を開きます。並びは 点検 → 一般整備 → 板金 → 車検、色は 点検=青・車検=赤・一般整備(自社)=黄・外注/板金=白 です。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}
        .monthPage{max-width:1500px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top>div{display:grid;text-align:center}.top>div span{font-size:12px;color:#78869a}.top button,.monthNav button,.monthTools button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .monthHero{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:18px 20px;display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:10px}.eyebrow{color:#2674e8;font-weight:800}.monthHero h1{font-size:28px;margin:3px 0}.monthHero p{margin:0;color:#6d798a}.monthNav{display:flex;gap:7px;flex-wrap:wrap}
        .monthTools{display:flex;gap:8px;align-items:end;background:#fff;border:1px solid #d9e0ea;border-radius:16px;padding:11px 14px;margin-bottom:10px}.monthTools label{display:grid;gap:4px;font-size:12px;font-weight:800;color:#637084}.monthTools input{border:1px solid #cbd6e3;border-radius:9px;padding:8px 10px;background:#fff}
        .monthSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.monthSummary>div{background:#fff;border:1px solid #d9e0ea;border-radius:13px;padding:10px 12px;display:grid}.monthSummary span{font-size:11px;color:#68768a;font-weight:800}.monthSummary b{font-size:19px}
        .weekdayHeader{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-bottom:5px}.weekdayHeader>div{text-align:center;color:#657184;font-size:11px;font-weight:900}
        .monthGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.blankDay{min-height:160px}.dayCard{min-width:0;min-height:180px;border:1px solid #d9e0ea;border-radius:13px;background:#fff;padding:8px;color:inherit;text-align:left;display:grid;align-content:start;gap:7px;cursor:pointer}.dayCard:hover,.dayCard:focus-visible{border-color:#8eb5ef;box-shadow:0 0 0 2px rgba(38,116,232,.12);outline:none}.dayCard.today{outline:3px solid #2674e8;outline-offset:-2px}.dayCard.closed{background:#f4f5f7}.dayHead{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}.dayHead>div{display:grid}.dayHead b{font-size:13px}.dayHead small{font-size:9px;color:#8b5e17}.dayHead strong{font-size:11px;background:#edf2f8;border-radius:999px;padding:3px 6px}
        .dayEntries{display:grid;gap:4px}.monthEntry{border:1px solid #e2e7ef;border-radius:8px;padding:5px 6px;background:#fff;min-width:0}.monthEntry.reasonShaken{background:#fff5f5;border-left:4px solid #d94b4b}.monthEntry.reasonInspection{background:#f3f8ff;border-left:4px solid #4a86d9}.monthEntry.reasonGeneral{background:#fffbe8;border-left:4px solid #e0b316}.monthEntry.reasonOutsourced,.monthEntry.reasonBodywork{background:#fff;border-left:4px solid #fff;box-shadow:inset 0 0 0 1px #d9e0ea}.entryTop{display:flex;justify-content:space-between;gap:4px;align-items:center}.entryTop b{font-size:10px}.entryTop span{font-size:9px;font-weight:800;color:#586576;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.entryCustomer{font-size:11px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.entryMeta{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}.entryMeta span{font-size:8px;border-radius:999px;background:#eef2f6;padding:2px 4px}.emptyDay{color:#9aa5b3;font-size:10px;padding:8px 2px}.more{font-size:9px;color:#2674e8;font-weight:900;text-align:right}.mobileMore{display:none}.hint{font-size:12px;color:#78869a;margin-top:9px}
        @media(max-width:720px){.monthPage{padding:10px 8px 40px}.monthHero{display:block;padding:13px}.monthHero h1{font-size:22px}.monthNav{margin-top:10px}.monthTools{display:grid;grid-template-columns:1fr 1fr}.monthTools label{grid-column:1/-1}.monthSummary{grid-template-columns:repeat(3,1fr)}.monthSummary>div{padding:8px}.monthSummary b{font-size:16px}.weekdayHeader,.blankDay{display:none}.monthGrid{grid-template-columns:1fr;gap:7px}.dayCard{min-height:0;padding:9px}.dayHead b{font-size:14px}.dayEntries{gap:4px}.monthEntry{padding:6px 7px}.monthEntry.mobileExtra{display:none}.desktopMore{display:none}.mobileMore{display:block}.entryCustomer{font-size:12px}.entryTop b{font-size:11px}.entryTop span{font-size:10px}}
      `}</style>
    </main>
  );
}
