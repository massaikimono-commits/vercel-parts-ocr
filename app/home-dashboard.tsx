/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

type ScheduleEntry = {
  id: string;
  vehicle_id: string | null;
  work_order_id: string | null;
  entry_type: "delivery" | "pickup" | "customer_visit" | "onsite_repair";
  starts_at: string;
};

type WorkOrder = {
  id: string;
  reason: string;
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

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function jstBounds(day: string) {
  const start = new Date(day + "T00:00:00+09:00");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default function HomeDashboard({ onLogout }: { onLogout: () => void | Promise<void> }) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchDay, setSearchDay] = useState(todayJst());
  const [busy, setBusy] = useState(true);

  useEffect(() => { void loadToday(); }, []);

  async function loadToday() {
    setBusy(true);
    const bounds = jstBounds(todayJst());
    const [entryRes, workRes, vehicleRes, customerRes] = await Promise.all([
      supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at").gte("starts_at", bounds.start).lt("starts_at", bounds.end).order("starts_at", { ascending: true }),
      supabase.from("work_orders").select("id,reason,work_completed,is_urgent,needs_loaner,worker_name").neq("status", "cancelled"),
      supabase.from("vehicles").select("id,customer_id,registration_number_last4,registration_number"),
      supabase.from("customers").select("id,name,company_name,schedule_display_name"),
    ]);
    if (!entryRes.error) setEntries((entryRes.data || []) as ScheduleEntry[]);
    if (!workRes.error) setWorks((workRes.data || []) as WorkOrder[]);
    if (!vehicleRes.error) setVehicles((vehicleRes.data || []) as Vehicle[]);
    if (!customerRes.error) setCustomers((customerRes.data || []) as Customer[]);
    setBusy(false);
  }

  const workMap = useMemo(() => new Map(works.map((x) => [x.id, x])), [works]);
  const vehicleMap = useMemo(() => new Map(vehicles.map((x) => [x.id, x])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers]);

  const todayRows = useMemo(() => entries.map((entry) => {
    const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
    const vehicle = entry.vehicle_id ? vehicleMap.get(entry.vehicle_id) || null : null;
    const customer = vehicle && vehicle.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
    return { entry, work, vehicle, customer };
  }), [entries, workMap, vehicleMap, customerMap]);

  const unfinished = todayRows.filter(({ entry, work }) => entry.entry_type === "delivery" && work && !work.work_completed);

  function customerName(customer: Customer | null) {
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
  }

  function last4(vehicle: Vehicle | null) {
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\\d{4})(?!.*\\d)/)?.[1] || "----";
  }

  function openDay(day: string) { location.assign("/schedule?day=" + day); }

  return (
    <main className="homeDash">
      <header className="homeHead">
        <div><div className="homeLogo">icb</div><div className="homeSub">業務メニュー</div></div>
        <button className="logout" onClick={() => void onLogout()}>ログアウト</button>
      </header>

      <section className="mobileToday">
        <button className="heroToday" onClick={() => openDay(todayJst())}>
          <span>今日の予定</span>
          <strong>{busy ? "…" : todayRows.length + "件"}</strong>
          <small>{busy ? "読み込み中" : unfinished.length ? "作業未実施 " + unfinished.length + "件" : "作業未実施なし"}</small>
        </button>

        {!busy && unfinished.length > 0 && (
          <div className="unfinishedBox">
            <div className="unfinishedTitle">作業未実施</div>
            {unfinished.slice(0, 5).map(({ entry, work, vehicle, customer }) => (
              <button key={entry.id} className="unfinishedRow" onClick={() => openDay(todayJst())}>
                <span className="statusDot">未</span>
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}</b><small>下4桁 {last4(vehicle)}　{work?.reason || ""}</small></span>
                {work?.is_urgent && <em>急ぎ</em>}
                {work?.needs_loaner && <em>代車</em>}
              </button>
            ))}
          </div>
        )}

        <div className="mobileActions">
          <button className="primaryAction" onClick={() => location.assign("/schedule/new")}>＋ 予定登録</button>
          <button onClick={() => location.assign("/ocr/auto")}>部品伝票読取</button>
          <button onClick={() => location.assign("/inspection/select")}>記録簿作成</button>
          <button onClick={() => location.assign("/vehicle-workflow")}>車検証読取</button>
        </div>
      </section>

      <section className="desktopMain">
        <div className="desktopHeroGrid">
          <button className="desktopHero primaryHero" onClick={() => location.assign("/schedule/new")}><span>予定登録</span><strong>＋ 新しい予定を登録</strong><small>いちばん使う機能</small></button>
          <button className="desktopHero" onClick={() => openDay(todayJst())}><span>今日の予定</span><strong>{busy ? "…" : todayRows.length + "件"}</strong><small>{busy ? "読み込み中" : "作業未実施 " + unfinished.length + "件"}</small></button>
        </div>

        <div className="dateSearch">
          <div><b>予定の日付検索</b><small>見たい日を選んで1日のスケジュールを開く</small></div>
          <input type="date" value={searchDay} onChange={(e) => setSearchDay(e.target.value)} />
          <button onClick={() => openDay(searchDay)}>この日の予定を見る</button>
        </div>

        <div className="desktopTools">
          <button onClick={() => location.assign("/ocr/auto")}><b>部品伝票読取</b><small>3番目によく使う</small></button>
          <button onClick={() => location.assign("/inspection/select")}><b>記録簿作成</b><small>記録簿を選んで作成</small></button>
          <button onClick={() => location.assign("/vehicle-workflow")}><b>車検証読取</b><small>必要なときだけ</small></button>
          <button onClick={() => location.assign("/customer-vehicles")}><b>顧客・車両管理</b><small>検索・編集</small></button>
        </div>
      </section>
    </main>
  );
}
