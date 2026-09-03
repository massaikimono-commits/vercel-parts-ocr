/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { dailyReportTimeLabel, prepareDailyReportSection } from "../print-rules";
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

type EnrichedWeekRow = {
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

function isMorningJst(value: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(value)));
  return Number.isFinite(hour) && hour < 12;
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
  const [message, setMessage] = useState("1週間のスケジュールを読み込みます。");
  const [attentionOnly, setAttentionOnly] = useState(false);

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
    setMessage("1週間のスケジュールを読み込み中…");
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
      setMessage(safeActionError("週間予定の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  const workMap = useMemo(() => new Map(works.map((x) => [x.id, x])), [works]);
  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);

  const rowsByDay = useMemo(() => {
    const out: Record<string, EnrichedWeekRow[]> = Object.fromEntries(weekDays.map((day) => [day, []]));

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

  function prepareWeekDaySection(rows: EnrichedWeekRow[], period: "morning" | "afternoon") {
    const periodRows = rows.filter(({ entry }) => period === "morning" ? isMorningJst(entry.starts_at) : !isMorningJst(entry.starts_at));
    const rowMap = new Map(periodRows.map((row) => [row.entry.id, row]));
    const prepared = prepareDailyReportSection(periodRows.map((row) => row.entry), period);
    return {
      deliveries: prepared.deliveries.map((entry) => rowMap.get(entry.id)).filter(Boolean) as EnrichedWeekRow[],
      inbound: prepared.inbound.map((entry) => rowMap.get(entry.id)).filter(Boolean) as EnrichedWeekRow[],
    };
  }

  function miniWeekRow(row: EnrichedWeekRow, overlapIds: Set<string>) {
    const { entry, work, vehicle, customer } = row;
    const reasonClass = work?.reason === "車検"
      ? "reason-shaken"
      : work?.reason === "点検"
        ? "reason-check"
        : work?.reason === "一般整備"
          ? "reason-repair"
          : work?.reason === "板金塗装"
            ? "reason-body"
            : "reason-none";
    const entryLabel = ENTRY_LABEL[entry.entry_type];
    return (
      <button
        type="button"
        className={`miniRow ${reasonClass} ${work?.is_urgent ? "urgent" : ""} ${overlapIds.has(entry.id) ? "overlapping" : ""}`}
        key={entry.id}
        onClick={() => editEntry(entry.id)}
        aria-label={`${customerName(customer)}の予約を変更`}
      >
        <div className="miniTop"><b>{dailyReportTimeLabel(entry)}</b>{entryLabel && <span>{entryLabel}</span>}</div>
        <div className="miniCustomer">{customerName(customer)}</div>
        <div className="miniMeta">
          {last4(vehicle) && <span>{last4(vehicle)}</span>}
          {work?.reason && <span>{work.reason}</span>}
          {work?.worker_name && <span>{work.worker_name}</span>}
          {work?.needs_loaner && <span className="loaner">代車</span>}
          {work?.is_urgent && <span className="urgentTag">急ぎ</span>}
          {overlapIds.has(entry.id) && <span className="overlapTag">重複</span>}
        </div>
      </button>
    );
  }

  function overlapInfo(dayRows: Array<{entry: ScheduleEntry}>) {
    let count = 0;
    const ids = new Set<string>();
    for (let i = 0; i < dayRows.length; i += 1) {
      for (let j = i + 1; j < dayRows.length; j += 1) {
        const a = dayRows[i].entry;
        const b = dayRows[j].entry;
        if (a.print_time_mode !== "exact" || b.print_time_mode !== "exact") continue;
        if (a.entry_type !== b.entry_type) continue;
        if (new Date(a.starts_at) < new Date(b.ends_at) && new Date(a.ends_at) > new Date(b.starts_at)) {
          count += 1;
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return { count, ids };
  }

  function capacitySummary(day: string) {
    const c = capacities[day];
    const cal = calendar[day];
    if (cal && !cal.is_business_day) {
      return { className: "closed", label: "休業日", detail: cal.label || "" };
    }
    if (!c) return { className: "unknown", label: "空き確認中", detail: "" };

    const morningRaw = c.morning_total_limit - c.morning_count;
    const afternoonRaw = c.afternoon_total_limit - c.afternoon_count;
    const inspectionRaw = c.morning_inspection_warning - c.morning_inspection_count;
    const over = Math.max(0, -morningRaw) + Math.max(0, -afternoonRaw);
    const inspectionOver = Math.max(0, -inspectionRaw);
    const morning = Math.max(0, morningRaw);
    const afternoon = Math.max(0, afternoonRaw);
    const inspection = Math.max(0, inspectionRaw);
    const total = morning + afternoon;

    if (over > 0 || inspectionOver > 0) {
      const overParts = [
        morningRaw < 0 ? `午前 +${-morningRaw}` : null,
        afternoonRaw < 0 ? `午後 +${-afternoonRaw}` : null,
        inspectionRaw < 0 ? `車検午前 +${-inspectionRaw}` : null,
      ].filter(Boolean).join("　");
      return {
        className: "over",
        label: "⚠ 取りすぎ",
        detail: `${overParts}　残り 午前${morning} / 午後${afternoon} / 車検午前${inspection}`,
      };
    }

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

  function editEntry(id: string) {
    location.assign("/schedule/edit?id=" + encodeURIComponent(id));
  }

  function jumpToWeek() {
    if (!jumpDay) return;
    setWeekStart(mondayOf(jumpDay));
  }

  const weekStats = useMemo(() => {
    let overlapDays = 0;
    let overbookedDays = 0;
    let morningRemaining = 0;
    let afternoonRemaining = 0;
    let inspectionRemaining = 0;
    let unknownDays = 0;

    for (const day of weekDays) {
      const cal = calendar[day];
      if (cal && !cal.is_business_day) continue;
      if (overlapInfo(rowsByDay[day] || []).count > 0) overlapDays += 1;

      const c = capacities[day];
      if (!c) {
        unknownDays += 1;
        continue;
      }

      const morningRaw = c.morning_total_limit - c.morning_count;
      const afternoonRaw = c.afternoon_total_limit - c.afternoon_count;
      const inspectionRaw = c.morning_inspection_warning - c.morning_inspection_count;
      if (morningRaw < 0 || afternoonRaw < 0 || inspectionRaw < 0) overbookedDays += 1;
      morningRemaining += Math.max(0, morningRaw);
      afternoonRemaining += Math.max(0, afternoonRaw);
      inspectionRemaining += Math.max(0, inspectionRaw);
    }

    return { overlapDays, overbookedDays, morningRemaining, afternoonRemaining, inspectionRemaining, unknownDays };
  }, [weekDays, rowsByDay, capacities, calendar]);

  const attentionDays = useMemo(() => {
    return weekDays.filter((day) => {
      const cal = calendar[day];
      if (cal && !cal.is_business_day) return false;
      const overlap = overlapInfo(rowsByDay[day] || []).count > 0;
      const capacityClass = capacitySummary(day).className;
      return overlap || capacityClass === "over" || capacityClass === "full" || capacityClass === "tight";
    });
  }, [weekDays, rowsByDay, capacities, calendar]);

  const visibleWeekDays = attentionOnly ? attentionDays : weekDays;
  const firstAttentionDay = attentionDays[0] || null;

  return (
    <main className="weekPage">
      <header className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <div><b>スケジュール</b><span>1週間表示</span></div>
        <strong>icb</strong>
      </header>

      <section className="weekHero">
        <div>
          <div className="eyebrow">1週間のスケジュール</div>
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

      <section className="weekSummary" aria-label="週間予定サマリー">
        <div><span>週間予定</span><b>{entries.length}件</b></div>
        <div className={weekStats.overlapDays > 0 ? "summaryWarn" : ""}><span>時間重複</span><b>{weekStats.overlapDays}日</b></div>
        <div className={weekStats.overbookedDays > 0 ? "summaryDanger" : ""}><span>取りすぎ</span><b>{weekStats.overbookedDays}日</b></div>
        <div><span>週間の残り枠</span><b>午前 {weekStats.morningRemaining} / 午後 {weekStats.afternoonRemaining}</b><small>車検午前 {weekStats.inspectionRemaining}{weekStats.unknownDays > 0 ? `　未確認 ${weekStats.unknownDays}日` : ""}</small></div>
      </section>

      <section className="attentionBar" aria-label="週間予定の要確認日">
        <div>
          <b>要確認 {attentionDays.length}日</b>
          <span>時間重複・取りすぎ・上限・残り少のある日だけ確認できます。</span>
        </div>
        <div className="attentionActions">
          <button
            className={attentionOnly ? "activeFilter" : ""}
            onClick={() => setAttentionOnly((value) => !value)}
            disabled={busy}
          >
            {attentionOnly ? "7日すべて表示" : "要確認日のみ表示"}
          </button>
          <button onClick={() => firstAttentionDay && openDay(firstAttentionDay)} disabled={!firstAttentionDay || busy}>
            最初の要確認日を開く
          </button>
        </div>
      </section>

      <section className={`weekBoard ${attentionOnly ? "attentionOnly" : ""}`}>
        {attentionOnly && visibleWeekDays.length === 0 && (
          <div className="noAttention">この週は時間重複・取りすぎ・上限・残り少の要確認日はありません。</div>
        )}
        {visibleWeekDays.map((day) => {
          const dayRows = rowsByDay[day] || [];
          const cap = capacitySummary(day);
          const overlap = overlapInfo(dayRows);
          const morningReport = prepareWeekDaySection(dayRows, "morning");
          const afternoonReport = prepareWeekDaySection(dayRows, "afternoon");
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
              {overlap.count > 0 && <div className="overlapWarn">⚠ 同一区分の時間重複 {overlap.count}件</div>}

              <div className="dailyMiniReport">
                {!dayRows.length && <div className="empty">予定なし</div>}
                {dayRows.length > 0 && (
                  <>
                    <section className="miniPeriod">
                      <div className="miniPeriodTitle">午前</div>
                      <div className="miniColumns">
                        <div className="miniColumn deliveryMini">
                          <div className="miniColumnTitle">納車</div>
                          {!morningReport.deliveries.length && <div className="miniEmpty">—</div>}
                          {morningReport.deliveries.map((row) => miniWeekRow(row, overlap.ids))}
                        </div>
                        <div className="miniColumn inboundMini">
                          <div className="miniColumnTitle">入庫</div>
                          {!morningReport.inbound.length && <div className="miniEmpty">—</div>}
                          {morningReport.inbound.map((row) => miniWeekRow(row, overlap.ids))}
                        </div>
                      </div>
                    </section>
                    <section className="miniPeriod afternoonMini">
                      <div className="miniPeriodTitle">午後</div>
                      <div className="miniColumns">
                        <div className="miniColumn deliveryMini">
                          <div className="miniColumnTitle">納車</div>
                          {!afternoonReport.deliveries.length && <div className="miniEmpty">—</div>}
                          {afternoonReport.deliveries.map((row) => miniWeekRow(row, overlap.ids))}
                        </div>
                        <div className="miniColumn inboundMini">
                          <div className="miniColumnTitle">入庫</div>
                          {!afternoonReport.inbound.length && <div className="miniEmpty">—</div>}
                          {afternoonReport.inbound.map((row) => miniWeekRow(row, overlap.ids))}
                        </div>
                      </div>
                    </section>
                  </>
                )}
              </div>

              <div className="dayActions">
                <button onClick={() => openDay(day)}>1日を見る</button>
                <button className="register" onClick={() => registerDay(day)}>＋ 予定登録</button>
              </div>
            </article>
          );
        })}
      </section>

      <div className="hint">横にスクロールすると1週間を続けて確認できます。上部サマリーと「要確認日のみ表示」で問題日を先に確認でき、予約カードをタップすると空き確認付きの予約変更へ直接進めます。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}
        .weekPage{max-width:1600px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top>div span{font-size:12px;color:#78869a}.top button,.weekNav button,.jumpBar button,.dayActions button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .weekHero{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:18px 20px;display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:10px}.eyebrow{color:#2674e8;font-weight:800}.weekHero h1{font-size:28px;margin:3px 0}.weekHero p{margin:0;color:#6d798a}.weekNav{display:flex;gap:7px;flex-wrap:wrap}
        .jumpBar{display:flex;gap:8px;align-items:end;background:#fff;border:1px solid #d9e0ea;border-radius:16px;padding:11px 14px;margin-bottom:10px}.jumpBar label{display:grid;gap:4px;font-size:12px;font-weight:800;color:#637084}.jumpBar input{border:1px solid #cbd6e3;border-radius:9px;padding:8px 10px;background:#fff}
        .weekSummary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.weekSummary>div{background:#fff;border:1px solid #d9e0ea;border-radius:13px;padding:10px 12px;display:grid;gap:2px}.weekSummary span{font-size:11px;color:#68768a;font-weight:800}.weekSummary b{font-size:17px}.weekSummary small{font-size:10px;color:#68768a}.weekSummary .summaryWarn{background:#fff7e8;border-color:#edc780}.weekSummary .summaryDanger{background:#ffecec;border-color:#efaaaa;color:#9f2525}
        .attentionBar{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:10px 12px;margin-bottom:10px}.attentionBar>div:first-child{display:grid;gap:2px}.attentionBar span{font-size:11px;color:#68768a}.attentionActions{display:flex;gap:7px;flex-wrap:wrap}.attentionActions button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:10px;padding:8px 10px;font-weight:800}.attentionActions .activeFilter{background:#2674e8;color:#fff;border-color:#2674e8}.attentionActions button:disabled{opacity:.45}.noAttention{grid-column:1/-1;background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:24px;text-align:center;color:#68768a}.weekBoard{display:grid;grid-template-columns:repeat(7,minmax(260px,1fr));gap:8px;align-items:stretch;overflow-x:auto;padding-bottom:6px}.weekBoard.attentionOnly{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));overflow-x:visible}.dayColumn{min-width:260px;background:#fff;border:1px solid #d9e0ea;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;min-height:590px}.dayColumn.today{outline:3px solid #2674e8;outline-offset:-2px}.dayColumn.dayClosed{background:#f5f6f8}
        .dayHead{border:0;background:#f7f9fc;padding:11px 10px;display:flex;justify-content:space-between;align-items:center;width:100%;font-weight:900;color:#172033}.dayHead span{font-size:16px}.dayHead b{font-size:12px;background:#e8eef7;border-radius:999px;padding:3px 7px}
        .availability{margin:8px;border-radius:10px;padding:8px;display:grid;gap:2px}.availability b{font-size:13px}.availability small{font-size:10px;line-height:1.45}.availability.open{background:#edf8f0;color:#236c3b}.availability.tight{background:#fff7e8;color:#8a5a08}.availability.full{background:#fdeeee;color:#9c3434}.availability.over{background:#ffe7e7;color:#a32121;border:2px solid #ef9a9a}.availability.closed{background:#eceff3;color:#657180}.availability.unknown{background:#f4f6f8;color:#798596}.overlapWarn{margin:0 8px 8px;background:#fff0db;color:#8b5609;border-radius:9px;padding:7px;font-size:10px;font-weight:900}
        .dailyMiniReport{padding:0 7px 7px;display:grid;gap:7px;align-content:start;flex:1}.miniPeriod{border:1px solid #e4e9f1;border-radius:10px;overflow:hidden;background:#fbfcfe}.miniPeriodTitle{font-size:10px;font-weight:900;padding:4px 6px;background:#eef3f9;color:#526174}.afternoonMini .miniPeriodTitle{background:#f5f0fb}.miniColumns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1px;background:#e5eaf1}.miniColumn{min-width:0;background:#fff;padding:4px;display:grid;gap:4px;align-content:start}.miniColumnTitle{font-size:8px;font-weight:900;color:#657180;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.miniEmpty{font-size:10px;color:#a0a8b3;text-align:center;padding:7px 2px}.miniRow{border:1px solid #e0e6ef;border-radius:7px;padding:5px;background:#fff;width:100%;color:inherit;text-align:left;cursor:pointer;min-width:0}.miniRow.reason-shaken{background:#fff0f0;border-color:#e99a9a}.miniRow.reason-check{background:#eef5ff;border-color:#9dbce8}.miniRow.reason-repair{background:#fff8d8;border-color:#e4cd67}.miniRow.reason-body{background:#fff;border-color:#cfd8e3}.miniRow:hover,.miniRow:focus-visible{border-color:#8eb5ef;box-shadow:0 0 0 2px rgba(38,116,232,.12);outline:none}.miniRow.urgent{border-color:#e8aa58;box-shadow:inset 2px 0 0 #e8aa58}.miniRow.overlapping{border-color:#e58b8b;background:#fff8f8}.miniTop{display:flex;justify-content:space-between;gap:3px;align-items:center}.miniTop b{font-size:10px;white-space:nowrap}.miniTop span{font-size:8px;color:#5c6878;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.miniCustomer{font-weight:900;font-size:11px;margin-top:2px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.miniMeta{display:flex;gap:2px;flex-wrap:wrap;margin-top:3px}.miniMeta span{font-size:7px;background:#f1f4f8;border-radius:999px;padding:2px 3px;white-space:nowrap}.miniMeta .loaner{background:#eaf3ff;color:#245ca8}.miniMeta .urgentTag{background:#fff0db;color:#995b00}.miniMeta .overlapTag{background:#ffe7e7;color:#a32121;font-weight:900}.empty{padding:18px 5px;text-align:center;color:#94a0af;font-size:12px}
        .dayActions{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:8px;border-top:1px solid #edf0f4}.dayActions button{font-size:10px;padding:7px 5px}.dayActions .register{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.hint{font-size:12px;color:#78869a;margin-top:8px}
        @media(max-width:900px){.weekHero{display:block}.weekNav{margin-top:12px}.weekSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.attentionBar{display:grid}.weekBoard{grid-template-columns:repeat(7,minmax(88vw,88vw));scroll-snap-type:x mandatory;gap:10px}.weekBoard.attentionOnly{grid-template-columns:repeat(auto-fit,minmax(88vw,1fr))}.dayColumn{min-width:88vw;min-height:0;scroll-snap-align:start}.dailyMiniReport{padding:0 7px 7px}.miniColumnTitle{font-size:9px}.miniCustomer{font-size:12px}.miniTop b{font-size:11px}.miniTop span{font-size:9px}.miniMeta span{font-size:8px}}
      `}</style>
    </main>
  );
}
