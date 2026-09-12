/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { safeActionError, spreadsheetSafeCell } from "../lib/client-security";
import { supabase } from "../supabase";

type Part = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
  vehicleId?: string;
  vehicleNumber?: string;
  registration?: string;
  chassis?: string;
  linkedAt?: string;
};

type ActiveVehicle = {
  id?: string;
  number?: string;
  registration?: string;
  last4?: string;
  chassis?: string;
  model?: string;
};

type FormalPart = {
  id: string;
  vehicle_id: string | null;
  work_order_id: string | null;
  parts_ocr_item_id: string | null;
  part_name: string;
  quantity: number | string;
  list_price: number | string | null;
  purchase_price: number | string | null;
  created_at: string;
  work_order: { id: string; reason: string; status: string } | null;
};

const PARTS_KEY = "parts-data";
const ACTIVE_KEY = "parts-active-vehicle";
const BEFORE_KEY = "parts-before-ocr-ids";
const FORMAL_PAGE_SIZE = 50;

function money(v: string) {
  const n = Number(String(v || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && v !== "" ? n.toLocaleString("ja-JP") : v || "-";
}

function readParts(): Part[] {
  try {
    const x = JSON.parse(localStorage.getItem(PARTS_KEY) || "[]");
    return Array.isArray(x) ? x : [];
  } catch { return []; }
}

function readActive(): ActiveVehicle | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(ACTIVE_KEY) ||
      localStorage.getItem(ACTIVE_KEY) ||
      "null"
    );
  } catch { return null; }
}

function readBeforeIds() {
  try {
    const x = JSON.parse(sessionStorage.getItem(BEFORE_KEY) || "[]");
    return new Set(Array.isArray(x) ? x : []);
  } catch { return new Set<string>(); }
}

export default function PartsDataPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [activeVehicle, setActiveVehicle] = useState<ActiveVehicle | null>(null);
  const [beforeIds, setBeforeIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "active" | "unassigned">("all");
  const [message, setMessage] = useState("部品データを車両ごとに整理できます。");
  const [formalParts, setFormalParts] = useState<FormalPart[]>([]);
  const [formalOffset, setFormalOffset] = useState(0);
  const [formalHasMore, setFormalHasMore] = useState(false);
  const [formalLoading, setFormalLoading] = useState(false);

  useEffect(() => {
    setParts(readParts());
    const active = readActive();
    setActiveVehicle(active);
    setBeforeIds(readBeforeIds());
    if (active?.id) void loadFormalParts(active.id, false);
  }, []);

  function persist(next: Part[]) {
    setParts(next);
    localStorage.setItem(PARTS_KEY, JSON.stringify(next));
  }

  function continueWithActive(path: string) {
    if (!activeVehicle) return;
    const payload = JSON.stringify(activeVehicle);
    sessionStorage.setItem(ACTIVE_KEY, payload);
    localStorage.setItem(ACTIVE_KEY, payload);
    location.assign(path);
  }

  async function loadFormalParts(
    vehicleId: string,
    append: boolean
  ) {
    if (formalLoading) return;
    setFormalLoading(true);

    const start = append ? formalOffset : 0;
    try {
      const { data, error } = await supabase
        .from("parts")
        .select(
          "id,vehicle_id,work_order_id,parts_ocr_item_id,part_name,quantity,list_price,purchase_price,created_at,work_order:work_orders!parts_work_order_id_fkey(id,reason,status)"
        )
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .range(start, start + FORMAL_PAGE_SIZE - 1);

      if (error) throw error;

      const rows = (data || []) as unknown as FormalPart[];
      if (append) {
        setFormalParts((old) => {
          const byId = new Map<string, FormalPart>();
          for (const row of [...old, ...rows]) {
            if (!byId.has(row.id)) byId.set(row.id, row);
          }
          return [...byId.values()];
        });
        setFormalOffset((old) => old + rows.length);
      } else {
        setFormalParts(rows);
        setFormalOffset(rows.length);
      }
      setFormalHasMore(rows.length === FORMAL_PAGE_SIZE);
    } catch (error: any) {
      setMessage(safeActionError("正式部品履歴の読み込み", error));
    } finally {
      setFormalLoading(false);
    }
  }

  async function copyFormalExcel() {
    if (!formalParts.length) return;
    const rows = [
      ["部品名称", "個数", "定価", "仕入れ"],
      ...formalParts.map((part) => [
        part.part_name,
        String(part.quantity ?? ""),
        part.list_price === null ? "" : String(part.list_price),
        part.purchase_price === null
          ? ""
          : String(part.purchase_price),
      ]),
    ];
    await navigator.clipboard?.writeText(
      rows
        .map((row) =>
          row.map(spreadsheetSafeCell).join("\t")
        )
        .join("\n")
    );
    setMessage(
      "表示中の正式保存部品をExcel貼り付け用にコピーしました。"
    );
  }

  function printFormal() {
    if (!formalParts.length) return;
    sessionStorage.setItem(
      "parts-print-data",
      JSON.stringify(
        formalParts.map((part) => ({
          id: part.id,
          name: part.part_name,
          qty: String(part.quantity ?? ""),
          retail:
            part.list_price === null
              ? ""
              : String(part.list_price),
          cost:
            part.purchase_price === null
              ? ""
              : String(part.purchase_price),
        }))
      )
    );
    location.assign("/parts-print?source=formal");
  }

  const currentOcrParts = useMemo(
    () => parts.filter((p) => p.id && !beforeIds.has(p.id)),
    [parts, beforeIds]
  );

  const visible = useMemo(() => {
    if (filter === "unassigned") return parts.filter((p) => !p.vehicleNumber && !p.vehicleId);
    if (filter === "active") {
      if (!activeVehicle) return [];
      return parts.filter((p) =>
        (activeVehicle.id && p.vehicleId === activeVehicle.id) ||
        (activeVehicle.number && p.vehicleNumber === activeVehicle.number)
      );
    }
    return parts;
  }, [parts, filter, activeVehicle]);

  function linkParts(ids: string[]) {
    if (!activeVehicle) {
      setMessage("先に①車体番号で作業車両を選んでください。");
      return;
    }
    const idSet = new Set(ids);
    const next = parts.map((p) => idSet.has(p.id) ? {
      ...p,
      vehicleId: activeVehicle.id || "",
      vehicleNumber: activeVehicle.number || "",
      registration: activeVehicle.registration || "",
      chassis: activeVehicle.chassis || "",
      linkedAt: new Date().toISOString(),
    } : p);
    persist(next);
    sessionStorage.removeItem(BEFORE_KEY);
    setBeforeIds(new Set());
    setMessage(`${ids.length}件を ${activeVehicle.registration || activeVehicle.number || "選択車両"} に紐付けました。`);
  }

  function unlink(id: string) {
    persist(parts.map((p) => p.id === id ? { ...p, vehicleId: "", vehicleNumber: "", registration: "", chassis: "", linkedAt: "" } : p));
    setMessage("車両との紐付けを解除しました。");
  }

  function remove(id: string) {
    if (!confirm("この部品データを削除しますか？")) return;
    persist(parts.filter((p) => p.id !== id));
    setMessage("部品データを削除しました。");
  }

  async function copyExcel() {
    const rows = [
      ["車両", "車体番号", "部品名称", "個数", "定価", "仕入れ"],
      ...visible.map((p) => [p.registration || "", p.vehicleNumber || "", p.name, p.qty, p.retail, p.cost]),
    ];
    await navigator.clipboard?.writeText(rows.map((r) => r.map(spreadsheetSafeCell).join("\t")).join("\n"));
    setMessage("表示中の部品データをExcel貼り付け用にコピーしました。");
  }

  function saveCsv() {
    const rows = [
      ["車両", "車体番号", "部品名称", "個数", "定価", "仕入れ"],
      ...visible.map((p) => [p.registration || "", p.vehicleNumber || "", p.name, p.qty, p.retail, p.cost]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${spreadsheetSafeCell(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "vehicle-parts.csv";
    a.click();
  }

  return (
    <main className="page">
      <div className="top"><button onClick={() => location.assign("/")}>← メインへ</button><strong>icb</strong></div>
      <section className="card partsLead">
        <h1>部品データ管理</h1>
        <p className="partsIntro">OCRの未確定データと、選択車両へ正式保存済みの部品履歴を確認できます。正式保存は確認画面で4項目と保存先を確認してから行います。</p>
        <div className="notice">{message}</div>

        <div className="vehicleBox">
          <div><small>現在の作業車両</small><br /><b>{activeVehicle ? (activeVehicle.registration || activeVehicle.number || activeVehicle.chassis) : "未選択"}</b>{activeVehicle?.model ? `　${activeVehicle.model}` : ""}</div>
          <button onClick={() => location.assign("/vehicle-workflow")}>車両を選び直す</button>
        </div>

        {activeVehicle?.id && (
          <div className="continueBox">
            <b>この車両で続ける</b>
            <div className="actions">
              <button onClick={() => continueWithActive("/schedule/active")}>📅 次回予定登録</button>
              <button onClick={() => continueWithActive("/inspection")}>🧾 記録簿</button>
              <button onClick={() => continueWithActive(`/customer-vehicles/history?vehicle=${encodeURIComponent(activeVehicle.id!)}`)}>🕘 統合履歴</button>
            </div>
          </div>
        )}

        {activeVehicle && currentOcrParts.length > 0 && (
          <div className="newParts">
            <b>今回のOCRで追加された未割り当て部品：{currentOcrParts.length}件</b>
            <div>{currentOcrParts.map((p) => p.name || "名称未入力").join(" / ")}</div>
            <button className="primary" onClick={() => location.assign("/parts-review")}>今回のOCR部品を確認して正式保存</button>
          </div>
        )}

        <div className="filters">
          <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>すべて {parts.length}</button>
          <button className={filter === "active" ? "selected" : ""} onClick={() => setFilter("active")}>作業車両</button>
          <button className={filter === "unassigned" ? "selected" : ""} onClick={() => setFilter("unassigned")}>未割り当て {parts.filter((p) => !p.vehicleNumber && !p.vehicleId).length}</button>
        </div>
        <div className="actions"><button onClick={copyExcel}>📋 Excelへコピー</button><button onClick={saveCsv}>CSV保存</button></div>
      </section>

      <section className="card">
        <div className="formalHead">
          <div>
            <h2>正式保存済み部品</h2>
            <small>
              {activeVehicle
                ? (activeVehicle.registration ||
                  activeVehicle.number ||
                  activeVehicle.chassis ||
                  "選択車両")
                : "車両未選択"}
            </small>
          </div>
          <span>{formalParts.length}件表示</span>
        </div>

        {!activeVehicle?.id && (
          <div className="empty">
            車両を選択すると、その車両の正式部品履歴だけを読み込みます。
          </div>
        )}

        {formalLoading && !formalParts.length && (
          <div className="empty">正式部品履歴を読み込み中…</div>
        )}

        {activeVehicle?.id &&
          !formalLoading &&
          !formalParts.length && (
            <div className="empty">
              この車両の正式保存部品はまだありません。
            </div>
          )}

        {!!formalParts.length && (
          <>
            <div className="actions">
              <button onClick={() => void copyFormalExcel()}>
                📋 Excelへ4項目コピー
              </button>
              <button onClick={printFormal}>
                🖨 既存印刷へ渡す
              </button>
            </div>

            <div className="partList formalList">
              {formalParts.map((part) => (
                <div className="part formalPart" key={part.id}>
                  <div className="partTop">
                    <b>{part.part_name || "名称未入力"}</b>
                    <span>正式保存</span>
                  </div>
                  <div className="numbers">
                    <span>
                      個数 <b>{String(part.quantity ?? "-")}</b>
                    </span>
                    <span>
                      定価{" "}
                      <b>
                        {money(
                          part.list_price === null
                            ? ""
                            : String(part.list_price)
                        )}
                      </b>
                    </span>
                    <span>
                      仕入れ{" "}
                      <b>
                        {money(
                          part.purchase_price === null
                            ? ""
                            : String(part.purchase_price)
                        )}
                      </b>
                    </span>
                  </div>
                  <small className="formalMeta">
                    {new Date(part.created_at).toLocaleString("ja-JP")}
                    {part.work_order
                      ? ` / 関連作業 ${part.work_order.reason}`
                      : " / 関連作業なし"}
                    {part.parts_ocr_item_id
                      ? " / OCR元あり"
                      : ""}
                  </small>
                </div>
              ))}
            </div>

            {formalHasMore && activeVehicle?.id && (
              <div className="actions">
                <button
                  disabled={formalLoading}
                  onClick={() =>
                    void loadFormalParts(activeVehicle.id!, true)
                  }
                >
                  {formalLoading
                    ? "読み込み中…"
                    : `さらに${FORMAL_PAGE_SIZE}件表示`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>未確定・端末保存部品</h2>
        {!visible.length && <div className="empty">未確定の端末部品データはありません。</div>}
        <div className="partList">
          {visible.map((p) => (
            <div className="part" key={p.id}>
              <div className="partTop"><b>{p.name || "名称未入力"}</b><span>{p.registration || p.vehicleNumber || "未割り当て"}</span></div>
              <div className="numbers"><span>個数 <b>{p.qty || "-"}</b></span><span>定価 <b>{money(p.retail)}</b></span><span>仕入れ <b>{money(p.cost)}</b></span></div>
              <div className="rowActions">
                {!p.vehicleNumber && !p.vehicleId && activeVehicle && <button onClick={() => linkParts([p.id])}>作業車両へ紐付け</button>}
                {(p.vehicleNumber || p.vehicleId) && <button onClick={() => unlink(p.id)}>紐付け解除</button>}
                <button className="danger" onClick={() => remove(p.id)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:10px 13px;font-size:15px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0}.vehicleBox{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid #dbe3ee;border-radius:14px;padding:14px}.vehicleBox small{color:#748095}.continueBox{margin-top:12px;padding:12px 14px;border:1px solid #dbe3ee;border-radius:14px;background:#f8fbff}.continueBox>.actions{margin-top:8px}.newParts{margin-top:14px;background:#fff8dd;border:1px solid #f0dc8d;border-radius:14px;padding:14px;display:grid;gap:10px}.primary{background:#2f6fe4;color:white;border-color:#2f6fe4}.filters,.actions,.rowActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.filters .selected{background:#2f6fe4;color:white;border-color:#2f6fe4}.partList{display:grid;gap:10px}.part{border:1px solid #dbe3ee;border-radius:14px;padding:14px}.partTop{display:flex;justify-content:space-between;gap:10px;align-items:center}.partTop span{font-size:13px;background:#eef4ff;color:#2f6fe4;border-radius:999px;padding:5px 9px}.formalHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.formalHead h2{margin:0}.formalHead small,.formalMeta{color:#748095}.formalHead>span{font-size:12px;background:#eef4ff;color:#2f6fe4;border-radius:999px;padding:5px 8px}.formalList{margin-top:10px}.formalPart{border-color:#bcd8c5;background:#f8fcf9}.formalMeta{display:block;margin-top:8px;font-size:11px}.numbers{display:flex;gap:18px;flex-wrap:wrap;color:#5d6878;margin-top:10px}.danger{color:#c43f3f}.empty{padding:22px;text-align:center;color:#8290a3;background:#f8fafc;border-radius:12px}@media(max-width:600px){.page{padding:8px 8px 34px}.top{margin-bottom:7px}.top button{padding:8px 10px}.card{padding:13px;margin-bottom:10px;border-radius:16px}.partsLead h1{font-size:23px;line-height:1.2;margin-bottom:5px}.partsIntro{display:none}.notice{margin:5px 0 7px;padding:8px 10px;font-size:13px}.vehicleBox,.partTop{align-items:flex-start;flex-direction:column}.vehicleBox{padding:10px;gap:7px}.vehicleBox button{min-height:40px;padding:8px 10px}.continueBox{margin-top:8px;padding:10px}.continueBox .actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.continueBox .actions button{min-width:0;padding:8px 5px;min-height:40px;font-size:12px}.newParts{margin-top:8px;padding:10px;gap:7px}.filters,.actions{margin-top:8px;gap:5px}.filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.filters button{min-width:0;padding:8px 5px;min-height:40px;font-size:12px}.partsLead>.actions button{padding:8px 10px;min-height:40px;font-size:13px}.partList{gap:7px}.part{padding:10px}.numbers{margin-top:7px;gap:10px}.rowActions{margin-top:8px;gap:5px}}
      `}</style>
    </main>
  );
}
