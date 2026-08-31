/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { spreadsheetSafeCell } from "../lib/client-security";

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

const PARTS_KEY = "parts-data";
const ACTIVE_KEY = "parts-active-vehicle";
const BEFORE_KEY = "parts-before-ocr-ids";

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
  try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); } catch { return null; }
}

function readBeforeIds() {
  try {
    const x = JSON.parse(localStorage.getItem(BEFORE_KEY) || "[]");
    return new Set(Array.isArray(x) ? x : []);
  } catch { return new Set<string>(); }
}

export default function PartsDataPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [activeVehicle, setActiveVehicle] = useState<ActiveVehicle | null>(null);
  const [beforeIds, setBeforeIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "active" | "unassigned">("all");
  const [message, setMessage] = useState("部品データを車両ごとに整理できます。");

  useEffect(() => {
    setParts(readParts());
    setActiveVehicle(readActive());
    setBeforeIds(readBeforeIds());
  }, []);

  function persist(next: Part[]) {
    setParts(next);
    localStorage.setItem(PARTS_KEY, JSON.stringify(next));
  }

  const currentOcrParts = useMemo(
    () => parts.filter((p) => p.id && !beforeIds.has(p.id) && !p.vehicleNumber && !p.vehicleId),
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
    localStorage.removeItem(BEFORE_KEY);
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
      <section className="card">
        <h1>部品データ管理</h1>
        <p>OCRで保存した部品を車両ごとに整理します。作業車両を選んでからOCRした場合は、今回追加した部品をまとめて紐付けできます。</p>
        <div className="notice">{message}</div>

        <div className="vehicleBox">
          <div><small>現在の作業車両</small><br /><b>{activeVehicle ? (activeVehicle.registration || activeVehicle.number || activeVehicle.chassis) : "未選択"}</b>{activeVehicle?.model ? `　${activeVehicle.model}` : ""}</div>
          <button onClick={() => location.assign("/vehicle-workflow")}>車両を選び直す</button>
        </div>

        {activeVehicle && currentOcrParts.length > 0 && (
          <div className="newParts">
            <b>今回のOCRで追加された未割り当て部品：{currentOcrParts.length}件</b>
            <div>{currentOcrParts.map((p) => p.name || "名称未入力").join(" / ")}</div>
            <button className="primary" onClick={() => linkParts(currentOcrParts.map((p) => p.id))}>今回のOCR部品をこの車両へ紐付け</button>
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
        <h2>保存部品</h2>
        {!visible.length && <div className="empty">表示する部品データがありません。</div>}
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
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:10px 13px;font-size:15px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0}.vehicleBox{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid #dbe3ee;border-radius:14px;padding:14px}.vehicleBox small{color:#748095}.newParts{margin-top:14px;background:#fff8dd;border:1px solid #f0dc8d;border-radius:14px;padding:14px;display:grid;gap:10px}.primary{background:#2f6fe4;color:white;border-color:#2f6fe4}.filters,.actions,.rowActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.filters .selected{background:#2f6fe4;color:white;border-color:#2f6fe4}.partList{display:grid;gap:10px}.part{border:1px solid #dbe3ee;border-radius:14px;padding:14px}.partTop{display:flex;justify-content:space-between;gap:10px;align-items:center}.partTop span{font-size:13px;background:#eef4ff;color:#2f6fe4;border-radius:999px;padding:5px 9px}.numbers{display:flex;gap:18px;flex-wrap:wrap;color:#5d6878;margin-top:10px}.danger{color:#c43f3f}.empty{padding:22px;text-align:center;color:#8290a3;background:#f8fafc;border-radius:12px}@media(max-width:600px){.vehicleBox,.partTop{align-items:flex-start;flex-direction:column}}
      `}</style>
    </main>
  );
}
