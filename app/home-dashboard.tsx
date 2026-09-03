/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { dailyReportTimeLabel, prepareDailyReportSection } from "./schedule/print-rules";

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
  reason: string;
  inspection_schedule_type: string | null;
  status: string;
  work_completed: boolean;
  is_urgent: boolean;
  needs_loaner: boolean;
  worker_name: string | null;
  checked_out_at: string | null;
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

type LoginSecurityAlert = {
  severity: "warning" | "high";
  alert_code: string;
  occurred_at: string | null;
  message: string;
};

type SecurityAlert = {
  severity: "warning" | "high";
  alert_code: string;
  occurred_at: string | null;
  message: string;
};

function inspectionScheduleLabel(value: string | null | undefined) {
  if (value === "schedule") return "スケ";
  if (value === "legal_3m") return "法定3ヶ月";
  if (value === "legal_6m") return "法定6ヶ月";
  if (value === "legal_12m") return "法定12ヶ月";
  return "";
}

function workDisplayLabel(work: WorkOrder | null) {
  if (!work) return "";
  const inspection = inspectionScheduleLabel(work.inspection_schedule_type);
  return inspection ? `${work.reason} ${inspection}` : work.reason;
}

const ENTRY_LABEL: Record<ScheduleEntry["entry_type"], string> = {
  delivery: "納車",
  pickup: "引取",
  customer_visit: "来社",
  onsite_repair: "出張",
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

function dateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function isMorningJst(value: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false,
  }).format(new Date(value)));
  return Number.isFinite(hour) && hour < 12;
}

function shortDayLabel(day: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short",
  }).format(new Date(day + "T00:00:00Z"));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default function HomeDashboard({ onLogout }: { onLogout: () => void | Promise<unknown> }) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [weekEntries, setWeekEntries] = useState<ScheduleEntry[]>([]);
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchDay, setSearchDay] = useState(todayJst());
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [securityAlerts, setSecurityAlerts] = useState<LoginSecurityAlert[]>([]);
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
    const today = todayJst();
    const bounds = jstBounds(today);
    const weekStart = mondayOf(today);
    const weekEnd = addDays(weekStart, 7);
    const [entryRes, weekEntryRes, workRes, vehicleRes, customerRes] = await Promise.all([
      supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode,print_time_label_override").gte("starts_at", bounds.start).lt("starts_at", bounds.end).order("starts_at", { ascending: true }),
      supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode,print_time_label_override").gte("starts_at", new Date(weekStart + "T00:00:00+09:00").toISOString()).lt("starts_at", new Date(weekEnd + "T00:00:00+09:00").toISOString()).order("starts_at", { ascending: true }),
      supabase.from("work_orders").select("id,reason,inspection_schedule_type,status,work_completed,is_urgent,needs_loaner,worker_name,checked_out_at").neq("status", "cancelled"),
      supabase.from("vehicles").select("id,customer_id,registration_number_last4,registration_number"),
      supabase.from("customers").select("id,name,company_name,schedule_display_name"),
    ]);
    const firstError = [entryRes.error, weekEntryRes.error, workRes.error, vehicleRes.error, customerRes.error].find(Boolean);
    if (firstError) setLoadError("スケジュールを取得できません。詳細画面で再確認してください。");
    if (!entryRes.error) setEntries((entryRes.data || []) as ScheduleEntry[]);
    if (!weekEntryRes.error) setWeekEntries((weekEntryRes.data || []) as ScheduleEntry[]);
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

  const currentWeekDays = useMemo(() => {
    const start = mondayOf(todayJst());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, []);

  const weekRowsByDay = useMemo(() => {
    const grouped = new Map<string, Array<{ entry: ScheduleEntry; work: WorkOrder | null; vehicle: Vehicle | null; customer: Customer | null }>>();
    for (const entry of weekEntries) {
      const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
      const vehicle = entry.vehicle_id ? vehicleMap.get(entry.vehicle_id) || null : null;
      const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
      const key = dateKey(entry.starts_at);
      const rows = grouped.get(key) || [];
      rows.push({ entry, work, vehicle, customer });
      grouped.set(key, rows);
    }
    return grouped;
  }, [weekEntries, workMap, vehicleMap, customerMap]);

  const statusCounts = useMemo(() => {
    const uniqueWorks = new Map<string, WorkOrder>();
    for (const { work } of todayRows) if (work) uniqueWorks.set(work.id, work);
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    for (const work of uniqueWorks.values()) {
      if (work.work_completed || work.status === "completed") completed += 1;
      else if (work.status === "in_progress") inProgress += 1;
      else pending += 1;
    }
    return { pending, inProgress, completed };
  }, [todayRows]);

  const workerLoad = useMemo(() => {
    const grouped = new Map<string, { name: string; pending: number; running: number; total: number; urgent: number }>();
    for (const work of works) {
      if (work.checked_out_at || work.work_completed || work.status === "completed" || work.status === "cancelled") continue;
      const name = work.worker_name?.trim() || "担当未設定";
      const row = grouped.get(name) || { name, pending: 0, running: 0, total: 0, urgent: 0 };
      row.total += 1;
      if (work.status === "in_progress") row.running += 1;
      else row.pending += 1;
      if (work.is_urgent) row.urgent += 1;
      grouped.set(name, row);
    }
    return [...grouped.values()].sort((a, b) => {
      if (a.name === "担当未設定") return 1;
      if (b.name === "担当未設定") return -1;
      return b.urgent - a.urgent || b.total - a.total || b.running - a.running || a.name.localeCompare(b.name, "ja");
    });
  }, [works]);

  const unfinished = useMemo(() => {
    const seenWorkIds = new Set<string>();
    return todayRows.filter(({ work }) => {
      if (!work || work.work_completed || work.status === "completed" || work?.status === "in_progress" || seenWorkIds.has(work.id)) return false;
      seenWorkIds.add(work.id);
      return true;
    });
  }, [todayRows]);

  const inProgressRows = useMemo(() => {
    const seenWorkIds = new Set<string>();
    return todayRows.filter(({ work }) => {
      if (!work || work.work_completed || work?.status !== "in_progress" || seenWorkIds.has(work.id)) return false;
      seenWorkIds.add(work.id);
      return true;
    });
  }, [todayRows]);

  const completedRows = useMemo(() => {
    const seenWorkIds = new Set<string>();
    return todayRows.filter(({ work }) => {
      if (!work || (!work.work_completed && work.status !== "completed") || seenWorkIds.has(work.id)) return false;
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

  function openTodayWork(workId: string | undefined) {
    if (!workId) return openDay(todayJst());
    location.assign("/schedule?day=" + todayJst() + "&focus=" + encodeURIComponent(workId));
  }

  function openWorkload(worker?: string) {
    const params = new URLSearchParams();
    if (worker) params.set("worker", worker);
    params.set("filter", "unfinished");
    location.assign("/schedule/workload?" + params.toString());
  }

  const todayCountLabel = busy ? "…" : loadError ? "確認要" : todayRows.length + "件";
  const inProgressLabel = "作業中";
  const todayStatusLabel = busy
    ? "読み込み中"
    : loadError
      ? "状態は1日の予定で確認"
      : `未実施 ${statusCounts.pending}・作業中 ${statusCounts.inProgress}・完了 ${statusCounts.completed}`;

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

      {securityAlerts.length > 0 && (
        <section className="card" style={{ border: "2px solid currentColor", marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>⚠️ ログイン安全確認</h2>
          {securityAlerts.slice(0, 2).map((alert) => (
            <p key={alert.alert_code + String(alert.occurred_at)}>
              <strong>{alert.severity === "high" ? "要確認" : "注意"}：</strong>
              {alert.message}
            </p>
          ))}
          <button onClick={() => location.assign("/settings/login-history")}>ログイン履歴を確認</button>
        </section>
      )}

      <section className="homeWeek" aria-label="今週のスケジュール">
        <div className="homeWeekHead">
          <div>
            <span>メインスケジュール</span>
            <h2>1週間のスケジュール</h2>
            <small>今週を常に確認。日付をタップすると1日の予定を開きます。</small>
          </div>
          <div className="homeWeekActions">
            <button onClick={() => location.assign("/schedule/week")}>週全体を開く</button>
            <button className="weekPrimary" onClick={() => registerDay(todayJst())}>＋ 予定登録</button>
          </div>
        </div>
        <div className="homeWeekGrid">
          {currentWeekDays.map((day) => {
            const rows = weekRowsByDay.get(day) || [];
            const isToday = day === todayJst();
            return (
              <article key={day} className={isToday ? "homeWeekDay today" : "homeWeekDay"}>
                <button className="homeWeekDayHead" onClick={() => openDay(day)}>
                  <b>{shortDayLabel(day)}</b><span>{rows.length}件</span>
                </button>
                <div className="homeWeekRows dailyReportMini">
                  {busy ? <div className="homeWeekEmpty">読込中…</div> : rows.length === 0 ? (
                    <div className="homeWeekEmpty">予定なし</div>
                  ) : (["morning","afternoon"] as const).map((period) => {
                    const periodRows = rows.filter(({ entry }) => isMorningJst(entry.starts_at) === (period === "morning"));
                    const itemMap = new Map(periodRows.map((row) => [row.entry.id, row]));
                    const prepared = prepareDailyReportSection(periodRows.map(({ entry }) => entry), period);
                    const deliveries = prepared.deliveries.map((entry) => itemMap.get(entry.id)).filter(Boolean) as typeof periodRows;
                    const inbound = prepared.inbound.map((entry) => itemMap.get(entry.id)).filter(Boolean) as typeof periodRows;
                    return (
                      <div key={period} className="miniPeriod">
                        <div className="miniPeriodLabel">{period === "morning" ? "午前" : "午後"}</div>
                        <div className="miniReportColumns">
                          <div className="miniReportColumn delivery">
                            <small className="miniColumnTitle">納車</small>
                            {!deliveries.length && <span className="miniEmpty">—</span>}
                            {deliveries.map(({ entry, work, vehicle, customer }) => (
                              <button key={entry.id} className="homeWeekRow miniRow type-delivery" onClick={() => location.assign("/schedule/edit?id=" + encodeURIComponent(entry.id))}>
                                <b>{customerName(customer)}</b>
                                <span>{last4(vehicle)}　{workDisplayLabel(work)}</span>
                                <small>{ENTRY_LABEL[entry.entry_type]} {dailyReportTimeLabel(entry)}</small>
                              </button>
                            ))}
                          </div>
                          <div className="miniReportColumn inbound">
                            <small className="miniColumnTitle">来社・引取・出張</small>
                            {!inbound.length && <span className="miniEmpty">—</span>}
                            {inbound.map(({ entry, work, vehicle, customer }) => (
                              <button key={entry.id} className={`homeWeekRow miniRow type-${entry.entry_type}`} onClick={() => location.assign("/schedule/edit?id=" + encodeURIComponent(entry.id))}>
                                <b>{customerName(customer)}</b>
                                <span>{last4(vehicle)}　{workDisplayLabel(work)}</span>
                                <small>{ENTRY_LABEL[entry.entry_type]} {dailyReportTimeLabel(entry)}</small>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button className="homeWeekAdd" onClick={() => registerDay(day)}>＋ この日に登録</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mobileToday">
        <button className="heroToday" onClick={() => openDay(todayJst())}>
          <span>今日の予定</span>
          <strong>{todayCountLabel}</strong>
          <small>{todayStatusLabel}</small>
        </button>

        {!busy && !loadError && (
          <div className="todayStatusGrid" aria-label="今日の作業状態">
            <button className="statusTile pending" onClick={() => openDay(todayJst())}>
              <span>作業未実施</span><strong>{statusCounts.pending}</strong><small>台</small>
            </button>
            <button className="statusTile progress" onClick={() => openDay(todayJst())}>
              <span>作業中</span><strong>{statusCounts.inProgress}</strong><small>台</small>
            </button>
            <button className="statusTile done" onClick={() => openDay(todayJst())}>
              <span>作業完了</span><strong>{statusCounts.completed}</strong><small>台</small>
            </button>
          </div>
        )}

        {!busy && !loadError && inProgressRows.length > 0 && (
          <div className="progressBox">
            <div className="progressTitle">いま{inProgressLabel} <strong>{inProgressRows.length}件</strong></div>
            {inProgressRows.slice(0, 3).map(({ entry, work, vehicle, customer }) => (
              <button key={work?.id || entry.id} className="progressRow" onClick={() => openTodayWork(work?.id)}>
                <span className="progressDot">中</span>
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}　下4桁 {last4(vehicle)}</b><small>{workDisplayLabel(work)}　担当 {work?.worker_name?.trim() || "未設定"}</small></span>
                {work?.is_urgent && <em>急ぎ</em>}
              </button>
            ))}
            {inProgressRows.length > 3 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {inProgressRows.length - 3}件も作業中　→ 1日の予定で確認
              </button>
            )}
          </div>
        )}

        {!busy && !loadError && unfinished.length > 0 && (
          <div className="unfinishedBox">
            <div className="unfinishedTitle">作業未実施 <strong>{unfinished.length}件</strong></div>
            {unfinished.slice(0, 5).map(({ entry, work, vehicle, customer }) => (
              <button key={work?.id || entry.id} className="unfinishedRow" onClick={() => openTodayWork(work?.id)}>
                <span className="statusDot">未</span>
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}</b><small>下4桁 {last4(vehicle)}　{workDisplayLabel(work)}</small></span>
                {work?.is_urgent && <em>急ぎ</em>}
                {work?.needs_loaner && <em>代車</em>}
              </button>
            ))}
            {unfinished.length > 5 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {unfinished.length - 5}件も未完了　→ 1日の予定で確認
              </button>
            )}
          </div>
        )}

        {!busy && !loadError && completedRows.length > 0 && (
          <div className="completedBox">
            <div className="completedTitle">作業完了 <strong>{completedRows.length}件</strong></div>
            {completedRows.slice(0, 3).map(({ entry, work, vehicle, customer }) => (
              <button key={work?.id || entry.id} className="completedRow" onClick={() => openTodayWork(work?.id)}>
                <span className="completedDot">済</span>
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}　下4桁 {last4(vehicle)}</b><small>{workDisplayLabel(work)}　担当 {work?.worker_name?.trim() || "未設定"}</small></span>
              </button>
            ))}
            {completedRows.length > 3 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {completedRows.length - 3}件も完了　→ 1日の予定で確認
              </button>
            )}
          </div>
        )}

        <div className="mobileActions">
          <button className="primaryAction" onClick={() => registerDay(todayJst())}>＋ 予定登録</button>
          <button className="scheduleAction" onClick={() => openDay(todayJst())}>1日の予定</button>
          <button onClick={() => location.assign("/schedule/search")}>名前・電話・下4桁で予定検索</button>
          <button onClick={() => location.assign("/schedule/week")}>1週間のスケジュール</button>
          <button onClick={() => location.assign("/ocr/auto")}>部品伝票読取</button>
          <button onClick={() => location.assign("/inspection/select")}>記録簿作成</button>
          <button onClick={() => location.assign("/vehicle-workflow")}>車検証読取</button>
          <button onClick={() => location.assign("/settings/login-history")}>ログイン履歴</button>
        </div>
      </section>

      <section className="desktopMain">
        <div className="desktopHeroGrid">
          <button className="desktopHero primaryHero" onClick={() => registerDay(todayJst())}><span>予定登録</span><strong>＋ 新しい予定を登録</strong><small>いちばん使う機能</small></button>
          <button className="desktopHero todayHero" onClick={() => openDay(todayJst())}>
            <span>今日の予定</span><strong>{todayCountLabel}</strong><small>{todayStatusLabel}</small>
            {!busy && !loadError && <div className="desktopStatusLine"><b>未実施 {statusCounts.pending}</b><b>作業中 {statusCounts.inProgress}</b><b>完了 {statusCounts.completed}</b></div>}
          </button>
        </div>

        {!busy && !loadError && workerLoad.length > 0 && (
          <div className="homeWorkload" aria-label="作業担当者の負荷">
            <div className="homeWorkloadHead">
              <div><b>作業担当者の負荷</b><small>急ぎ案件を優先し、未完了・作業中の偏りを確認</small></div>
              <button onClick={() => openWorkload()}>負荷表で詳しく見る</button>
            </div>
            <div className="homeWorkloadGrid">
              {workerLoad.slice(0, 6).map((row) => (
                <button key={row.name} className={`${row.name === "担当未設定" ? "homeWorker unassigned" : "homeWorker"}${row.urgent > 0 ? " urgent" : ""}`} onClick={() => openWorkload(row.name)}>
                  <b>{row.name}{row.urgent > 0 && <em className="urgentBadge">急ぎ {row.urgent}</em>}</b>
                  <span>未完了 <strong>{row.total}</strong>台</span>
                  <small>未実施 {row.pending}・作業中 {row.running}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="dateSearch">
          <div><b>予定の日付検索</b><small>見たい日を選んで1日の予定を開く</small></div>
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

      <style jsx global>{`
        .homeWeek{margin-bottom:14px;background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:14px}
        .homeWeekHead{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.homeWeekHead>div:first-child{display:grid;gap:2px}.homeWeekHead span{font-size:12px;color:#2674e8;font-weight:900}.homeWeekHead h2{margin:0;font-size:22px}.homeWeekHead small{color:#718096}.homeWeekActions{display:flex;gap:7px;flex-wrap:wrap}.homeWeekActions .weekPrimary{background:#2674e8;color:#fff;border-color:#2674e8}
        .homeWeekGrid{display:grid;grid-template-columns:repeat(7,minmax(180px,1fr));gap:7px;overflow-x:auto;padding-bottom:4px}.homeWeekDay{min-width:180px;border:1px solid #dce4ef;border-radius:13px;overflow:hidden;background:#fff;display:flex;flex-direction:column}.homeWeekDay.today{outline:3px solid #2674e8;outline-offset:-2px}.homeWeekDayHead{border:0;border-radius:0;background:#f5f8fc;color:#172033;padding:9px;display:flex;justify-content:space-between}.homeWeekDayHead span{font-size:11px;color:#657386}.homeWeekRows{padding:5px;display:grid;gap:5px;min-height:150px}.dailyReportMini{align-content:start}.miniPeriod{display:grid;gap:3px}.miniPeriodLabel{font-size:9px;font-weight:900;color:#6d7887;border-bottom:1px solid #e8edf3;padding-bottom:2px}.miniReportColumns{display:grid;grid-template-columns:1fr 1fr;gap:3px}.miniReportColumn{display:grid;gap:2px;align-content:start;min-width:0}.miniColumnTitle{font-size:8px;font-weight:900;color:#7b8796;padding:0 2px}.miniEmpty{font-size:9px;color:#a3acb8;text-align:center;padding:3px}.homeWeekRow{border:1px solid #e2e8f0;background:#fff;color:#172033;border-radius:7px;padding:4px;text-align:left;display:grid;gap:1px;min-width:0}.homeWeekRow b{font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.homeWeekRow span{font-size:8px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.homeWeekRow small{font-size:8px;color:#738095;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.miniRow.type-customer_visit{border-left:3px solid #7da9e8}.miniRow.type-pickup{border-left:3px solid #e8b15b}.miniRow.type-onsite_repair{border-left:3px solid #79b98d}.miniRow.type-delivery{border-left:3px solid #9a87d7}.homeWeekEmpty{padding:18px 4px;text-align:center;color:#9aa5b3;font-size:11px}.homeWeekMore,.homeWeekAdd{font-size:10px;padding:6px}.homeWeekMore{border:0}.homeWeekAdd{margin:5px;background:#f8fbff}
        .todayStatusGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
        .statusTile{min-width:0;padding:12px 6px;display:grid;grid-template-columns:1fr auto auto;gap:4px;align-items:end;text-align:left;border-width:2px}
        .statusTile span{grid-column:1/-1;font-size:12px;font-weight:900;white-space:nowrap}
        .statusTile strong{font-size:28px;line-height:1}.statusTile small{font-size:11px;font-weight:800;padding-bottom:2px}
        .statusTile.pending{border-color:#e3a09a;background:#fff4f2;color:#9b3f35}
        .statusTile.progress{border-color:#e6c56a;background:#fff9e8;color:#7d5b00}
        .statusTile.done{border-color:#99d0ad;background:#effaf3;color:#277247}
        .progressBox{margin-top:10px;border:2px solid #e6c56a;background:#fffdf4;border-radius:16px;padding:10px}
        .progressTitle{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:900;color:#715300;padding:2px 2px 7px}
        .progressRow{width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:9px 7px;border:0;border-top:1px solid #f0dfac;border-radius:0;background:transparent;color:#172033}
        .progressRow:first-of-type{border-top:0}.progressRow em{font-size:10px;font-style:normal;background:#b8493e;color:white;border-radius:999px;padding:3px 6px;white-space:nowrap}
        .progressDot{width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:999px;background:#d99f00;color:white;font-size:12px;font-weight:900}
        .completedBox{margin-top:10px;border:2px solid #99d0ad;background:#f4fbf6;border-radius:16px;padding:10px}
        .completedTitle{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:900;color:#277247;padding:2px 2px 7px}
        .completedRow{width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:9px 7px;border:0;border-top:1px solid #cfe8d7;border-radius:0;background:transparent;color:#172033}
        .completedRow:first-of-type{border-top:0}
        .completedDot{width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:999px;background:#3c9560;color:white;font-size:12px;font-weight:900}
        .desktopStatusLine{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
        .desktopStatusLine b{font-size:12px;background:#f1f5f9;border-radius:999px;padding:5px 8px;color:#526174}
        .homeWorkload{margin-top:14px;background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:15px}
        .homeWorkloadHead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
        .homeWorkloadHead>div{display:grid;gap:2px}.homeWorkloadHead b{font-size:16px}.homeWorkloadHead small{color:#718096}
        .homeWorkloadHead button{padding:8px 10px;font-size:12px}
        .homeWorkloadGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
        .homeWorker{display:grid;gap:3px;text-align:left;color:#172033;border-color:#dbe3ee;padding:11px}
        .homeWorker>b{font-size:15px;display:flex;align-items:center;justify-content:space-between;gap:8px}.homeWorker span{font-size:12px;color:#5d6878}.homeWorker span strong{font-size:20px;color:#172033}.homeWorker small{font-size:11px;color:#718096}.homeWorker.unassigned{border-color:#e6aa5a;background:#fff9e8}.homeWorker.urgent{border-color:#e4a099;background:#fff8f7}.urgentBadge{font-size:10px;font-style:normal;background:#b8493e;color:white;border-radius:999px;padding:3px 6px;white-space:nowrap}
        @media(max-width:780px){.homeWorkloadGrid{grid-template-columns:1fr 1fr}}
        @media(max-width:380px){.statusTile span{font-size:10px}.statusTile strong{font-size:24px}}
      `}</style>
    </main>
  );
}
