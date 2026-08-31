/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  schedule_display_name: string | null;
  phone: string | null;
};

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number: string | null;
  registration_number_last4: string | null;
  maker: string | null;
  model: string | null;
};

type WorkOrder = {
  id: string;
  vehicle_id: string;
  reason: string;
  status: string;
  worker_name: string | null;
  outsource_vendor_name: string | null;
  work_completed: boolean;
  stay_reason: string | null;
  planned_delivery_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
};

type ScheduleEntry = {
  id: string;
  vehicle_id: string | null;
  work_order_id: string | null;
  entry_type: string;
  starts_at: string;
  ends_at: string;
};

type SearchRow = {
  entry: ScheduleEntry;
  work: WorkOrder | null;
  vehicle: Vehicle | null;
  customer: Customer | null;
};

const ENTRY_LABEL: Record<string,string> = {
  delivery: "納車",
  pickup: "引取",
  customer_visit: "来社",
  onsite_repair: "出張",
};

function dayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function customerLabel(c: Customer | null) {
  return c?.schedule_display_name || c?.company_name || c?.name || "お客様未登録";
}

function safeLike(text: string) {
  return text.replace(/[,%()]/g, " ").trim();
}

function stayElapsedLabel(work: WorkOrder | null) {
  if (!work?.checked_in_at || work.checked_out_at) return null;
  const start = Date.parse(dayKey(work.checked_in_at) + "T00:00:00Z");
  const today = Date.parse(dayKey(new Date().toISOString()) + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(today) || today < start) return null;
  const days = Math.floor((today - start) / 86_400_000);
  return days === 0 ? "本日入庫" : `入庫から${days}日`;
}

export default function ScheduleSearchPage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("お客様名・電話番号・ナンバー下4桁で検索できます。");
  const [showPast, setShowPast] = useState(false);

  async function search() {
    const q = query.trim();
    if (!q) {
      setRows([]);
      setMessage("検索する文字を入力してください。");
      return;
    }
    setBusy(true);
    setMessage("予定を検索中…");

    try {
      const like = safeLike(q);
      const digits = q.replace(/\D/g, "");

      const customerPromise = supabase
        .from("customers")
        .select("id,name,company_name,schedule_display_name,phone")
        .or([
          `name.ilike.%${like}%`,
          `company_name.ilike.%${like}%`,
          `schedule_display_name.ilike.%${like}%`,
          `phone.ilike.%${digits || like}%`,
        ].join(","))
        .limit(100);

      const vehicleQueries = [
        supabase
          .from("vehicles")
          .select("id,customer_id,registration_number,registration_number_last4,maker,model")
          .ilike("registration_number", `%${like}%`)
          .limit(100),
      ];
      if (digits) {
        vehicleQueries.push(
          supabase
            .from("vehicles")
            .select("id,customer_id,registration_number,registration_number_last4,maker,model")
            .ilike("registration_number_last4", `%${digits.slice(-4)}%`)
            .limit(100)
        );
      }

      const [customerRes, ...vehicleDirectRes] = await Promise.all([customerPromise, ...vehicleQueries]);
      if (customerRes.error) throw customerRes.error;
      for (const result of vehicleDirectRes) if (result.error) throw result.error;

      const customers = (customerRes.data || []) as Customer[];
      const customerIds = customers.map((x) => x.id);

      let vehiclesByCustomer: Vehicle[] = [];
      if (customerIds.length) {
        const { data, error } = await supabase
          .from("vehicles")
          .select("id,customer_id,registration_number,registration_number_last4,maker,model")
          .in("customer_id", customerIds)
          .limit(200);
        if (error) throw error;
        vehiclesByCustomer = (data || []) as Vehicle[];
      }

      const vehicleMap = new Map<string, Vehicle>();
      for (const r of vehicleDirectRes) for (const v of ((r.data || []) as Vehicle[])) vehicleMap.set(v.id, v);
      for (const v of vehiclesByCustomer) vehicleMap.set(v.id, v);
      const vehicles = [...vehicleMap.values()];
      const vehicleIds = vehicles.map((x) => x.id);

      if (!vehicleIds.length) {
        setRows([]);
        setMessage("一致する予定は見つかりませんでした。");
        return;
      }

      const { data: workData, error: workError } = await supabase
        .from("work_orders")
        .select("id,vehicle_id,reason,status,worker_name,outsource_vendor_name,work_completed,stay_reason,planned_delivery_date,checked_in_at,checked_out_at")
        .in("vehicle_id", vehicleIds)
        .limit(300);
      if (workError) throw workError;
      const works = (workData || []) as WorkOrder[];
      const workIds = works.map((x) => x.id);

      const entryResults: ScheduleEntry[] = [];
      if (workIds.length) {
        let q1 = supabase
          .from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at")
          .in("work_order_id", workIds)
          .order("starts_at", { ascending: false })
          .limit(300);
        if (!showPast) q1 = q1.gte("starts_at", new Date().toISOString());
        const { data, error } = await q1;
        if (error) throw error;
        entryResults.push(...((data || []) as ScheduleEntry[]));
      }

      let q2 = supabase
        .from("schedule_entries")
        .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at")
        .in("vehicle_id", vehicleIds)
        .order("starts_at", { ascending: false })
        .limit(300);
      if (!showPast) q2 = q2.gte("starts_at", new Date().toISOString());
      const { data: directEntries, error: directEntryError } = await q2;
      if (directEntryError) throw directEntryError;
      entryResults.push(...((directEntries || []) as ScheduleEntry[]));

      const uniqueEntries = [...new Map(entryResults.map((x) => [x.id, x])).values()]
        .sort((a,b) => new Date(showPast ? b.starts_at : a.starts_at).getTime() - new Date(showPast ? a.starts_at : b.starts_at).getTime());

      const workMap = new Map(works.map((x) => [x.id, x]));
      const customerMap = new Map(customers.map((x) => [x.id, x]));

      const missingCustomerIds = [...new Set(vehicles.map((x) => x.customer_id).filter((id) => id && !customerMap.has(id)))];
      if (missingCustomerIds.length) {
        const { data } = await supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name,phone")
          .in("id", missingCustomerIds as string[]);
        for (const c of ((data || []) as Customer[])) customerMap.set(c.id,c);
      }

      const resultRows = uniqueEntries.map((entry) => {
        const work = entry.work_order_id ? workMap.get(entry.work_order_id) || null : null;
        const vehicleId = entry.vehicle_id || work?.vehicle_id || null;
        const vehicle = vehicleId ? vehicleMap.get(vehicleId) || null : null;
        const customer = vehicle?.customer_id ? customerMap.get(vehicle.customer_id) || null : null;
        return { entry, work, vehicle, customer };
      });

      setRows(resultRows);
      setMessage(`${resultRows.length}件の予定が見つかりました。`);
    } catch (error: any) {
      setRows([]);
      setMessage(safeActionError("予定検索", error));
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, SearchRow[]>();
    for (const row of rows) {
      const key = dayKey(row.entry.starts_at);
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return [...groups.entries()];
  }, [rows]);

  return (
    <main className="searchPage">
      <header className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <div><b>予定検索</b><span>名前・電話・下4桁</span></div>
        <strong>icb</strong>
      </header>

      <section className="searchCard">
        <div className="eyebrow">電話対応用</div>
        <h1>予定を即検索</h1>
        <div className="searchRow">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
            placeholder="お客様名 / 電話番号 / ナンバー下4桁"
          />
          <button className="primary" disabled={busy} onClick={() => void search()}>
            {busy ? "検索中…" : "検索"}
          </button>
        </div>
        <label className="pastToggle">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          過去の予定も含める
        </label>
        <div className="notice">{message}</div>
      </section>

      <section className="results">
        {grouped.map(([day, dayRows]) => (
          <article className="dayGroup" key={day}>
            <div className="dayTitle">
              <b>{new Intl.DateTimeFormat("ja-JP",{timeZone:"UTC",year:"numeric",month:"long",day:"numeric",weekday:"short"}).format(new Date(day+"T00:00:00Z"))}</b>
              <div>
                <button onClick={() => location.assign("/schedule?day="+day)}>1日を見る</button>
                <button onClick={() => location.assign("/schedule/new?day="+day)}>＋予定登録</button>
              </div>
            </div>
            <div className="resultList">
              {dayRows.map(({entry,work,vehicle,customer}) => {
                const elapsed = stayElapsedLabel(work);
                return (
                <div className="resultRow" key={entry.id}>
                  <div className="time">{dateTimeLabel(entry.starts_at).split(" ").pop()}</div>
                  <div className="main">
                    <b>{customerLabel(customer)}</b>
                    <span>{ENTRY_LABEL[entry.entry_type] || entry.entry_type}{work?.reason ? "・"+work.reason : ""}</span>
                  </div>
                  <div className="meta">
                    {vehicle?.registration_number_last4 && <span>下4桁 {vehicle.registration_number_last4}</span>}
                    {customer?.phone && <span>{customer.phone}</span>}
                    {work?.worker_name && <span>担当 {work.worker_name}</span>}
                    {work?.outsource_vendor_name && <span>外注 {work.outsource_vendor_name}</span>}
                    {elapsed && <span className="elapsed">{elapsed}</span>}
                    {work?.stay_reason && <span>滞留理由 {work.stay_reason}</span>}
                    {work?.planned_delivery_date && <span>納車予定 {work.planned_delivery_date}</span>}
                  </div>
                  <div className="state">{work?.work_completed ? "作業完了" : work?.status === "in_progress" ? "作業中" : "作業未実施"}</div>
                  <button className="editBtn" onClick={() => location.assign("/schedule/edit?id="+entry.id)}>予約変更</button>
                </div>
                );
              })}
            </div>
          </article>
        ))}
        {!busy && rows.length === 0 && <div className="empty">検索結果はここに表示されます。</div>}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}
        .searchPage{max-width:1050px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .searchCard,.dayGroup{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px;margin-bottom:12px}.eyebrow{font-weight:800;color:#2674e8}.searchCard h1{margin:4px 0 14px;font-size:31px}.searchRow{display:grid;grid-template-columns:1fr auto;gap:8px}.searchRow input{border:2px solid #b9c6d8;border-radius:12px;padding:14px;font-size:18px}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4;min-width:100px}.pastToggle{display:flex;align-items:center;gap:7px;margin-top:10px;color:#5d6878;font-weight:700}.pastToggle input{width:auto}.notice{margin-top:10px;color:#647184}
        .dayTitle{display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #edf0f4;padding-bottom:10px}.dayTitle>div{display:flex;gap:6px}.resultList{display:grid;gap:7px;margin-top:10px}.resultRow{display:grid;grid-template-columns:70px minmax(180px,1.4fr) minmax(180px,1fr) auto auto;gap:10px;align-items:center;border:1px solid #e0e6ef;border-radius:12px;padding:11px}.time{font-weight:900;font-size:16px}.main{display:grid}.main span,.meta{color:#697587;font-size:12px}.meta{display:flex;gap:5px;flex-wrap:wrap}.meta span{background:#f2f5f8;border-radius:999px;padding:4px 6px}.meta .elapsed{background:#fff4d8;color:#8a5a00;font-weight:900}.state{font-size:12px;font-weight:900;border-radius:999px;padding:5px 8px;background:#f1f3f6;white-space:nowrap}.editBtn{font-size:11px;padding:7px 9px}.empty{background:#fff;border-radius:16px;padding:28px;text-align:center;color:#8c98a8}
        @media(max-width:720px){.resultRow{grid-template-columns:55px 1fr}.meta,.state,.editBtn{grid-column:2}.searchRow{grid-template-columns:1fr}.primary{width:100%}.dayTitle{align-items:flex-start;flex-direction:column}}
      `}</style>
    </main>
  );
}
