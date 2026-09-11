/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { safeActionError } from "../../lib/client-security";
import { supabase } from "../../supabase";

type VehicleSummary = {
  id: string;
  registration_number: string | null;
  registration_number_last4: string | null;
  registration_last4: string | null;
  maker: string | null;
  model: string | null;
  chassis_number: string | null;
};

type TimelineItem = {
  key: string;
  source: string;
  at: string;
  title: string;
  actor?: string;
  related?: string;
  oldValue?: unknown;
  newValue?: unknown;
  details?: unknown;
};

type SourcePage = {
  items: TimelineItem[];
  full: boolean;
};

const DISPLAY_PAGE_SIZE = 25;
const SOURCE_PAGE_SIZE = 25;
const SOURCE_FILTERS = ["すべて", "車両操作", "作業", "入出庫", "予定変更", "記録簿", "点検履歴"] as const;

function naturalLast4(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function vehicleLabel(vehicle: VehicleSummary | null) {
  if (!vehicle) return "車両";
  const last4 = naturalLast4(vehicle.registration_number_last4 || vehicle.registration_last4);
  const model = [vehicle.maker, vehicle.model].filter(Boolean).join(" ");
  return [last4 ? `車番 ${last4}` : "", model].filter(Boolean).join(" / ")
    || vehicle.registration_number
    || "車両";
}

function jst(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return text ? text.slice(0, 8) : "";
}

function compactJson(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function actionLabel(value: string) {
  const labels: Record<string, string> = {
    REGISTER_WORK_ORDER: "作業登録",
    PRINT_INSPECTION_RECORD: "点検整備記録簿を印刷",
    PRINT_DESIGNATED_RECORD: "指定整備記録簿を印刷",
    OPEN_PARTS_OCR: "部品OCRを開く",
    SAVE_PARTS_OCR: "部品OCRを保存",
    SAVE_VEHICLE_CERTIFICATE: "車検証情報を保存",
    EDIT_VEHICLE: "車両情報を変更",
    OTHER: "車両操作",
  };
  return labels[value] || value;
}

function completionLabel(value: string) {
  return value === "completed" ? "作業完了" : value === "reopened" ? "作業再開" : value;
}

function presenceLabel(value: string) {
  const labels: Record<string, string> = {
    checked_in: "入庫",
    checked_out: "出庫",
    delivery_completed: "納車完了",
    delivery_reopened: "納車完了解除",
  };
  return labels[value] || value;
}

function scheduleChangeLabel(value: string) {
  const labels: Record<string, string> = {
    CHECKIN: "入庫予定を変更",
    DELIVERY: "納車予定を変更",
    COMPLETION: "完成予定を変更",
    WORKER: "担当者を変更",
    REASON: "入庫理由を変更",
    OTHER: "予定情報を変更",
  };
  return labels[value] || value;
}

function inspectionAuditLabel(value: string) {
  const labels: Record<string, string> = {
    CREATED: "記録簿を作成",
    AUTO_DECIDED: "記録簿を自動判定",
    MANUALLY_CHANGED: "記録簿を手動変更",
    FORM_UPLOADED: "記録簿書類を取込",
    PARTS_APPLIED: "部品情報を記録簿へ反映",
    FINALIZED: "記録簿を確定",
    PRINTED: "記録簿を印刷",
  };
  return labels[value] || value;
}

function workOrderOf(row: any) {
  const rel = row?.work_order;
  return Array.isArray(rel) ? rel[0] || null : rel || null;
}

function inspectionJobOf(row: any) {
  const rel = row?.inspection_job;
  return Array.isArray(rel) ? rel[0] || null : rel || null;
}

function sortItems(items: TimelineItem[]) {
  return [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export default function VehicleHistoryPage() {
  const [vehicleId, setVehicleId] = useState("");
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(DISPLAY_PAGE_SIZE);
  const [sourceRound, setSourceRound] = useState(1);
  const [sourceHasMore, setSourceHasMore] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<(typeof SOURCE_FILTERS)[number]>("すべて");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("履歴を読み込んでいます。");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("vehicle")?.trim() || "";
    setVehicleId(id);
    if (!id) {
      setBusy(false);
      setMessage("車両が指定されていません。顧客・車両管理から車両を選んでください。");
      return;
    }
    void loadInitial(id);
  }, []);

  const filteredItems = useMemo(
    () => sourceFilter === "すべて" ? items : items.filter((item) => item.source === sourceFilter),
    [items, sourceFilter]
  );
  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);
  const canShowMore = visibleCount < filteredItems.length || sourceHasMore;

  async function loadInitial(id: string) {
    setBusy(true);
    try {
      const [vehicleResult, historyPages] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id,registration_number,registration_number_last4,registration_last4,maker,model,chassis_number")
          .eq("id", id)
          .maybeSingle(),
        loadSourceRound(id, 0),
      ]);
      if (vehicleResult.error) throw vehicleResult.error;
      if (!vehicleResult.data) {
        setVehicle(null);
        setItems([]);
        setMessage("指定した車両が見つかりませんでした。");
        return;
      }

      const merged = sortItems(historyPages.flatMap((page) => page.items));
      setVehicle(vehicleResult.data as VehicleSummary);
      setItems(merged);
      setVisibleCount(DISPLAY_PAGE_SIZE);
      setSourceRound(1);
      setSourceHasMore(historyPages.some((page) => page.full));
      setMessage(
        merged.length
          ? `最新${Math.min(DISPLAY_PAGE_SIZE, merged.length)}件を表示しています。`
          : "この車両の既存履歴はまだありません。"
      );
    } catch (error: any) {
      setMessage(safeActionError("車両履歴の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  async function loadSourceRound(id: string, round: number): Promise<SourcePage[]> {
    const start = round * SOURCE_PAGE_SIZE;
    const end = start + SOURCE_PAGE_SIZE - 1;

    const [
      actionResult,
      completionResult,
      presenceResult,
      scheduleChangeResult,
      inspectionAuditResult,
      omissionResult,
    ] = await Promise.all([
      supabase
        .from("vehicle_action_history")
        .select("id,action_type,work_order_id,inspection_record_id,details,created_at")
        .eq("vehicle_id", id)
        .order("created_at", { ascending: false })
        .range(start, end),
      supabase
        .from("work_order_completion_events")
        .select("id,event_type,previous_status,new_status,actor,created_at,work_order:work_orders!inner(id,vehicle_id,reason)")
        .eq("work_order.vehicle_id", id)
        .order("created_at", { ascending: false })
        .range(start, end),
      supabase
        .from("work_order_presence_events")
        .select("id,event_type,actor,created_at,work_order:work_orders!inner(id,vehicle_id,reason)")
        .eq("work_order.vehicle_id", id)
        .order("created_at", { ascending: false })
        .range(start, end),
      supabase
        .from("work_order_schedule_changes")
        .select("id,change_type,old_value,new_value,changed_by,changed_at,work_order:work_orders!inner(id,vehicle_id,reason)")
        .eq("work_order.vehicle_id", id)
        .order("changed_at", { ascending: false })
        .range(start, end),
      supabase
        .from("inspection_record_audit")
        .select("id,event_type,field_name,old_value,new_value,actor,source,created_at,inspection_job:inspection_jobs!inner(id,vehicle_id,work_order_id,record_type)")
        .eq("inspection_job.vehicle_id", id)
        .order("created_at", { ascending: false })
        .range(start, end),
      supabase
        .from("inspection_distance_omission_history")
        .select("id,item_code,inspection_date,odometer_km,omitted_for_distance,consecutive_omission_count,created_at")
        .eq("vehicle_id", id)
        .order("created_at", { ascending: false })
        .range(start, end),
    ]);

    for (const result of [
      actionResult,
      completionResult,
      presenceResult,
      scheduleChangeResult,
      inspectionAuditResult,
      omissionResult,
    ]) {
      if (result.error) throw result.error;
    }

    const actions = (actionResult.data || []) as unknown as any[];
    const completions = (completionResult.data || []) as unknown as any[];
    const presences = (presenceResult.data || []) as unknown as any[];
    const scheduleChanges = (scheduleChangeResult.data || []) as unknown as any[];
    const inspectionAudits = (inspectionAuditResult.data || []) as unknown as any[];
    const omissions = (omissionResult.data || []) as unknown as any[];

    return [
      {
        full: actions.length === SOURCE_PAGE_SIZE,
        items: actions.map((row) => {
          const details = row.details && typeof row.details === "object" ? row.details : {};
          return {
            key: `vehicle-action-${row.id}`,
            source: "車両操作",
            at: row.created_at,
            title: actionLabel(row.action_type),
            actor: typeof details.actor === "string" ? details.actor : undefined,
            related: row.work_order_id
              ? `作業 ${shortId(row.work_order_id)}`
              : row.inspection_record_id
                ? `記録簿 ${shortId(row.inspection_record_id)}`
                : undefined,
            details: row.details,
          };
        }),
      },
      {
        full: completions.length === SOURCE_PAGE_SIZE,
        items: completions.map((row) => {
          const work = workOrderOf(row);
          return {
            key: `completion-${row.id}`,
            source: "作業",
            at: row.created_at,
            title: completionLabel(row.event_type),
            actor: row.actor || undefined,
            related: work ? `${work.reason || "作業"} / ${shortId(work.id)}` : undefined,
            oldValue: row.previous_status,
            newValue: row.new_status,
          };
        }),
      },
      {
        full: presences.length === SOURCE_PAGE_SIZE,
        items: presences.map((row) => {
          const work = workOrderOf(row);
          return {
            key: `presence-${row.id}`,
            source: "入出庫",
            at: row.created_at,
            title: presenceLabel(row.event_type),
            actor: row.actor || undefined,
            related: work ? `${work.reason || "作業"} / ${shortId(work.id)}` : undefined,
          };
        }),
      },
      {
        full: scheduleChanges.length === SOURCE_PAGE_SIZE,
        items: scheduleChanges.map((row) => {
          const work = workOrderOf(row);
          return {
            key: `schedule-change-${row.id}`,
            source: "予定変更",
            at: row.changed_at,
            title: scheduleChangeLabel(row.change_type),
            actor: row.changed_by || undefined,
            related: work ? `${work.reason || "作業"} / ${shortId(work.id)}` : undefined,
            oldValue: row.old_value,
            newValue: row.new_value,
          };
        }),
      },
      {
        full: inspectionAudits.length === SOURCE_PAGE_SIZE,
        items: inspectionAudits.map((row) => {
          const job = inspectionJobOf(row);
          return {
            key: `inspection-audit-${row.id}`,
            source: "記録簿",
            at: row.created_at,
            title: inspectionAuditLabel(row.event_type),
            actor: row.actor || undefined,
            related: job
              ? `${job.record_type || "記録簿"} / ${shortId(job.id)}${job.work_order_id ? ` / 作業 ${shortId(job.work_order_id)}` : ""}`
              : undefined,
            oldValue: row.old_value,
            newValue: row.new_value,
            details: {
              field_name: row.field_name || undefined,
              source: row.source || undefined,
            },
          };
        }),
      },
      {
        full: omissions.length === SOURCE_PAGE_SIZE,
        items: omissions.map((row) => ({
          key: `distance-omission-${row.id}`,
          source: "点検履歴",
          at: row.created_at,
          title: row.omitted_for_distance ? "距離条件により点検省略" : "距離条件点検を実施",
          details: {
            item_code: row.item_code,
            inspection_date: row.inspection_date,
            odometer_km: row.odometer_km,
            consecutive_omission_count: row.consecutive_omission_count,
          },
        })),
      },
    ];
  }

  function rememberVehicleAndOpen(path: string) {
    if (!vehicle) return;
    const snapshot = JSON.stringify({
      id: vehicle.id,
      registration: vehicle.registration_number || "",
      last4: vehicle.registration_number_last4 || vehicle.registration_last4 || "",
      chassis: vehicle.chassis_number || "",
      model: vehicle.model || "",
    });
    try { sessionStorage.setItem("parts-active-vehicle", snapshot); } catch {}
    try { localStorage.setItem("parts-active-vehicle", snapshot); } catch {}
    location.assign(path);
  }

  async function showMore() {
    if (busy) return;

    // Any source that filled its last page may still contain rows newer than
    // buffered rows from another source. Load the next bounded source round
    // before exposing the next unified page so global newest-first order stays correct.
    if (sourceHasMore && vehicleId) {
      setBusy(true);
      try {
        const pages = await loadSourceRound(vehicleId, sourceRound);
        const additions = pages.flatMap((page) => page.items);
        const byKey = new Map(items.map((item) => [item.key, item]));
        additions.forEach((item) => byKey.set(item.key, item));
        const merged = sortItems([...byKey.values()]);
        setItems(merged);
        setSourceRound((old) => old + 1);
        setSourceHasMore(pages.some((page) => page.full));
        setVisibleCount((old) => Math.min(old + DISPLAY_PAGE_SIZE, merged.length));
        setMessage(`履歴を${Math.min(visibleCount + DISPLAY_PAGE_SIZE, merged.length)}件表示しています。`);
      } catch (error: any) {
        setMessage(safeActionError("車両履歴の追加読み込み", error));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (visibleCount < items.length) {
      const next = Math.min(visibleCount + DISPLAY_PAGE_SIZE, items.length);
      setVisibleCount(next);
      setMessage(`履歴を${next}件表示しています。`);
    }
  }

  return (
    <main className="historyPage">
      <header className="top">
        <button onClick={() => history.back()}>← 戻る</button>
        <strong>icb</strong>
      </header>

      <section className="vehicleCard card">
        <div>
          <span>統合履歴</span>
          <h1>{vehicleLabel(vehicle)}</h1>
          {vehicle?.chassis_number && <small>車台番号 {vehicle.chassis_number}</small>}
        </div>
        <button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>
      </section>

      <div className="notice">{busy && !items.length ? "読み込み中…" : message}</div>

      {vehicle && (
        <section className="continueCard card">
          <b>この車両で続ける</b>
          <div className="continueActions">
            <button onClick={() => rememberVehicleAndOpen("/schedule/active")}>📅 次回予定登録</button>
            <button onClick={() => rememberVehicleAndOpen("/inspection")}>🧾 記録簿</button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="sectionHead">
          <h2>最新履歴</h2>
          <span>{visibleItems.length}件表示</span>
        </div>

        <div className="sourceFilters" aria-label="履歴の種類">
          {SOURCE_FILTERS.map((source) => (
            <button
              type="button"
              key={source}
              className={sourceFilter === source ? "active" : ""}
              onClick={() => { setSourceFilter(source); setVisibleCount(DISPLAY_PAGE_SIZE); }}
            >
              {source}
            </button>
          ))}
        </div>
        <p className="filterNote">読み込み済み履歴を種類ごとに絞り込みます。DBの再検索は行いません。</p>

        {!busy && !visibleItems.length && (
          <div className="empty">この車両に紐付く既存履歴はまだありません。</div>
        )}

        <div className="timeline">
          {visibleItems.map((item) => {
            const oldText = compactJson(item.oldValue);
            const newText = compactJson(item.newValue);
            const detailsText = compactJson(item.details);
            const hasDetail = Boolean(oldText || newText || detailsText);
            return (
              <article className="timelineItem" key={item.key}>
                <div className="timelineDot" aria-hidden="true" />
                <div className="timelineBody">
                  <div className="timelineTop">
                    <div>
                      <span className="sourceBadge">{item.source}</span>
                      <b>{item.title}</b>
                    </div>
                    <time>{jst(item.at)}</time>
                  </div>

                  <div className="meta">
                    {item.actor && <span>担当 / 操作：{item.actor}</span>}
                    {item.related && <span>関連：{item.related}</span>}
                  </div>

                  {hasDetail && (
                    <details>
                      <summary>詳細</summary>
                      <div className="detailGrid">
                        {oldText && <div><small>変更前</small><pre>{oldText}</pre></div>}
                        {newText && <div><small>変更後</small><pre>{newText}</pre></div>}
                        {detailsText && <div className="wide"><small>記録内容</small><pre>{detailsText}</pre></div>}
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {canShowMore && (
          <div className="more">
            <button disabled={busy} onClick={() => void showMore()}>
              {busy ? "読み込み中…" : `さらに${DISPLAY_PAGE_SIZE}件表示`}
            </button>
          </div>
        )}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button{font:inherit;border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 12px;font-weight:800}button:disabled{opacity:.5}
        .historyPage{max-width:920px;margin:0 auto;padding:16px 14px 52px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:16px;margin-bottom:12px}
        .vehicleCard{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.vehicleCard>div{display:grid;gap:3px}.vehicleCard span{font-size:11px;font-weight:900;color:#2674e8}.vehicleCard h1{font-size:25px;line-height:1.2;margin:0}.vehicleCard small{color:#6b7789}
        .notice{background:#eef5ff;border:1px solid #d6e6fb;color:#40546e;border-radius:11px;padding:9px 11px;margin-bottom:10px;font-size:13px}.sectionHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.sectionHead h2{font-size:21px;margin:0}.sectionHead>span{font-size:12px;background:#eef4ff;color:#2674e8;border-radius:999px;padding:5px 8px}.sourceFilters{display:flex;gap:6px;overflow-x:auto;padding:9px 0 2px;scrollbar-width:none}.sourceFilters::-webkit-scrollbar{display:none}.sourceFilters button{flex:0 0 auto;padding:7px 10px;font-size:11px}.sourceFilters button.active{background:#2f6fe4;border-color:#2f6fe4;color:#fff}.filterNote{margin:5px 0 0;color:#718096;font-size:11px}
        .timeline{display:grid;margin-top:10px}.timelineItem{position:relative;display:grid;grid-template-columns:18px minmax(0,1fr);gap:7px}.timelineItem:not(:last-child):before{content:"";position:absolute;left:7px;top:16px;bottom:-1px;width:2px;background:#e1e7ef}.timelineDot{width:14px;height:14px;border:3px solid #fff;border-radius:50%;background:#2f6fe4;box-shadow:0 0 0 1px #b9c9df;margin-top:14px;z-index:1}
        .timelineBody{border:1px solid #dbe3ee;border-radius:13px;padding:11px;margin-bottom:8px;min-width:0}.timelineTop{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.timelineTop>div{display:flex;align-items:center;gap:7px;min-width:0}.sourceBadge{font-size:10px;font-weight:900;padding:4px 7px;border-radius:999px;background:#eef4ff;color:#2674e8;white-space:nowrap}.timelineTop>b{font-size:14px}.timelineTop time{font-size:11px;color:#718096;white-space:nowrap}.meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:11px;color:#657386}
        .timelineBody details{margin-top:7px;border-top:1px solid #edf0f4;padding-top:6px}.timelineBody summary{cursor:pointer;color:#49617d;font-size:11px;font-weight:800}.detailGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:7px}.detailGrid>div{background:#f8fafc;border-radius:9px;padding:8px;min-width:0}.detailGrid .wide{grid-column:1/-1}.detailGrid small{display:block;color:#718096;margin-bottom:4px}.detailGrid pre{margin:0;white-space:pre-wrap;word-break:break-word;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#364152}
        .continueCard{display:flex;align-items:center;justify-content:space-between;gap:10px}.continueActions{display:flex;gap:8px;flex-wrap:wrap}.continueActions button{min-height:40px}.more{display:flex;justify-content:center;margin-top:9px}.empty{margin-top:10px;padding:20px;text-align:center;color:#8491a3;background:#f8fafc;border-radius:12px}
        @media(max-width:650px){.continueCard{display:grid}.continueActions{display:grid;grid-template-columns:1fr 1fr}.continueActions button{width:100%;font-size:12px;padding:8px}.historyPage{padding:7px 7px 34px}.top{margin-bottom:5px}.top button{min-height:40px;padding:7px 9px}.card{padding:10px;margin-bottom:8px;border-radius:14px}.vehicleCard h1{font-size:19px}.vehicleCard button{min-height:40px;font-size:11px;padding:7px}.notice{font-size:12px;padding:7px 8px;margin-bottom:7px}.sectionHead h2{font-size:18px}.sourceFilters{margin-right:-3px}.sourceFilters button{min-height:40px;padding:7px 11px}.filterNote{font-size:10px}.timeline{margin-top:7px}.timelineItem{grid-template-columns:15px minmax(0,1fr);gap:5px}.timelineItem:not(:last-child):before{left:6px}.timelineDot{width:12px;height:12px;margin-top:13px}.timelineBody{padding:9px;margin-bottom:6px;border-radius:11px}.timelineTop{display:grid;gap:4px}.timelineTop>div{align-items:flex-start}.timelineTop time{font-size:10px}.meta{display:grid;gap:3px}.detailGrid{grid-template-columns:1fr}.detailGrid .wide{grid-column:auto}.more button{width:100%;min-height:42px}}
      `}</style>
    </main>
  );
}
