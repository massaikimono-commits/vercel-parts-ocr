"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  WORKSHOP_RECORD_TEMPLATES,
  decideWorkshopRecordTemplate,
  type WorkshopRecordTemplateKey,
} from "../workshop-record-types";

type Vehicle = {
  id: string;
  registration_number: string | null;
  vehicle_number: string | null;
  chassis_number: string | null;
  maker: string | null;
  model: string | null;
  model_code: string | null;
  vehicle_type: string | null;
  usage_type: string | null;
  usage_category: string | null;
  body_type: string | null;
  inspection_legal_class: string | null;
};

type WorkOrder = {
  id: string;
  reason: string;
  status: string;
  worker_name: string | null;
  scheduled_at: string | null;
};

const ACTIVE_KEY = "parts-active-vehicle";
const RECORD_TEMPLATE_KEY = "inspection-record-template";

function includesAny(value: string, words: string[]) {
  const text = value.toLowerCase();
  return words.some((word) => text.includes(word.toLowerCase()));
}

function classificationInput(vehicle: Vehicle) {
  const combined = [
    vehicle.usage_type,
    vehicle.usage_category,
    vehicle.body_type,
    vehicle.vehicle_type,
    vehicle.inspection_legal_class,
  ].filter(Boolean).join(" ");

  const businessUse = includesAny(combined, ["事業用", "営業用"]);
  const cargo = includesAny(combined, ["貨物", "トラック", "cargo", "truck"]);
  const light = includesAny(combined, ["軽", "軽自動車"]);

  return {
    usage: [vehicle.usage_type, vehicle.usage_category].filter(Boolean).join(" ") || null,
    vehicleType: [vehicle.vehicle_type, vehicle.body_type].filter(Boolean).join(" ") || null,
    purpose: vehicle.inspection_legal_class || null,
    businessUse,
    rentalUse: includesAny(combined, ["貸渡", "レンタ"]),
    isTrailer: includesAny(combined, ["被牽引", "トレーラ", "trailer"]),
    isMotorcycle: includesAny(combined, ["二輪", "motorcycle", "bike"]),
    isLightCargoBusiness: businessUse && cargo && light,
  };
}

function vehicleLabel(vehicle: Vehicle | null) {
  if (!vehicle) return "車両未選択";
  return vehicle.registration_number || vehicle.vehicle_number || vehicle.chassis_number || "車両";
}

export default function InspectionRecordSelectPage() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workOrderId, setWorkOrderId] = useState("");
  const [manualTemplate, setManualTemplate] = useState<WorkshopRecordTemplateKey | "">("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("使用する記録簿を判定します。");

  useEffect(() => { void load(); }, []);

  async function load() {
    setBusy(true);
    try {
      const active = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
      if (!active?.id) {
        setMessage("先に顧客・車両管理から作業車両を選択してください。");
        return;
      }

      const [vehicleRes, workRes] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id,registration_number,vehicle_number,chassis_number,maker,model,model_code,vehicle_type,usage_type,usage_category,body_type,inspection_legal_class")
          .eq("id", active.id)
          .single(),
        supabase
          .from("work_orders")
          .select("id,reason,status,worker_name,scheduled_at")
          .eq("vehicle_id", active.id)
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      if (vehicleRes.error) throw vehicleRes.error;
      if (workRes.error) throw workRes.error;

      setVehicle(vehicleRes.data as Vehicle);
      const works = (workRes.data || []) as WorkOrder[];
      setWorkOrders(works);
      setWorkOrderId(works[0]?.id || "");
      setMessage("車両情報と作業内容から記録簿候補を判定しました。");
    } catch (error: any) {
      setMessage(`読み込みエラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  const selectedWork = useMemo(
    () => workOrders.find((work) => work.id === workOrderId) || null,
    [workOrders, workOrderId]
  );

  const automaticDecision = useMemo(() => {
    if (!vehicle) return null;
    return decideWorkshopRecordTemplate({
      vehicle: classificationInput(vehicle),
      workReason: selectedWork?.reason || null,
    });
  }, [vehicle, selectedWork]);

  const chosenKey = manualTemplate || automaticDecision?.key || "";
  const chosen = chosenKey ? WORKSHOP_RECORD_TEMPLATES[chosenKey] : null;
  const needsReview = manualTemplate ? false : (automaticDecision?.needsReview ?? true);

  function continueToRecord() {
    if (!chosenKey) {
      setMessage("記録簿を選択してから進んでください。");
      return;
    }
    localStorage.setItem(RECORD_TEMPLATE_KEY, JSON.stringify({
      key: chosenKey,
      workOrderId: workOrderId || null,
      selectedAt: new Date().toISOString(),
      source: manualTemplate ? "manual" : "automatic",
    }));
    const params = new URLSearchParams();
    params.set("template", chosenKey);
    if (workOrderId) params.set("workOrderId", workOrderId);
    location.assign(`/inspection?${params.toString()}`);
  }

  return (
    <main className="page">
      <header className="top">
        <button onClick={() => location.assign("/customer-vehicles")}>← 車両管理へ</button>
        <strong>icb</strong>
      </header>

      <section className="card hero">
        <div className="eyebrow">記録簿選択</div>
        <h1>{vehicleLabel(vehicle)}</h1>
        <p>{[vehicle?.maker, vehicle?.model || vehicle?.model_code].filter(Boolean).join(" / ") || "車両情報を確認中"}</p>
        <div className={`notice ${needsReview ? "warn" : ""}`}>{busy ? "処理中…" : message}</div>
      </section>

      <section className="card">
        <div className="grid">
          <label>
            対象作業
            <select value={workOrderId} onChange={(e) => { setWorkOrderId(e.target.value); setManualTemplate(""); }}>
              <option value="">作業指定なし</option>
              {workOrders.map((work) => (
                <option key={work.id} value={work.id}>{work.reason}{work.worker_name ? ` / ${work.worker_name}` : ""}</option>
              ))}
            </select>
          </label>
          <label>
            記録簿を手動で変更
            <select value={manualTemplate} onChange={(e) => setManualTemplate(e.target.value as WorkshopRecordTemplateKey | "")}>
              <option value="">自動判定を使用</option>
              {Object.values(WORKSHOP_RECORD_TEMPLATES).map((template) => (
                <option key={template.key} value={template.key}>{template.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className={`card decision ${needsReview ? "review" : "ready"}`}>
        <div className="decisionHead">
          <div>
            <div className="eyebrow">使用候補</div>
            <h2>{chosen?.label || "使用記録簿を確認"}</h2>
          </div>
          <span className="badge">{manualTemplate ? "手動選択" : needsReview ? "要確認" : "自動判定"}</span>
        </div>
        <p>{manualTemplate ? "担当者が記録簿を選択しました。" : automaticDecision?.reason || "車両情報が不足しています。"}</p>
        {chosen?.family === "WORKSHOP_SCHEDULE" && (
          <div className="info">法定点検とは別の、工場独自「スケジュール点検」チェックシートとして扱います。</div>
        )}
        {needsReview && !manualTemplate && (
          <div className="warning">初回はこの候補を担当者が確認してください。未対応の車種は別の用紙へ勝手に割り当てません。</div>
        )}
      </section>

      <section className="card actions">
        <button onClick={() => location.assign("/inspection")}>記録簿画面を直接開く</button>
        <button className="primary" disabled={!chosenKey || busy} onClick={continueToRecord}>この記録簿で入力へ →</button>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button,input,select{font:inherit}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:11px 14px;font-weight:800}button:disabled{opacity:.45}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}.hero h1{font-size:31px;margin:5px 0}.hero p{color:#647184}.eyebrow{font-weight:800;color:#2674e8}.notice{margin-top:12px;background:#edf7ef;border:1px solid #c5e5ce;border-radius:12px;padding:11px 13px}.notice.warn{background:#fff8df;border-color:#ead88f}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid label{display:grid;gap:6px;color:#5f6b7a;font-weight:700}select{width:100%;border:1px solid #cbd6e3;border-radius:10px;padding:11px;background:#fff}.decision{border-width:2px}.decision.ready{border-color:#acd7b7}.decision.review{border-color:#ead88f}.decisionHead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.decision h2{margin:5px 0 8px}.badge{background:#eef4ff;border-radius:999px;padding:6px 10px;font-size:13px;font-weight:800;white-space:nowrap}.info,.warning{border-radius:12px;padding:12px 14px;margin-top:12px;line-height:1.6}.info{background:#eef5ff}.warning{background:#fff8df;border:1px solid #ead88f}.actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}@media(max-width:680px){.grid{grid-template-columns:1fr}.decisionHead{display:block}.badge{display:inline-block;margin-top:6px}.actions button{width:100%}}
      `}</style>
    </main>
  );
}
