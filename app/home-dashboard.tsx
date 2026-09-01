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

  useEffect(() => { void loadToday(); }, []);

  async function loadToday() {
    setBusy(true);
    setLoadError("");
    const bounds = jstBounds(todayJst());
    const [entryRes, workRes, vehicleRes, customerRes] = await Promise.all([
      supabase.from("schedule_entries").select("id,vehicle_id,work_order_id,entry_type,starts_at").gte("starts_at", bounds.start).lt("starts_at", bounds.end).order("starts_at", { ascending: true }),
      supabase.from("work_orders").select("id,reason,status,work_completed,is_urgent,needs_loaner,worker_name,checked_out_at").neq("status", "cancelled"),
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
      if (!work || work.work_completed || work.status === "completed" || work.status === "in_progress" || seenWorkIds.has(work.id)) return false;
      seenWorkIds.add(work.id);
      return true;
    });
  }, [todayRows]);

  const inProgressRows = useMemo(() => {
    const seenWorkIds = new Set<string>();
    return todayRows.filter(({ work }) => {
      if (!work || work.work_completed || work.status !== "in_progress" || seenWorkIds.has(work.id)) return false;
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
  const todayStatusLabel = busy
    ? "読み込み中"
    : loadError
      ? "状態は1日のスケジュールで確認"
      : `未実施 ${statusCounts.pending}・作業中 ${statusCounts.inProgress}・完了 ${statusCounts.completed}`;

  return (
    <main className="homeDash">
      <header className="homeHead">
        <div><div className="homeLogo">icb</div><div className="homeSub">業務メニュー</div></div>
        <button className="logout" onClick={() => void onLogout()}>ログアウト</button>
      </header>

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
            <div className="progressTitle">いま作業中 <strong>{inProgressRows.length}件</strong></div>
            {inProgressRows.slice(0, 3).map(({ entry, work, vehicle, customer }) => (
              <button key={work?.id || entry.id} className="progressRow" onClick={() => openTodayWork(work?.id)}>
                <span className="progressDot">中</span>
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}　下4桁 {last4(vehicle)}</b><small>{work?.reason || ""}　担当 {work?.worker_name?.trim() || "未設定"}</small></span>
                {work?.is_urgent && <em>急ぎ</em>}
              </button>
            ))}
            {inProgressRows.length > 3 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {inProgressRows.length - 3}件も作業中　→ 1日のスケジュールで確認
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
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}</b><small>下4桁 {last4(vehicle)}　{work?.reason || ""}</small></span>
                {work?.is_urgent && <em>急ぎ</em>}
                {work?.needs_loaner && <em>代車</em>}
              </button>
            ))}
            {unfinished.length > 5 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {unfinished.length - 5}件も未実施　→ 1日のスケジュールで確認
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
                <span className="uMain"><b>{timeLabel(entry.starts_at)}　{customerName(customer)}　下4桁 {last4(vehicle)}</b><small>{work?.reason || ""}　担当 {work?.worker_name?.trim() || "未設定"}</small></span>
              </button>
            ))}
            {completedRows.length > 3 && (
              <button className="unfinishedMore" onClick={() => openDay(todayJst())}>
                ほか {completedRows.length - 3}件も完了　→ 1日のスケジュールで確認
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
        </div>
      </section>

      <style jsx global>{`
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
