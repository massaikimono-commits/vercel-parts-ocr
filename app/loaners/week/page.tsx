/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type DayBoard = {
  day: string;
  available: number;
  companyAvailable: number;
  rentalAvailable: number;
  companyActive: number;
  rentalActive: number;
  reserved: number;
  cancellationPending: number;
  demand: number;
  assignedDemand: number;
  unassignedDemand: number;
  shortage: number;
  unknownReturn: number;
  error?: string;
};

type LoanerNeedWork = {
  id: string;
  checked_in_at: string | null;
  planned_delivery_at: string | null;
  planned_delivery_date: string | null;
};

type NeedSchedule = {
  work_order_id: string | null;
  entry_type: string;
  starts_at: string;
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
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function dayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(day + "T00:00:00Z"));
}

function isAvailable(v: any) {
  return v?.operationalStatus === "active" && !(v?.reservations || []).some(
    (r: any) => r.status !== "returned" && r.status !== "cancelled"
  );
}

export default function WeeklyLoanerPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayJst()));
  const [rows, setRows] = useState<DayBoard[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("1週間の代車状況を読み込みます。");

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setWeekStart(mondayOf(q));
  }, []);

  useEffect(() => {
    void loadWeek();
  }, [weekStart]);

  async function loadWeek() {
    setBusy(true);
    setMessage("1週間の代車状況を読み込み中…");

    const weekEnd = days[days.length - 1];
    const demandPromise = (async () => {
      const demand = new Map<string, { workOrderIds: Set<string>; unknownReturn: number }>(
        days.map((day) => [day, { workOrderIds: new Set<string>(), unknownReturn: 0 }])
      );

      const { data: workData, error: workError } = await supabase
        .from("work_orders")
        .select("id,checked_in_at,planned_delivery_at,planned_delivery_date")
        .eq("needs_loaner", true)
        .is("checked_out_at", null)
        .neq("status", "cancelled")
        .limit(300);
      if (workError) throw workError;

      const works = (workData || []) as LoanerNeedWork[];
      if (!works.length) return demand;

      const { data: scheduleData, error: scheduleError } = await supabase
        .from("schedule_entries")
        .select("work_order_id,entry_type,starts_at")
        .in("work_order_id", works.map((work) => work.id))
        .order("starts_at", { ascending: true });
      if (scheduleError) throw scheduleError;

      const scheduleMap = new Map<string, NeedSchedule>();
      for (const entry of (scheduleData || []) as NeedSchedule[]) {
        if (!entry.work_order_id) continue;
        const current = scheduleMap.get(entry.work_order_id);
        if (!current || (current.entry_type === "delivery" && entry.entry_type !== "delivery")) {
          scheduleMap.set(entry.work_order_id, entry);
        }
      }

      for (const work of works) {
        const startValue = work.checked_in_at || scheduleMap.get(work.id)?.starts_at || null;
        if (!startValue) continue;
        const startDay = dayKey(startValue);
        const endDay = work.planned_delivery_at
          ? dayKey(work.planned_delivery_at)
          : work.planned_delivery_date;
        const effectiveStart = startDay < weekStart ? weekStart : startDay;
        const effectiveEnd = endDay
          ? (endDay > weekEnd ? weekEnd : endDay)
          : weekEnd;
        if (effectiveStart > weekEnd || effectiveEnd < weekStart) continue;

        for (let day = effectiveStart; day <= effectiveEnd; day = addDays(day, 1)) {
          const item = demand.get(day);
          if (!item) continue;
          item.workOrderIds.add(work.id);
          if (!endDay) item.unknownReturn += 1;
        }
      }

      return demand;
    })();

    const [boardRows, demandByDay] = await Promise.all([
      Promise.all(
        days.map(async (day) => {
        const { data, error } = await supabase.rpc("loaner_day_board", { p_day: day });
        if (error) {
          return {
            day,
            available: 0,
            companyAvailable: 0,
            rentalAvailable: 0,
            companyActive: 0,
            rentalActive: 0,
            reserved: 0,
            cancellationPending: 0,
            demand: 0,
            assignedDemand: 0,
            unassignedDemand: 0,
            shortage: 0,
            unknownReturn: 0,
            error: error.message,
          } as DayBoard;
        }

        const vehicles = (data?.vehicles || []) as any[];
        const counts = data?.counts || {};
        const companyAvailable = vehicles.filter(
          (v) => v.sourceType === "company_vehicle" && isAvailable(v)
        ).length;
        const rentalAvailable = vehicles.filter(
          (v) => v.sourceType === "rental_company" && isAvailable(v)
        ).length;
        const assignedWorkOrderIds = new Set<string>();
        for (const vehicle of vehicles) {
          for (const reservation of (vehicle?.reservations || []) as any[]) {
            if (reservation?.workOrderId) assignedWorkOrderIds.add(String(reservation.workOrderId));
          }
        }

        return {
          day,
          available: companyAvailable + rentalAvailable,
          companyAvailable,
          rentalAvailable,
          companyActive: counts.companyVehiclesActive ?? 0,
          rentalActive: counts.rentalCompanyVehiclesActive ?? 0,
          reserved: counts.reservedOnDay ?? 0,
          cancellationPending: counts.rentalCancellationPending ?? 0,
          assignedWorkOrderIds,
        };
        })
      ),
      demandPromise,
    ]);

    const next = boardRows.map((row: any) => {
      if (row.error) return row as DayBoard;
      const demand = demandByDay.get(row.day) || { workOrderIds: new Set<string>(), unknownReturn: 0 };
      const assignedDemand = [...demand.workOrderIds].filter((id) => row.assignedWorkOrderIds.has(id)).length;
      const unassignedDemand = Math.max(0, demand.workOrderIds.size - assignedDemand);
      return {
        day: row.day,
        available: row.available,
        companyAvailable: row.companyAvailable,
        rentalAvailable: row.rentalAvailable,
        companyActive: row.companyActive,
        rentalActive: row.rentalActive,
        reserved: row.reserved,
        cancellationPending: row.cancellationPending,
        demand: demand.workOrderIds.size,
        assignedDemand,
        unassignedDemand,
        shortage: Math.max(0, unassignedDemand - row.available),
        unknownReturn: demand.unknownReturn,
      } as DayBoard;
    });

    setRows(next);
    const shortageDays = next.filter((x) => !x.error && x.shortage > 0).length;
    setMessage(
      next.some((x) => x.error)
        ? "一部の日で代車状況を取得できませんでした。"
        : shortageDays > 0
          ? `⚠ 代車不足の見込みが ${shortageDays}日あります。`
          : "1週間の代車空きと必要台数を表示しています。"
    );
    setBusy(false);
  }

  const shortageSummary = useMemo(() => {
    const shortageDays = rows.filter((row) => !row.error && row.shortage > 0);
    return {
      days: shortageDays.length,
      max: Math.max(0, ...shortageDays.map((row) => row.shortage)),
      unassigned: rows.reduce((sum, row) => sum + (row.error ? 0 : row.unassignedDemand), 0),
    };
  }, [rows]);

  return (
    <main className="loanerWeek">
      <header className="top">
        <button onClick={() => location.assign("/loaners?day=" + weekStart)}>← 代車管理</button>
        <div><b>1週間の代車空き</b><span>自社代車・レンタカー</span></div>
        <strong>icb</strong>
      </header>

      <section className="controls">
        <button disabled={busy} onClick={() => setWeekStart(addDays(weekStart, -7))}>← 前の週</button>
        <input
          type="date"
          value={weekStart}
          onChange={(e) => e.target.value && setWeekStart(mondayOf(e.target.value))}
        />
        <button disabled={busy} onClick={() => setWeekStart(mondayOf(todayJst()))}>今週</button>
        <button disabled={busy} onClick={() => setWeekStart(addDays(weekStart, 7))}>次の週 →</button>
      </section>

      <p className="message">{busy ? "読み込み中…" : message}</p>

      <section className={`shortageSummary ${shortageSummary.days > 0 ? "hasShortage" : ""}`}>
        <div><span>不足見込み</span><b>{shortageSummary.days}日</b></div>
        <div><span>最大不足</span><b>{shortageSummary.max}台</b></div>
        <div><span>週間の未割当必要数</span><b>{shortageSummary.unassigned}台日</b></div>
      </section>

      <section className="weekGrid">
        {rows.map((row) => {
          const low = row.available <= 1 && !row.error && row.shortage === 0;
          return (
            <button
              key={row.day}
              className={`dayCard${row.error ? " error" : row.shortage > 0 ? " shortage" : low ? " low" : ""}`}
              onClick={() => location.assign("/loaners?day=" + row.day)}
            >
              <div className="dayHead"><b>{dayLabel(row.day)}</b><small>{row.day}</small></div>
              {row.error ? (
                <strong className="errorText">取得エラー</strong>
              ) : (
                <>
                  <div className="available"><span>空き合計</span><strong>{row.available}</strong><small>台</small></div>
                  <div className="breakdown">
                    <span>自社 <b>{row.companyAvailable}</b> / {row.companyActive}</span>
                    <span>レンタカー <b>{row.rentalAvailable}</b> / {row.rentalActive}</span>
                  </div>
                  <div className="demandBreakdown">
                    <span>必要 <b>{row.demand}</b>台</span>
                    <span>割当済 <b>{row.assignedDemand}</b>台</span>
                    <span>未割当 <b>{row.unassignedDemand}</b>台</span>
                  </div>
                  <div className="reservationCount">予約・貸出 {row.reserved}件</div>
                  {row.shortage > 0 && <div className="shortageWarning">⚠ 代車不足 {row.shortage}台</div>}
                  {row.unknownReturn > 0 && <div className="warning">返却予定未定を含む {row.unknownReturn}台</div>}
                  {row.cancellationPending > 0 && <div className="warning">取消連絡待ち {row.cancellationPending}件</div>}
                </>
              )}
            </button>
          );
        })}
      </section>

      <div className="footerActions">
        <button onClick={() => location.assign("/schedule/week?day=" + weekStart)}>週間予定も確認</button>
        <button onClick={() => location.assign("/loaners?day=" + weekStart)}>代車の貸出・返却管理</button>
      </div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}
        .loanerWeek{max-width:1180px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .controls{display:flex;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #d9e0ea;border-radius:16px;padding:12px}.controls input{border:1px solid #cbd6e3;border-radius:10px;padding:9px;background:#fff}.message{color:#667487;margin:10px 2px}.shortageSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.shortageSummary>div{background:#fff;border:1px solid #d9e0ea;border-radius:12px;padding:10px 12px;display:grid}.shortageSummary span{font-size:11px;color:#657387}.shortageSummary b{font-size:20px}.shortageSummary.hasShortage>div:first-child,.shortageSummary.hasShortage>div:nth-child(2){background:#ffecec;border-color:#efaaaa;color:#9f2525}.weekGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}.dayCard{display:block;text-align:left;color:#172033;padding:12px;min-height:230px}.dayCard.low{box-shadow:inset 0 4px 0 #d79a3d}.dayCard.shortage{box-shadow:inset 0 5px 0 #d64545;background:#fff8f8;border-color:#efaaaa}.dayCard.error{box-shadow:inset 0 4px 0 #c84a4a}.dayHead{display:grid;border-bottom:1px solid #e4e9f0;padding-bottom:7px;margin-bottom:10px}.dayHead small{color:#7b8797;font-weight:600}.available{display:flex;align-items:baseline;gap:5px}.available span{font-size:11px;color:#657387}.available strong{font-size:32px;color:#25703c}.available small{color:#657387}.breakdown{display:grid;gap:4px;margin-top:8px;font-size:11px}.breakdown span{background:#f3f6fa;border-radius:7px;padding:5px}.demandBreakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:8px}.demandBreakdown span{font-size:9px;background:#eef3fa;border-radius:6px;padding:4px;text-align:center}.demandBreakdown b{font-size:13px}.reservationCount{font-size:11px;margin-top:8px;color:#586678}.warning,.shortageWarning{font-size:11px;margin-top:6px;border-radius:7px;padding:5px}.warning{background:#fff0db;color:#925b08}.shortageWarning{background:#ffe2e2;color:#a32121;font-weight:900}.errorText{color:#b33636}.footerActions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
        @media(max-width:980px){.weekGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.dayCard{min-height:180px}}@media(max-width:560px){.weekGrid{grid-template-columns:1fr}.dayCard{min-height:0}.controls{display:grid;grid-template-columns:1fr 1fr}.controls input{grid-column:1/-1}.shortageSummary{grid-template-columns:1fr}.footerActions{display:grid}.top>div span{display:none}}
      `}</style>
    </main>
  );
}
