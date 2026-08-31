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

type Capacity = {
  morning_count: number;
  afternoon_count: number;
  morning_inspection_count: number;
  morning_total_limit: number;
  afternoon_total_limit: number;
  morning_inspection_warning: number;
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

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(day: string, delta: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function mondayOf(day: string) {
  const d = new Date(day + "T00:00:00Z");
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDays(day, delta);
}

function jstIso(day: string, end = false) {
  return new Date(day + (end ? "T23:59:59.999+09:00" : "T00:00:00+09:00")).toISOString();
}

function dateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function dayTitle(day: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(day + "T00:00:00Z"));
}

function weekTitle(start: string) {
  const end = addDays(start, 6);
  const fmt = (day: string) => new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
  }).format(new Date(day + "T00:00:00Z"));
  return fmt(start) + " 〜 " + fmt(end);
}

export default function WeeklySchedulePage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayJst()));
  const [jumpDay, setJumpDay] = useState(todayJst());
  const [initialized, setInitialized] = useState(false);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [capacities, setCapacities] = useState<Record<string, Capacity | null>>({});
  const [calendar, setCalendar] = useState<Record<string, CalendarDay>>({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("1週間の予定を読み込みます。");

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
      setJumpDay(q);
      setWeekStart(mondayOf(q));
    }
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void loadWeek();
  }, [initialized, weekStart]);

  async function loadWeek() {
    setBusy(true);
    setMessage("1週間の予定を読み込み中…");
    const endExclusive = addDays(weekStart, 7);

    try {
      const capacityPromise = Promise.all(weekDays.map(async (day) => {
        const { data, error } = await supabase.rpc("schedule_capacity", { p_day: day });
        if (error) return [day, null] as const;
        const row = Array.isArray(data) ? data[0] : data;
        return [day, (row || null) as Capacity | null] as const;
      }));

      const [entryRes, calendarRes, capacityRows] = await Promise.all([
        supabase
          .from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode,print_time_label_override")
          .gte("starts_at", jstIso(weekStart))
          .lt("starts_at", jstIso(endExclusive))
          .order("starts_at", { ascending: true }),
        supabase
          .from("business_calendar")
          .select("business_date,is_business_day,label")
          .gte("business_date", weekStart)
          .lte("business_date", addDays(weekStart, 6)),
        capacityPromise,
      ]);

      if (entryRes.error) throw entryRes.error;
      if (calendarRes.error) throw calendarRes.error;

      const nextEntries = (entryRes.data || []) as ScheduleEntry[];
      const workIds = [...new Set(nextEntries.map((x) => x.work_order_id).filter(Boolean))] as string[];

      let nextWorks: WorkOrder[] = [];
      if (workIds.length) {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id,vehicle_id,reason,status,work_completed,is_urgent,needs_loaner,worker_name")
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
      setCapacities(Object.fromEntries(capacityRows));
      setCalendar(Object.fromEntries(((calendarRes.data || []) as CalendarDay[]).map((x) => [x.business_date, x])));
      setMessage(weekTitle(weekStart) + " の予定を表示しています。");
    } catch (error: any) {
      setMessage("週間予定の読み込みエラー: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  const workMap = useMemo(() => new Map(works.map((x) => [x.id, x])), [works]);
  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);

  const rowsByDay = useMemo(() => {
    const out: Record<string, Array<{
      entry: ScheduleEntry;
      work: WorkOrder | null;
      vehicle: Vehicle | null;
      customer: Customer | null;
    }>> = Object.fromEntries(weekDays.map((day) => [day, []]));

    for (const entry of entries) {
      const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
      const vehicleId = entry.vehicle_id || work?.vehicle_id || null;
      const vehicle = vehicleId ? vehicleMap.get(vehicleId) || null : null;
      const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
      const key = dateKey(entry.starts_at);
      if (out[key]) out[key].push({ entry, work, vehicle, customer });
    }
    return out;
  }, [entries, workMap, vehicleMap, customerMap, weekDays]);

  function customerName(customer: Customer | null) {
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "未登録";
  }

  function last4(vehicle: Vehicle | null) {
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "";
  }

  function capacitySummary(day: string) {
    const c = capacities[day];
    const cal = calendar[day];
    if (cal && !cal.is_business_day) {
      return { className: "closed", label: "休業日", detail: cal.label || "" };
    }
    if (!c) return { className: "unknown", label: "空き確認中", detail: "" };

    const morning = Math.max(0, c.morning_total_limit - c.morning_count);
    const afternoon = Math.max(0, c.afternoon_total_limit - c.afternoon_count);
    const inspection = Math.max(0, c.morning_inspection_warning - c.morning_inspection_count);
    const total = morning + afternoon;
    const className = total === 0 ? "full" : total <= 3 ? "tight" : "open";
    const label = total === 0 ? "× 上限" : total <= 3 ? "△ 残り少" : "○ 空きあり";
    return {
      className,
      label,
      detail: `午前 残${morning}　午後 残${afternoon}　車検午前 残${inspection}`,
    };
  }

  function openDay(day: string) {
    location.assign("/schedule?day=" + day);
  }

  function registerDay(day: string) {
    location.assign("/schedule/new?day=" + day);
  }

  function jumpToWeek() {
    if (!jumpDay) return;
    setWeekStart(mondayOf(jumpDay));
  }

  return (
    <main className="weekPage">
      <header className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <div><b>予定検索</b><span>1週間表示</span></div>
        <strong>icb</strong>
      </header>

      <section className="weekHero">
        <div>
          <div className="eyebrow">週間予定検索</div>
          <h1>{weekTitle(weekStart)}</h1>
          <p>{busy ? "読み込み中…" : message}</p>
        </div>
        <div className="weekNav">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← 前週</button>
          <button onClick={() => setWeekStart(mondayOf(todayJst()))}>今週</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}>翌週 →</button>
        </div>
      </section>

      <section className="jumpBar">
        <label>日付から週を検索
          <input type="date" value={jumpDay} onChange={(e) => setJumpDay(e.target.value)} />
        </label>
        <button onClick={jumpToWeek}>この週を見る</button>
      </section>

      <section className="weekBoard">
        {weekDays.map((day) => {
          const dayRows = rowsByDay[day] || [];
          const cap = capacitySummary(day);
          const isToday = day === todayJst();
          return (
            <article key={day} className={`dayColumn ${isToday ? "today" : ""} ${cap.className === "closed" ? "dayClosed" : ""}`}>
              <button className="dayHead" onClick={() => openDay(day)}>
                <span>{dayTitle(day)}</span>
                <b>{dayRows.length}件</b>
              </button>

              <div className={`availability ${cap.className}`}>
                <b>{cap.label}</b>
                {cap.detail && <small>{cap.detail}</small>}
              </div>

              <div className="dayRows">
                {!dayRows.length && <div className="empty">予定なし</div>}
                {dayRows.map(({ entry, work, vehicle, customer }) => (
                  <div className={`weekRow ${work?.is_urgent ? "urgent" : ""}`} key={entry.id}>
                    <div className="rowTop">
                      <b>{dailyReportTimeLabel(entry)}</b>
                      <span>{ENTRY_LABEL[entry.entry_type]}{work?.reason ? "・" + work.reason : ""}</span>
                    </div>
                    <div className="rowCustomer">{customerName(customer)}</div>
                    <div className="rowMeta">
                      {last4(vehicle) && <span>{last4(vehicle)}</span>}
                      {work?.worker_name && <span>担当 {work.worker_name}</span>}
                      {work?.needs_loaner && <span className="loaner">代車</span>}
                      {work?.is_urgent && <span className="urgentTag">急ぎ</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="dayActions">
                <button onClick={() => openDay(day)}>1日を見る</button>
                <button className="register" onClick={() => registerDay(day)}>＋ 予定登録</button>
              </div>
            </article>
          );
        })}
      </section>

      <div className="hint">横にスクロールすると1週間を続けて確認できます。空き表示は現在の午前・午後の上限と車検午前枠から自動計算します。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}
        .weekPage{max-width:1600px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top>div span{font-size:12px;color:#78869a}.top button,.weekNav button,.jumpBar button,.dayActions button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .weekHero{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:18px 20px;display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:10px}.eyebrow{color:#2674e8;font-weight:800}.weekHero h1{font-size:28px;margin:3px 0}.weekHero p{margin:0;color:#6d798a}.weekNav{display:flex;gap:7px;flex-wrap:wrap}
        .jumpBar{display:flex;gap:8px;align-items:end;background:#fff;border:1px solid #d9e0ea;border-radius:16px;padding:11px 14px;margin-bottom:10px}.jumpBar label{display:grid;gap:4px;font-size:12px;font-weight:800;color:#637084}.jumpBar input{border:1px solid #cbd6e3;border-radius:9px;padding:8px 10px;background:#fff}
        .weekBoard{display:grid;grid-template-columns:repeat(7,minmax(170px,1fr));gap:8px;align-items:stretch;overflow-x:auto;padding-bottom:6px}.dayColumn{min-width:170px;background:#fff;border:1px solid #d9e0ea;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;min-height:590px}.dayColumn.today{outline:3px solid #2674e8;outline-offset:-2px}.dayColumn.dayClosed{background:#f5f6f8}
        .dayHead{border:0;background:#f7f9fc;padding:11px 10px;display:flex;justify-content:space-between;align-items:center;width:100%;font-weight:900;color:#172033}.dayHead span{font-size:16px}.dayHead b{font-size:12px;background:#e8eef7;border-radius:999px;padding:3px 7px}
        .availability{margin:8px;border-radius:10px;padding:8px;display:grid;gap:2px}.availability b{font-size:13px}.availability small{font-size:10px;line-height:1.45}.availability.open{background:#edf8f0;color:#236c3b}.availability.tight{background:#fff7e8;color:#8a5a08}.availability.full{background:#fdeeee;color:#9c3434}.availability.closed{background:#eceff3;color:#657180}.availability.unknown{background:#f4f6f8;color:#798596}
        .dayRows{padding:0 8px 8px;display:grid;gap:6px;align-content:start;flex:1}.weekRow{border:1px solid #e0e6ef;border-radius:10px;padding:8px;background:#fff}.weekRow.urgent{border-color:#e8aa58;box-shadow:inset 3px 0 0 #e8aa58}.rowTop{display:flex;justify-content:space-between;gap:5px;align-items:center}.rowTop b{font-size:14px}.rowTop span{font-size:11px;color:#5c6878;text-align:right}.rowCustomer{font-weight:900;font-size:14px;margin-top:4px;line-height:1.25}.rowMeta{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.rowMeta span{font-size:9px;background:#f1f4f8;border-radius:999px;padding:3px 5px}.rowMeta .loaner{background:#eaf3ff;color:#245ca8}.rowMeta .urgentTag{background:#fff0db;color:#995b00}.empty{padding:18px 5px;text-align:center;color:#94a0af;font-size:12px}
        .dayActions{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:8px;border-top:1px solid #edf0f4}.dayActions button{font-size:10px;padding:7px 5px}.dayActions .register{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.hint{font-size:12px;color:#78869a;margin-top:8px}
        @media(max-width:900px){.weekHero{display:block}.weekNav{margin-top:12px}.weekBoard{grid-template-columns:repeat(7,220px)}.dayColumn{min-width:220px;min-height:520px}}
      `}</style>
    </main>
  );
}
