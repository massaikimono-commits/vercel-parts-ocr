/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type WorkOrder = {
  id: string;
  vehicle_id: string;
  worker_name: string | null;
  status: string;
  work_completed: boolean;
  checked_in_at: string | null;
  checked_out_at: string | null;
  reason: string | null;
  is_urgent: boolean | null;
};

type ScheduleLink = {
  id: string;
  work_order_id: string | null;
  entry_type: string;
  starts_at: string;
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

type WorkFilter = "all" | "unfinished" | "notStarted" | "inProgress" | "urgent" | "completedWaiting" | "staying";

type LoadRow = {
  name: string;
  total: number;
  unfinished: number;
  notStarted: number;
  inProgress: number;
  completedWaiting: number;
  staying: number;
  urgent: number;
  oldestStayDays: number;
};

function normalizeWorker(name: string | null) {
  return name?.trim() || "担当未設定";
}

function dayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function elapsedStayDays(checkedInAt: string | null) {
  if (!checkedInAt) return null;
  const start = Date.parse(dayKey(checkedInAt) + "T00:00:00Z");
  const today = Date.parse(dayKey(new Date().toISOString()) + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(today) || today < start) return null;
  return Math.floor((today - start) / 86_400_000);
}

export default function WorkloadPage() {
  const [works, setWorks] = useState<WorkOrder[]>([]);
  const [scheduleLinks, setScheduleLinks] = useState<ScheduleLink[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string>("全担当");
  const [selectedFilter, setSelectedFilter] = useState<WorkFilter>("unfinished");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("担当者の負荷を読み込みます。");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const worker = params.get("worker");
    const filter = params.get("filter");
    if (worker) setSelectedWorker(worker);
    if (filter && ["all","unfinished","notStarted","inProgress","urgent","completedWaiting","staying"].includes(filter)) {
      setSelectedFilter(filter as WorkFilter);
    }
    void load();
  }, []);

  async function load() {
    setBusy(true);
    setMessage("担当者の負荷を読み込み中…");
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id,vehicle_id,worker_name,status,work_completed,checked_in_at,checked_out_at,reason,is_urgent")
        .is("checked_out_at", null)
        .neq("status", "cancelled")
        .limit(500);
      if (error) throw error;
      const nextWorks = (data || []) as WorkOrder[];
      setWorks(nextWorks);

      const workIds = nextWorks.map((work) => work.id);
      const vehicleIds = [...new Set(nextWorks.map((work) => work.vehicle_id).filter(Boolean))];
      const [scheduleRes, vehicleRes] = await Promise.all([
        workIds.length
          ? supabase
              .from("schedule_entries")
              .select("id,work_order_id,entry_type,starts_at")
              .in("work_order_id", workIds)
              .order("starts_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        vehicleIds.length
          ? supabase
              .from("vehicles")
              .select("id,customer_id,registration_number_last4,registration_number")
              .in("id", vehicleIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (scheduleRes.error) throw scheduleRes.error;
      if (vehicleRes.error) throw vehicleRes.error;

      const nextVehicles = (vehicleRes.data || []) as Vehicle[];
      const customerIds = [...new Set(nextVehicles.map((vehicle) => vehicle.customer_id).filter(Boolean))] as string[];
      let nextCustomers: Customer[] = [];
      if (customerIds.length) {
        const { data: customerData, error: customerError } = await supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name")
          .in("id", customerIds);
        if (customerError) throw customerError;
        nextCustomers = (customerData || []) as Customer[];
      }

      setScheduleLinks((scheduleRes.data || []) as ScheduleLink[]);
      setVehicles(nextVehicles);
      setCustomers(nextCustomers);
      setMessage("現在出庫前の作業を担当者別に集計しています。");
    } catch (error: any) {
      setWorks([]);
      setScheduleLinks([]);
      setVehicles([]);
      setCustomers([]);
      setMessage("負荷表の読み込みエラー: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    const map = new Map<string, LoadRow>();
    for (const work of works) {
      const name = normalizeWorker(work.worker_name);
      const row = map.get(name) || {
        name,
        total: 0,
        unfinished: 0,
        notStarted: 0,
        inProgress: 0,
        completedWaiting: 0,
        staying: 0,
        urgent: 0,
        oldestStayDays: 0,
      };
      row.total += 1;
      if (work.work_completed || work.status === "completed") {
        row.completedWaiting += 1;
      } else if (work.status === "in_progress") {
        row.inProgress += 1;
        row.unfinished += 1;
      } else {
        row.notStarted += 1;
        row.unfinished += 1;
      }
      if (work.is_urgent && !work.work_completed && work.status !== "completed") row.urgent += 1;

      const stayDays = elapsedStayDays(work.checked_in_at);
      if (stayDays !== null) {
        row.staying += 1;
        row.oldestStayDays = Math.max(row.oldestStayDays, stayDays);
      }
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => {
      return b.unfinished - a.unfinished
        || b.urgent - a.urgent
        || b.inProgress - a.inProgress
        || b.oldestStayDays - a.oldestStayDays
        || b.total - a.total
        || a.name.localeCompare(b.name, "ja");
    });
  }, [works]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    total: acc.total + row.total,
    unfinished: acc.unfinished + row.unfinished,
    notStarted: acc.notStarted + row.notStarted,
    inProgress: acc.inProgress + row.inProgress,
    completedWaiting: acc.completedWaiting + row.completedWaiting,
    staying: acc.staying + row.staying,
    urgent: acc.urgent + row.urgent,
    oldestStayDays: Math.max(acc.oldestStayDays, row.oldestStayDays),
  }), { total: 0, unfinished: 0, notStarted: 0, inProgress: 0, completedWaiting: 0, staying: 0, urgent: 0, oldestStayDays: 0 }), [rows]);

  const unassignedRow = useMemo(() => rows.find((row) => row.name === "担当未設定") || null, [rows]);

  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleLink>();
    for (const link of scheduleLinks) {
      if (!link.work_order_id) continue;
      const current = map.get(link.work_order_id);
      if (!current || (current.entry_type === "delivery" && link.entry_type !== "delivery")) {
        map.set(link.work_order_id, link);
      }
    }
    return map;
  }, [scheduleLinks]);

  const vehicleMap = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const customerMap = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);

  function workMatchesFilter(work: WorkOrder, filter: WorkFilter) {
    const completed = work.work_completed || work.status === "completed";
    if (filter === "unfinished") return !completed;
    if (filter === "notStarted") return !completed && work.status !== "in_progress";
    if (filter === "inProgress") return !completed && work.status === "in_progress";
    if (filter === "urgent") return !completed && Boolean(work.is_urgent);
    if (filter === "completedWaiting") return completed;
    if (filter === "staying") return Boolean(work.checked_in_at);
    return true;
  }

  function filterLabel(filter: WorkFilter) {
    if (filter === "unfinished") return "未完了";
    if (filter === "notStarted") return "未実施";
    if (filter === "inProgress") return "作業中";
    if (filter === "urgent") return "急ぎ";
    if (filter === "completedWaiting") return "完了待ち";
    if (filter === "staying") return "入庫中";
    return "すべて";
  }

  function customerName(work: WorkOrder) {
    const vehicle = vehicleMap.get(work.vehicle_id);
    const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) : null;
    return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
  }

  function vehicleLast4(work: WorkOrder) {
    const vehicle = vehicleMap.get(work.vehicle_id);
    return vehicle?.registration_number_last4 || vehicle?.registration_number?.match(/(\d{4})(?!.*\d)/)?.[1] || "";
  }

  const filteredWorks = useMemo(() => {
    return works
      .filter((work) => selectedWorker === "全担当" || normalizeWorker(work.worker_name) === selectedWorker)
      .filter((work) => workMatchesFilter(work, selectedFilter))
      .sort((a, b) => {
        const urgentDiff = Number(Boolean(b.is_urgent)) - Number(Boolean(a.is_urgent));
        if (urgentDiff) return urgentDiff;
        const stateDiff = Number(b.status === "in_progress") - Number(a.status === "in_progress");
        if (stateDiff) return stateDiff;
        return (elapsedStayDays(b.checked_in_at) || 0) - (elapsedStayDays(a.checked_in_at) || 0);
      });
  }, [works, selectedWorker, selectedFilter]);

  function chooseWorker(name: string, filter: WorkFilter = "unfinished") {
    setSelectedWorker(name);
    setSelectedFilter(filter);
    requestAnimationFrame(() => document.getElementById("workload-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <main className="loadPage">
      <header className="top">
        <button onClick={() => location.assign("/schedule/week")}>← 1週間予定へ</button>
        <div><b>担当者負荷</b><span>出庫前の作業状況</span></div>
        <strong>icb</strong>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">作業負荷表</div>
          <h1>担当者ごとの現在負荷</h1>
          <p>{busy ? "読み込み中…" : message}</p>
        </div>
        <button className="reload" disabled={busy} onClick={() => void load()}>再読込</button>
      </section>

      <section className="summary">
        <button onClick={() => chooseWorker("全担当", "all")}><span>出庫前</span><b>{totals.total}</b></button>
        <button className="unfinishedSummary" onClick={() => chooseWorker("全担当", "unfinished")}><span>未完了</span><b>{totals.unfinished}</b></button>
        <button onClick={() => chooseWorker("全担当", "notStarted")}><span>未実施</span><b>{totals.notStarted}</b></button>
        <button onClick={() => chooseWorker("全担当", "inProgress")}><span>作業中</span><b>{totals.inProgress}</b></button>
        <button onClick={() => chooseWorker("全担当", "urgent")}><span>急ぎ未完了</span><b>{totals.urgent}</b></button>
        <button onClick={() => chooseWorker("全担当", "completedWaiting")}><span>作業完了・納車待ち</span><b>{totals.completedWaiting}</b></button>
        <button onClick={() => chooseWorker("全担当", "staying")}><span>入庫中</span><b>{totals.staying}</b></button>
        <div><span>最長滞留</span><b>{totals.staying ? `${totals.oldestStayDays}日` : "-"}</b></div>
      </section>

      {!busy && unassignedRow && unassignedRow.unfinished > 0 && (
        <div className="unassignedAlert" role="status">
          <div>
            <b>担当未設定の未完了車両があります</b>
            <span>未完了 {unassignedRow.unfinished}台（未実施 {unassignedRow.notStarted}台・作業中 {unassignedRow.inProgress}台）</span>
          </div>
          <div className="unassignedActions">
            {unassignedRow.urgent > 0 && <strong>急ぎ {unassignedRow.urgent}台</strong>}
            <button onClick={() => chooseWorker("担当未設定", "unfinished")}>担当未設定を確認</button>
          </div>
        </div>
      )}

      <section className="tableCard">
        <div className="tableHead">
          <span>担当者</span><span>未完了</span><span>未実施</span><span>作業中</span><span>急ぎ</span><span>完了待ち</span><span>入庫中</span><span>最長滞留</span><span>合計</span>
        </div>
        {rows.map((row) => (
          <div className={`loadRow ${row.name === "担当未設定" ? "unassigned" : ""}`} key={row.name}>
            <button className="workerOpen" onClick={() => chooseWorker(row.name, "unfinished")}>{row.name}</button>
            <button className={row.unfinished ? "unfinished metricButton" : "metricButton"} onClick={() => chooseWorker(row.name, "unfinished")}>{row.unfinished}</button>
            <button className={row.notStarted ? "warn metricButton" : "metricButton"} onClick={() => chooseWorker(row.name, "notStarted")}>{row.notStarted}</button>
            <button className={row.inProgress ? "progress metricButton" : "metricButton"} onClick={() => chooseWorker(row.name, "inProgress")}>{row.inProgress}</button>
            <button className={row.urgent ? "urgent metricButton" : "metricButton"} onClick={() => chooseWorker(row.name, "urgent")}>{row.urgent}</button>
            <button className="metricButton" onClick={() => chooseWorker(row.name, "completedWaiting")}>{row.completedWaiting}</button>
            <button className={row.staying ? "stay metricButton" : "metricButton"} onClick={() => chooseWorker(row.name, "staying")}>{row.staying}</button>
            <span className={row.oldestStayDays ? "stayAge" : ""}>{row.staying ? `${row.oldestStayDays}日` : "-"}</span>
            <strong>{row.total}</strong>
          </div>
        ))}
        {!busy && rows.length === 0 && <div className="empty">現在の出庫前作業はありません。</div>}
      </section>

      <section className="detailCard" id="workload-detail">
        <div className="detailHead">
          <div>
            <span>該当作業を直接確認</span>
            <h2>{selectedWorker} / {filterLabel(selectedFilter)} {filteredWorks.length}台</h2>
          </div>
          <div className="detailFilters">
            {(["unfinished","notStarted","inProgress","urgent","completedWaiting","staying","all"] as WorkFilter[]).map((filter) => (
              <button
                key={filter}
                className={selectedFilter === filter ? "active" : ""}
                onClick={() => setSelectedFilter(filter)}
              >
                {filterLabel(filter)}
              </button>
            ))}
          </div>
        </div>
        <div className="workCards">
          {filteredWorks.map((work) => {
            const schedule = scheduleMap.get(work.id);
            const stayDays = elapsedStayDays(work.checked_in_at);
            const completed = work.work_completed || work.status === "completed";
            return (
              <article className={`workCard ${work.is_urgent && !completed ? "urgentWork" : ""}`} key={work.id}>
                <div className="workMain">
                  <b>{customerName(work)}</b>
                  <span>{work.reason || "作業内容未登録"}</span>
                </div>
                <div className="workMeta">
                  {vehicleLast4(work) && <span>下4桁 {vehicleLast4(work)}</span>}
                  <span>{normalizeWorker(work.worker_name)}</span>
                  <span>{completed ? "作業完了" : work.status === "in_progress" ? "作業中" : "作業未実施"}</span>
                  {work.is_urgent && !completed && <span className="urgentTag">急ぎ</span>}
                  {stayDays !== null && <span className={stayDays >= 3 ? "stayWarn" : ""}>入庫 {stayDays}日</span>}
                </div>
                <div className="workActions">
                  {schedule ? (
                    <button onClick={() => location.assign("/schedule/edit?id=" + encodeURIComponent(schedule.id))}>予約を開く</button>
                  ) : (
                    <button onClick={() => location.assign("/schedule")}>1日のスケジュールへ</button>
                  )}
                </div>
              </article>
            );
          })}
          {!busy && filteredWorks.length === 0 && <div className="empty detailEmpty">該当する作業はありません。</div>}
        </div>
      </section>

      <div className="hint">未完了は「未実施＋作業中」の台数です。担当者名や各台数を押すと該当車両だけを下に表示し、そのまま予約変更画面へ進めます。同じ作業を複数予定に登録していても、work_orders単位で1台として集計します。</div>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit}
        .loadPage{max-width:1180px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}.top button,.reload{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .hero{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}.eyebrow{color:#2674e8;font-weight:800}.hero h1{font-size:28px;margin:3px 0}.hero p{margin:0;color:#6d798a}.summary{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;margin:10px 0}.summary>div,.summary>button{background:#fff;border:1px solid #d9e0ea;border-radius:14px;padding:13px;display:grid;gap:4px;text-align:left;color:inherit}.summary>button{cursor:pointer}.summary>button:hover{border-color:#8eb5ef}.summary .unfinishedSummary{border-color:#c8d9f2;background:#f7fbff}.summary span{font-size:12px;color:#687587}.summary b{font-size:26px}.unassignedAlert{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:0 0 10px;padding:12px 14px;border:1px solid #f2c99e;border-radius:14px;background:#fff8f2;color:#8b4b19}.unassignedAlert>div:first-child{display:grid;gap:3px}.unassignedAlert span{font-size:12px;color:#8b684c}.unassignedActions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.unassignedAlert strong{white-space:nowrap;border-radius:999px;padding:6px 10px;background:#fff0f0;color:#b02a2a}.unassignedAlert button{border:1px solid #e2aa76;background:#fff;color:#a25417;border-radius:10px;padding:7px 9px;font-weight:900}.tableCard{background:#fff;border:1px solid #d9e0ea;border-radius:18px;overflow:hidden}.tableHead,.loadRow{display:grid;grid-template-columns:minmax(160px,1.5fr) repeat(8,minmax(70px,.6fr));gap:8px;align-items:center;padding:11px 14px}.tableHead{background:#f7f9fc;color:#657184;font-size:11px;font-weight:900}.tableHead span:not(:first-child),.loadRow span,.loadRow strong,.loadRow .metricButton{text-align:center}.loadRow{border-top:1px solid #edf0f4}.workerOpen,.metricButton{border:0;background:transparent;color:inherit;font-weight:900;padding:5px 7px;border-radius:9px;cursor:pointer}.workerOpen{text-align:left;font-size:15px}.workerOpen:hover,.metricButton:hover{background:#edf4ff;color:#1f5cae}.loadRow span,.loadRow strong,.loadRow .metricButton{border-radius:999px;padding:5px 7px;font-weight:900}.loadRow .unfinished{background:#edf4ff;color:#1f5cae}.loadRow .warn{background:#fff4d8;color:#8a5a00}.loadRow .progress{background:#eaf3ff;color:#245ca8}.loadRow .urgent{background:#fff0f0;color:#b02a2a}.loadRow .stay{background:#eef7ed;color:#356d31}.loadRow .stayAge{background:#fff4d8;color:#8a5a00}.loadRow.unassigned{background:#fff8f2}.loadRow.unassigned .workerOpen{color:#a25417}.detailCard{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:14px;margin-top:10px}.detailHead{display:flex;justify-content:space-between;gap:10px;align-items:center}.detailHead>div:first-child{display:grid}.detailHead span{font-size:11px;color:#687587}.detailHead h2{margin:2px 0;font-size:20px}.detailFilters{display:flex;gap:5px;flex-wrap:wrap}.detailFilters button,.workActions button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:9px;padding:7px 9px;font-weight:800}.detailFilters button.active{background:#2674e8;color:#fff;border-color:#2674e8}.workCards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.workCard{border:1px solid #e0e6ef;border-radius:13px;padding:11px;display:grid;gap:8px}.workCard.urgentWork{border-color:#efb3b3;background:#fffafa}.workMain{display:grid}.workMain>b{font-size:16px}.workMain span{font-size:12px;color:#687587}.workMeta{display:flex;gap:5px;flex-wrap:wrap}.workMeta span{font-size:10px;background:#f1f4f8;border-radius:999px;padding:4px 6px}.workMeta .urgentTag{background:#fff0f0;color:#b02a2a;font-weight:900}.workMeta .stayWarn{background:#fff4d8;color:#8a5a00;font-weight:900}.workActions{display:flex;justify-content:flex-end}.detailEmpty{grid-column:1/-1}.empty{padding:28px;text-align:center;color:#8b97a7}.hint{font-size:12px;color:#78869a;margin-top:8px}
        @media(max-width:900px){.summary{grid-template-columns:repeat(4,1fr)}}
        @media(max-width:650px){
          .hero{display:block}.reload{margin-top:12px;width:100%}.summary{grid-template-columns:1fr 1fr}.unassignedAlert{align-items:flex-start}.hero h1{font-size:24px}
          .tableCard{border:0;background:transparent;overflow:visible;display:grid;gap:10px}.tableHead{display:none}.loadRow{min-width:0;grid-template-columns:1fr 1fr;gap:8px;padding:14px;background:#fff;border:1px solid #d9e0ea;border-radius:16px}.loadRow:first-of-type{border-top:1px solid #d9e0ea}.workerOpen{grid-column:1/-1;font-size:17px;padding-bottom:8px;border-bottom:1px solid #edf0f4}.loadRow span,.loadRow strong,.loadRow .metricButton{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;text-align:right;border-radius:10px;padding:8px 10px;min-height:42px}.loadRow span::before,.loadRow strong::before,.loadRow .metricButton::before{font-size:11px;color:#718096;font-weight:800;text-align:left}.loadRow .metricButton:nth-child(2)::before{content:"未完了"}.loadRow .metricButton:nth-child(3)::before{content:"未実施"}.loadRow .metricButton:nth-child(4)::before{content:"作業中"}.loadRow .metricButton:nth-child(5)::before{content:"急ぎ"}.loadRow .metricButton:nth-child(6)::before{content:"完了待ち"}.loadRow .metricButton:nth-child(7)::before{content:"入庫中"}.loadRow span:nth-child(8)::before{content:"最長滞留"}.loadRow strong:nth-child(9)::before{content:"合計"}.loadRow.unassigned{border-color:#f2c99e}.detailHead{display:grid}.workCards{grid-template-columns:1fr}.detailFilters{display:grid;grid-template-columns:repeat(2,1fr)}.detailFilters button{width:100%}.empty{background:#fff;border:1px solid #d9e0ea;border-radius:16px}
        }
      `}</style>
    </main>
  );
}
