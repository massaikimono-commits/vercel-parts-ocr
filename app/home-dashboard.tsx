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

type SecurityAlert = {
  severity: "warning" | "high";
  alert_code: string;
  occurred_at: string | null;
  message: string;
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

export default function HomeDashboard({ onLogout }: { onLogout: () => void | Promise<unknown> }) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchDay, setSearchDay] = useState(todayJst());
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [securityAlert, setSecurityAlert] = useState<SecurityAlert | null>(null);

  useEffect(() => {
    void loadToday();
    void loadSecurityAlert();
  }, []);

  async function loadSecurityAlert() {
    const { data, error } = await supabase.rpc("my_login_security_alerts", { p_limit: 3 });
    if (error) return;
    const alerts = (data || []) as SecurityAlert[];
    setSecurityAlert(alerts[0] || null);
  }

  async function loadToday() {
    setBusy(true);
    setLoadError("");
    const bounds = jstBounds(todayJst());
    const [entryRes, workRes, vehicleRes, customerRes] = await Promise.all([
      supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at").gte("starts_at", bounds.start).lt("starts_at", bounds.end).order("starts_at", { ascending: true }),
      supabase.from("work_orders").select("id,reason,status,work_completed,is_urgent,needs_loaner,worker_name").neq("status", "cancelled"),
      supabase.from("vehicles").select("id,customer_id,registration_number_last4,registration_number"),
      supabase.from("customers").select("id,name,company_name,schedule_display_name"),
    ]);
    const firstError = [entryRes.error, workRes.error, vehicleRes.error, customerRes.error].find(Boolean);
    if (firstError) setLoadError("今日の予定を取得できません。1日のスケジュールで再確認してください。");
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

  const unfinished = useMemo(() => {
    const seenWorkIds = new Set<string>();
    return todayRows.filter(({ work }) => {
      if (!work || work.work_completed || work.status === "completed" || seenWorkIds.has(work.id)) return false;
      seenWorkIds.add(work.id);
      return true;
    });
  }, [todayRows]);

  function customerName(customer: Customer | null) {
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
  }

  function last4(vehicle: Vehicle | null) {
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "----";
  }

  function openDay(day: string) {
    if (!day) return;
    location.assign("/schedule?day=" + day);
  }
  function registerDay(day: string) {
    if (!day) return;
    location.assign("/schedule/new?day=" + day);
  }

  const pendingCount = unfinished.filter(({ work }) => work?.status !== "in_progress").length;
  const runningCount = unfinished.filter(({ work }) => work?.status === "in_progress").length;
  const todayCountLabel = busy ? "…" : loadError ? "確認要" : todayRows.length + "件";
  const todayStatusLabel = busy
    ? "読み込み中"
    : loadError || (unfinished.length
      ? [pendingCount ? `未実施 ${pendingCount}件` : "", runningCount ? `作業中 ${runningCount}件` : ""].filter(Boolean).join(" / ")
      : "未完了なし");

  return (
    <main className="homeDash">
      <header className="homeHead">
        <div><div className="homeLogo">icb</div><div className="homeSub">業務メニュー</div></div>
        <button className="logout" onClick={() => void onLogout()}>ログアウト</button>
      </header>

      {securityAlert && (
        <button
          className="notice"
          style={{ width: "100%", textAlign: "left", marginBottom: 12 }}
          onClick={() => location.assign("/settings/login-history")}
        >
          <strong>⚠ セキュリティ確認</strong><br />
          {securityAlert.message}<br />
          <small>タップしてログイン履歴を確認</small>
        </button>
      )}

      <section className="mobileToday">
        <button className="heroToday" onClick={() => openDay(todayJst())}>
          <span>今日の予定</span>
          <strong>{todayCountLabel}</strong>
          <small>{todayStatusLabel}</small>
        </button>

        {!busy && !loadError && unfinished.length > 0 && (
          <div className="unfinishedBox">
            <div className="unfinishedTitle">作業状況 <strong>{unfinished.length}件</strong></div>
            {unfinished.slice(0, 5).map(({ entry, work, vehicle, customer }) => {
              const running = work?.status === "in_progress";
              return (
                <button key={work?.id || entry.id} className="unfinishedRow" onClick={() => openDay(todayJst())}>
                  <span className={`statusDot ${running ? "running" : "pending"}`}>{running ? "中" : "未"}</span>
                  <span className="uMain">
                    <b>{timeLabel(entry.starts_at)}　{customerName(customer)}</b>
                    <small>{running ? "作業中" : "作業未実施"}　下4桁 {last4(vehicle)}　{work?.reason || ""}</small>
                  </span>
                  {work?.is_urgent && <em>急ぎ</em>}
                  {work?.needs_loaner && <em>代車</em>}
                </button>
              );
            })}
            {unfinished.length > 5 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {unfinished.length - 5}件も未完了　→ 1日のスケジュールで確認
              </button>
            )}
          </div>
        )}

        <div className="mobileActions">
          <button className="primaryAction" onClick={() => registerDay(todayJst())}>＋ 予定登録</button>
          <button className="scheduleAction" onClick={() => openDay(todayJst())}>1日のスケジュール</button>
          <button onClick={() => location.assign("/schedule/search")}>名前・電話・下4桁で予定検索</button>
          <button onClick={() => location.assign("/schedule/week")}>1週間の予定検索</button>
          <button onClick={() => location.assign("/ocr/auto")}>部品伝票読取</button>
          <button onClick={() => location.assign("/inspection/select")}>記録簿作成</button>
          <button onClick={() => location.assign("/vehicle-workflow")}>車検証読取</button>
          <button onClick={() => location.assign("/settings/login-history")}>ログイン履歴</button>
        </div>
      </section>

      <section className="desktopMain">
        <div className="desktopHeroGrid">
          <button className="desktopHero primaryHero" onClick={() => registerDay(todayJst())}><span>予定登録</span><strong>＋ 新しい予定を登録</strong><small>いちばん使う機能</small></button>
          <button className="desktopHero" onClick={() => openDay(todayJst())}><span>今日の予定</span><strong>{todayCountLabel}</strong><small>{todayStatusLabel}</small></button>
        </div>

        <div className="dateSearch">
          <div><b>予定の日付検索</b><small>見たい日を選んで1日のスケジュールを開く</small></div>
          <input type="date" value={searchDay} onChange={(e) => setSearchDay(e.target.value)} />
          <button disabled={!searchDay} onClick={() => openDay(searchDay)}>この日の予定を見る</button>
          <button disabled={!searchDay} onClick={() => location.assign("/schedule/week?day=" + searchDay)}>この週の予定を見る</button>
          <button disabled={!searchDay} onClick={() => registerDay(searchDay)}>＋ この日に予定登録</button>
        </div>

        <div className="desktopTools">
          <button onClick={() => location.assign("/schedule/search")}><b>予定即検索</b><small>名前・電話・下4桁</small></button>
          <button onClick={() => location.assign("/loaners")}><b>代車管理</b><small>空き・貸出・返却予定</small></button>
          <button onClick={() => location.assign("/ocr/auto")}><b>部品伝票読取</b><small>3番目によく使う</small></button>
          <button onClick={() => location.assign("/inspection/select")}><b>記録簿作成</b><small>記録簿を選んで作成</small></button>
          <button onClick={() => location.assign("/vehicle-workflow")}><b>車検証読取</b><small>必要なときだけ</small></button>
          <button onClick={() => location.assign("/customer-vehicles")}><b>顧客・車両管理</b><small>検索・編集</small></button>
          <button onClick={() => location.assign("/settings/login-history")}><b>ログイン履歴</b><small>不審なアクセスを確認</small></button>
        </div>
      </section>
    </main>
  );
}
