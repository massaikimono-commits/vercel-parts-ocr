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
  print_time_mode: "exact" | "morning" | "unspecified";
};

type SearchRow = {
  entry: ScheduleEntry;
  work: WorkOrder | null;
  vehicle: Vehicle | null;
  customer: Customer | null;
};

type SearchSet = {
  key: string;
  rows: SearchRow[];
  primary: SearchRow;
  groupDay: string;
};

type SearchRange = "future" | "past" | "all";

const ENTRY_LABEL: Record<string,string> = {
  delivery: "納車",
  pickup: "引取",
  customer_visit: "来社",
  onsite_repair: "出張",
};

const RANGE_LABEL: Record<SearchRange, string> = {
  future: "今後の予定",
  past: "過去の予定",
  all: "すべて",
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

function naturalLast4(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function normalizeSearchInput(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−ー]/g, "-")
    .replace(/[　\s]+/g, " ")
    .trim();
}

function searchDigits(text: string) {
  return normalizeSearchInput(text).replace(/[^0-9]/g, "");
}

function safeLike(text: string) {
  return normalizeSearchInput(text).replace(/[,%()]/g, " ").trim();
}

function phoneSearchPatterns(digits: string) {
  if (!digits) return [];
  const patterns = [`phone.ilike.%${digits}%`];
  if (digits.length >= 3) {
    patterns.push(`phone.ilike.%${digits.split("").join("%")}%'`.slice(0, -1));
  }
  return patterns;
}

function isShortPlateNumberQuery(text: string) {
  return /^\d{1,4}$/.test(normalizeSearchInput(text));
}

function plateLast4Candidates(text: string) {
  const digits = searchDigits(text).slice(-4);
  if (!digits) return [];
  const natural = String(Number(digits));
  const padded = digits.padStart(4, "0");
  return [...new Set([digits, natural, padded])];
}

function scheduleEntryTimeLabel(entry: ScheduleEntry) {
  const day = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
  }).format(new Date(entry.starts_at));
  if (entry.print_time_mode === "morning") return `${day} A中`;
  if (entry.print_time_mode === "unspecified") return `${day} 中`;
  const time = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(entry.starts_at));
  return `${day} ${time}`;
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
  const [range, setRange] = useState<SearchRange>("future");

  async function search(nextRange: SearchRange = range) {
    const q = normalizeSearchInput(query);
    setRange(nextRange);
    if (!q) {
      setRows([]);
      setMessage("検索する文字を入力してください。");
      return;
    }
    setBusy(true);
    setMessage(`${RANGE_LABEL[nextRange]}を検索中…`);

    try {
      const like = safeLike(q);
      const digits = searchDigits(q);
      const shortPlateQuery = isShortPlateNumberQuery(q);
      const nowIso = new Date().toISOString();

      let customers: Customer[] = [];
      let vehiclesByCustomer: Vehicle[] = [];
      const vehicleDirectRows: Vehicle[] = [];

      if (shortPlateQuery) {
        // 1〜4桁の数字だけはナンバー下4桁専用検索。
        // 電話番号や登録番号全体の部分一致には流さない。
        const last4Candidates = plateLast4Candidates(q);
        const { data, error } = await supabase
          .from("vehicles")
          .select("id,customer_id,registration_number,registration_number_last4,maker,model")
          .in("registration_number_last4", last4Candidates)
          .limit(200);
        if (error) throw error;
        vehicleDirectRows.push(...((data || []) as Vehicle[]));
      } else {
        const customerFilters = [
          `name.ilike.%${like}%`,
          `company_name.ilike.%${like}%`,
          `schedule_display_name.ilike.%${like}%`,
          ...(digits ? phoneSearchPatterns(digits) : [`phone.ilike.%${like}%`]),
        ];

        const customerPromise = supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name,phone")
          .or(customerFilters.join(","))
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
        for (const result of vehicleDirectRes) {
          if (result.error) throw result.error;
          vehicleDirectRows.push(...((result.data || []) as Vehicle[]));
        }

        customers = (customerRes.data || []) as Customer[];
        const customerIds = customers.map((x) => x.id);
        if (customerIds.length) {
          const { data, error } = await supabase
            .from("vehicles")
            .select("id,customer_id,registration_number,registration_number_last4,maker,model")
            .in("customer_id", customerIds)
            .limit(200);
          if (error) throw error;
          vehiclesByCustomer = (data || []) as Vehicle[];
        }
      }

      const vehicleMap = new Map<string, Vehicle>();
      for (const v of vehicleDirectRows) vehicleMap.set(v.id, v);
      for (const v of vehiclesByCustomer) vehicleMap.set(v.id, v);
      const vehicles = [...vehicleMap.values()];
      const vehicleIds = vehicles.map((x) => x.id);

      if (!vehicleIds.length) {
        setRows([]);
        setMessage(`一致する${RANGE_LABEL[nextRange]}は見つかりませんでした。`);
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
        const { data, error } = await supabase
          .from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode")
          .in("work_order_id", workIds)
          .order("starts_at", { ascending: true })
          .limit(500);
        if (error) throw error;
        entryResults.push(...((data || []) as ScheduleEntry[]));
      }

      let q2 = supabase
        .from("schedule_entries")
        .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode")
        .in("vehicle_id", vehicleIds)
        .order("starts_at", { ascending: nextRange === "future" })
        .limit(300);
      if (nextRange === "future") q2 = q2.gte("starts_at", nowIso);
      if (nextRange === "past") q2 = q2.lt("starts_at", nowIso);
      const { data: directEntries, error: directEntryError } = await q2;
      if (directEntryError) throw directEntryError;
      entryResults.push(...((directEntries || []) as ScheduleEntry[]));

      const ascending = nextRange === "future";
      const uniqueEntries = [...new Map(entryResults.map((x) => [x.id, x])).values()]
        .sort((a,b) => ascending
          ? new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
          : new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

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

      const rowsBySet = new Map<string, SearchRow[]>();
      for (const row of resultRows) {
        const key = row.entry.work_order_id ? `work:${row.entry.work_order_id}` : `entry:${row.entry.id}`;
        rowsBySet.set(key, [...(rowsBySet.get(key) || []), row]);
      }

      const matchesRange = (setRows: SearchRow[]) => {
        if (nextRange === "all") return true;
        return setRows.some((row) => nextRange === "future"
          ? row.entry.starts_at >= nowIso
          : row.entry.starts_at < nowIso);
      };

      const filteredRows = [...rowsBySet.values()]
        .filter(matchesRange)
        .flat()
        .sort((a,b) => ascending
          ? new Date(a.entry.starts_at).getTime() - new Date(b.entry.starts_at).getTime()
          : new Date(b.entry.starts_at).getTime() - new Date(a.entry.starts_at).getTime());

      setRows(filteredRows);
      setMessage(`${RANGE_LABEL[nextRange]}が${[...rowsBySet.values()].filter(matchesRange).length}件見つかりました。`);
    } catch (error: any) {
      setRows([]);
      setMessage(safeActionError("予定検索", error));
    } finally {
      setBusy(false);
    }
  }

  const resultSets = useMemo(() => {
    const bySet = new Map<string, SearchRow[]>();
    for (const row of rows) {
      const key = row.entry.work_order_id ? `work:${row.entry.work_order_id}` : `entry:${row.entry.id}`;
      bySet.set(key, [...(bySet.get(key) || []), row]);
    }

    const now = Date.now();
    const sets: SearchSet[] = [];
    for (const [key, setRows] of bySet) {
      const sorted = [...setRows].sort((a,b) => new Date(a.entry.starts_at).getTime() - new Date(b.entry.starts_at).getTime());
      const inbound = sorted.find((row) => row.entry.entry_type !== "delivery") || null;
      const primary = inbound || sorted[0];

      let relevant = primary;
      if (range === "future") {
        relevant = sorted.find((row) => new Date(row.entry.starts_at).getTime() >= now) || primary;
      } else if (range === "past") {
        relevant = [...sorted].reverse().find((row) => new Date(row.entry.starts_at).getTime() < now) || primary;
      }

      sets.push({ key, rows: sorted, primary, groupDay: dayKey(relevant.entry.starts_at) });
    }

    return sets.sort((a,b) => {
      const aTime = new Date(a.rows[0].entry.starts_at).getTime();
      const bTime = new Date(b.rows[0].entry.starts_at).getTime();
      return range === "past" ? bTime - aTime : aTime - bTime;
    });
  }, [rows, range]);

  const grouped = useMemo(() => {
    const groups = new Map<string, SearchSet[]>();
    for (const set of resultSets) {
      groups.set(set.groupDay, [...(groups.get(set.groupDay) || []), set]);
    }
    return [...groups.entries()];
  }, [resultSets]);

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
            onKeyDown={(e) => { if (e.key === "Enter") void search(range); }}
            placeholder="お客様名 / 電話番号 / ナンバー下4桁"
          />
          <button className="primary" disabled={busy} onClick={() => void search(range)}>
            {busy ? "検索中…" : "検索"}
          </button>
        </div>
        <div className="rangeTabs" aria-label="予定の期間">
          {(["future", "past", "all"] as SearchRange[]).map((value) => (
            <button
              key={value}
              className={range === value ? "active" : ""}
              disabled={busy}
              onClick={() => void search(value)}
            >
              {RANGE_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="searchHint">数字1〜4桁だけの入力はナンバー下4桁専用検索です。例：10 → 下4桁「10」（0010）。それ以外は名前・電話・登録番号から検索します。</div>
        <div className="notice">{message}</div>
      </section>

      <section className="results">
        {grouped.map(([day, daySets]) => (
          <article className="dayGroup" key={day}>
            <div className="dayTitle">
              <b>{new Intl.DateTimeFormat("ja-JP",{timeZone:"UTC",year:"numeric",month:"long",day:"numeric",weekday:"short"}).format(new Date(day+"T00:00:00Z"))}</b>
              <div>
                <button onClick={() => location.assign("/schedule?day="+day)}>1日を見る</button>
                <button onClick={() => location.assign("/schedule/new?day="+day)}>＋予定登録</button>
              </div>
            </div>
            <div className="resultList">
              {daySets.map((set) => {
                const { work, vehicle, customer } = set.primary;
                const elapsed = stayElapsedLabel(work);
                const inboundRows = set.rows.filter((row) => row.entry.entry_type !== "delivery");
                const deliveryRows = set.rows.filter((row) => row.entry.entry_type === "delivery");
                return (
                  <div className="resultRow resultSetRow" key={set.key}>
                    <div className="schedulePair">
                      {inboundRows.map((row) => (
                        <div className="scheduleLeg" key={row.entry.id}>
                          <b>{ENTRY_LABEL[row.entry.entry_type] || row.entry.entry_type}</b>
                          <span>{scheduleEntryTimeLabel(row.entry)}</span>
                        </div>
                      ))}
                      {deliveryRows.map((row) => (
                        <div className="scheduleLeg deliveryLeg" key={row.entry.id}>
                          <b>納車</b>
                          <span>{scheduleEntryTimeLabel(row.entry)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="main">
                      <b>{customerLabel(customer)}</b>
                      <span>{work?.reason || "入庫要因未設定"}</span>
                    </div>
                    <div className="meta">
                      {vehicle?.registration_number_last4 && <span>下4桁 {naturalLast4(vehicle.registration_number_last4)}</span>}
                      {customer?.phone && <span>{customer.phone}</span>}
                      {work?.worker_name && <span>担当 {work.worker_name}</span>}
                      {work?.outsource_vendor_name && <span>外注 {work.outsource_vendor_name}</span>}
                      {elapsed && <span className="elapsed">{elapsed}</span>}
                      {work?.stay_reason && <span>滞留理由 {work.stay_reason}</span>}
                      {work?.planned_delivery_date && <span>納車予定 {work.planned_delivery_date}</span>}
                    </div>
                    <div className="state">{work?.work_completed || work?.status === "completed" ? "作業完了" : work?.status === "in_progress" ? "作業中" : "作業未実施"}</div>
                    <div className="resultActions">
                      <button className="editBtn" onClick={() => location.assign("/schedule/edit?id="+set.primary.entry.id)}>予約変更</button>
                      <button className="cancelBtn" onClick={() => location.assign("/schedule/edit?id="+set.primary.entry.id+"&mode=cancel")}>予約取消</button>
                    </div>
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
        .searchCard,.dayGroup{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px;margin-bottom:12px}.eyebrow{font-weight:800;color:#2674e8}.searchCard h1{margin:4px 0 14px;font-size:31px}.searchRow{display:grid;grid-template-columns:1fr auto;gap:8px}.searchRow input{border:2px solid #b9c6d8;border-radius:12px;padding:14px;font-size:18px}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4;min-width:100px}.rangeTabs{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}.rangeTabs button{color:#526176;background:#f8fafc}.rangeTabs button.active{background:#172033;color:#fff;border-color:#172033}.searchHint{margin-top:9px;font-size:11px;color:#78869a}.notice{margin-top:6px;color:#647184}
        .dayTitle{display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #edf0f4;padding-bottom:10px}.dayTitle>div{display:flex;gap:6px}.resultList{display:grid;gap:7px;margin-top:10px}.resultRow{display:grid;grid-template-columns:minmax(150px,.9fr) minmax(180px,1.2fr) minmax(180px,1fr) auto auto;gap:10px;align-items:center;border:1px solid #e0e6ef;border-radius:12px;padding:11px}.schedulePair{display:grid;gap:5px}.scheduleLeg{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 7px;border-radius:8px;background:#f4f7fb;font-size:12px}.scheduleLeg b{color:#3e5f86}.scheduleLeg span{font-weight:800}.deliveryLeg{background:#f7f4fb}.main{display:grid}.main span,.meta{color:#697587;font-size:12px}.meta{display:flex;gap:5px;flex-wrap:wrap}.meta span{background:#f2f5f8;border-radius:999px;padding:4px 6px}.meta .elapsed{background:#fff4d8;color:#8a5a00;font-weight:900}.state{font-size:12px;font-weight:900;border-radius:999px;padding:5px 8px;background:#f1f3f6;white-space:nowrap}.resultActions{display:grid;grid-template-columns:1fr 1fr;gap:7px;min-width:172px}.editBtn,.cancelBtn{font-size:12px;padding:9px 10px;white-space:nowrap}.cancelBtn{color:#b42318;border-color:#e4a39d;background:#fff8f7}.empty{background:#fff;border-radius:16px;padding:28px;text-align:center;color:#8c98a8}
        @media(max-width:720px){.resultRow{grid-template-columns:1fr}.schedulePair,.main,.meta,.state,.resultActions{grid-column:1}.resultActions{width:100%;min-width:0}.editBtn,.cancelBtn{min-height:44px;font-size:14px}.searchRow{grid-template-columns:1fr}.primary{width:100%}.dayTitle{align-items:flex-start;flex-direction:column}.rangeTabs{display:grid;grid-template-columns:1fr 1fr 1fr}.rangeTabs button{padding:10px 6px;font-size:12px}}
      `}</style>
    </main>
  );
}
