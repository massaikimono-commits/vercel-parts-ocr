/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  WORKSHOP_RECORD_TEMPLATES,
  type WorkshopRecordTemplateKey,
} from "../workshop-record-types";

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number: string | null;
  vehicle_number: string | null;
  chassis_number: string | null;
  maker: string | null;
  model: string | null;
  model_code: string | null;
  fuel_type: string | null;
  vehicle_type: string | null;
};

type WorkOrder = {
  id: string;
  reason: string;
  worker_name: string | null;
  scheduled_at: string | null;
};

type RecordRow = {
  id: string;
  record_type: string;
  inspection_date: string | null;
  interval_months: number | null;
  items: any[] | null;
  status: string;
  work_order_id: string | null;
  updated_at: string;
};

type InspectionItem = {
  id?: string;
  label?: string;
  mark?: string;
  note?: string;
};

const ACTIVE_KEY = "parts-active-vehicle";

function validTemplate(value: string | null): value is WorkshopRecordTemplateKey {
  return Boolean(value && Object.prototype.hasOwnProperty.call(WORKSHOP_RECORD_TEMPLATES, value));
}

function vehicleLabel(vehicle: Vehicle | null) {
  if (!vehicle) return "車両未選択";
  return vehicle.registration_number || vehicle.vehicle_number || vehicle.chassis_number || "車両";
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function statusLabel(status: string) {
  if (status === "printed") return "印刷済み";
  if (status === "confirmed") return "確認済み";
  return "下書き";
}

export default function InspectionPrintPage() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [templateKey, setTemplateKey] = useState<WorkshopRecordTemplateKey | null>(null);
  const [mode, setMode] = useState<"inspection" | "designated">("inspection");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("保存済み記録簿を読み込みます。");

  useEffect(() => { void load(); }, []);

  async function load() {
    setBusy(true);
    try {
      const params = new URLSearchParams(location.search);
      const requestedTemplate = params.get("template");
      const requestedWorkOrderId = params.get("workOrderId") || "";
      const requestedMode = params.get("mode") === "designated" ? "designated" : "inspection";
      setMode(requestedMode);
      if (validTemplate(requestedTemplate)) setTemplateKey(requestedTemplate);

      const active = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
      if (!active?.id) {
        setMessage("先に顧客・車両管理から作業車両を選択してください。");
        return;
      }

      const vehicleRes = await supabase
        .from("vehicles")
        .select("id,customer_id,registration_number,vehicle_number,chassis_number,maker,model,model_code,fuel_type,vehicle_type")
        .eq("id", active.id)
        .single();
      if (vehicleRes.error) throw vehicleRes.error;
      const v = vehicleRes.data as Vehicle;
      setVehicle(v);

      if (v.customer_id) {
        const { data } = await supabase
          .from("customers")
          .select("name,company_name,schedule_display_name")
          .eq("id", v.customer_id)
          .maybeSingle();
        if (data) setCustomerName(data.schedule_display_name || data.company_name || data.name || "");
      }

      if (requestedWorkOrderId) {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id,reason,worker_name,scheduled_at")
          .eq("id", requestedWorkOrderId)
          .eq("vehicle_id", v.id)
          .maybeSingle();
        if (error) throw error;
        setWorkOrder((data || null) as WorkOrder | null);
      }

      let recordQuery = supabase
        .from("inspection_records")
        .select("id,record_type,inspection_date,interval_months,items,status,work_order_id,updated_at")
        .eq("vehicle_id", v.id)
        .eq("record_type", requestedMode === "designated" ? "指定整備記録簿" : "点検整備記録簿");
      recordQuery = requestedWorkOrderId
        ? recordQuery.eq("work_order_id", requestedWorkOrderId)
        : recordQuery.is("work_order_id", null);
      const { data: recordData, error: recordError } = await recordQuery
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recordError) throw recordError;
      setRecord((recordData || null) as RecordRow | null);
      setMessage(recordData
        ? "保存済み内容を印刷プレビューへ反映しました。"
        : "この作業の保存済み記録簿がありません。先に入力画面で保存してください。"
      );
    } catch (error: any) {
      setMessage(`読み込みエラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  async function printAndMark() {
    if (!record || busy) return;
    setBusy(true);
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("inspection_records")
      .update({ status: "printed", updated_at: updatedAt })
      .eq("id", record.id);

    if (error) {
      setMessage(`印刷状態の保存エラー: ${error.message}`);
      setBusy(false);
      return;
    }

    setRecord((current) => current ? { ...current, status: "printed", updated_at: updatedAt } : current);
    setMessage("印刷済みとして保存しました。印刷ダイアログを開きます。");
    setBusy(false);
    window.setTimeout(() => window.print(), 0);
  }

  const items = useMemo(() => {
    if (!record || !Array.isArray(record.items)) return [] as InspectionItem[];
    if (mode === "designated") return [] as InspectionItem[];
    return record.items as InspectionItem[];
  }, [record, mode]);

  const designated = useMemo(() => {
    if (mode !== "designated" || !record || !Array.isArray(record.items)) return null;
    const row = record.items.find((item: any) => item?.id === "brake-force") || record.items[0];
    return row ? { values: row.values || {}, calculated: row.calculated || {} } : null;
  }, [record, mode]);

  const templateLabel = templateKey
    ? WORKSHOP_RECORD_TEMPLATES[templateKey].label
    : mode === "designated" ? "指定整備記録簿" : "点検整備記録簿";

  const canPrint = Boolean(record && !busy && mode !== "designated");
  const inputParams = new URLSearchParams();
  if (templateKey) inputParams.set("template", templateKey);
  if (mode === "designated") inputParams.set("mode", "designated");
  if (workOrder?.id) inputParams.set("workOrderId", workOrder.id);
  const inputUrl = `/inspection${inputParams.toString() ? `?${inputParams.toString()}` : ""}`;

  return (
    <main className="page">
      <header className="top noPrint">
        <button onClick={() => history.back()}>← 戻る</button>
        <strong>icb</strong>
      </header>

      <section className="control noPrint">
        <div>
          <div className="eyebrow">印刷プレビュー</div>
          <h1>{templateLabel}</h1>
          <p>{message}</p>
        </div>
        <div className="actions">
          <button onClick={() => location.assign(inputUrl)}>入力へ戻る</button>
          <button className="primary" disabled={!canPrint} onClick={() => void printAndMark()}>🖨 この内容を印刷</button>
        </div>
      </section>

      {mode === "designated" && (
        <div className="designatedWaiting noPrint">
          指定整備記録簿はA3・PDF参照で実装します。現在はPDF受領待ちのため最終印刷を無効にしています。
        </div>
      )}

      <section className="sheet">
        <div className="sheetHead">
          <div>
            <div className="formType">{mode === "designated" ? "指定整備" : "点検整備"}</div>
            <h2>{templateLabel}</h2>
          </div>
          <div className="recordStatus">{record ? statusLabel(record.status) : "未保存"}</div>
        </div>

        <div className="vehicleGrid">
          <div><small>お客様名</small><b>{customerName || "-"}</b></div>
          <div><small>登録番号</small><b>{vehicleLabel(vehicle)}</b></div>
          <div><small>車台番号</small><b>{vehicle?.chassis_number || "-"}</b></div>
          <div><small>車名・型式</small><b>{[vehicle?.maker, vehicle?.model || vehicle?.model_code].filter(Boolean).join(" / ") || "-"}</b></div>
          <div><small>点検日</small><b>{dateLabel(record?.inspection_date || null)}</b></div>
          <div><small>対象作業</small><b>{workOrder?.reason || "-"}</b></div>
          <div><small>担当者</small><b>{workOrder?.worker_name || "-"}</b></div>
          <div><small>点検周期</small><b>{record?.interval_months ? `${record.interval_months}ヶ月` : "-"}</b></div>
        </div>

        {!record && <div className="empty">保存済み記録簿がないため、印刷できません。</div>}

        {record && mode === "inspection" && (
          <div className="itemTable">
            <div className="tableHead"><span>点検項目</span><span>記号</span><span>備考</span></div>
            {items.map((item, index) => (
              <div className="tableRow" key={item.id || index}>
                <span>{item.label || item.id || `項目${index + 1}`}</span>
                <strong>{item.mark || ""}</strong>
                <span>{item.note || ""}</span>
              </div>
            ))}
            {!items.length && <div className="empty">保存済み点検項目がありません。</div>}
          </div>
        )}

        {record && mode === "designated" && designated && (
          <div className="designatedGrid">
            <div><small>後ブレーキ 左</small><b>{designated.values.rearLeft || "-"}</b></div>
            <div><small>後ブレーキ 右</small><b>{designated.values.rearRight || "-"}</b></div>
            <div><small>後軸重</small><b>{designated.values.rearAxleWeight || "-"}</b></div>
            <div className="wide"><small>後軸制動力</small><b>{designated.calculated.rearSum ?? "-"} ÷ {designated.values.rearAxleWeight || "-"} = {designated.calculated.rearRatio || "-"}</b></div>
            <div><small>ブレーキ総和</small><b>{designated.values.totalBrake || "-"}</b></div>
            <div><small>車両重量</small><b>{designated.values.vehicleWeight || "-"}</b></div>
            <div className="wide"><small>総和</small><b>{designated.values.totalBrake || "-"} ÷ {designated.values.vehicleWeight || "-"} = {designated.calculated.totalRatio || "-"}</b></div>
            <div><small>サイドブレーキ 左</small><b>{designated.values.parkingLeft || "-"}</b></div>
            <div><small>サイドブレーキ 右</small><b>{designated.values.parkingRight || "-"}</b></div>
            <div className="wide"><small>サイドブレーキ</small><b>{designated.calculated.parkingSum ?? "-"} ÷ {designated.values.vehicleWeight || "-"} = {designated.calculated.parkingRatio || "-"}</b></div>
          </div>
        )}

        <div className="foot">
          <span>保存状態: {record ? statusLabel(record.status) : "未保存"}</span>
          <span>印刷前に担当者が内容を確認してください。</span>
        </div>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:1050px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{font:inherit;border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:10px 13px;font-weight:800}button:disabled{opacity:.45}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.control{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:20px;margin-bottom:16px;display:flex;justify-content:space-between;gap:16px;align-items:center}.control h1{margin:4px 0 8px;font-size:27px}.control p{margin:0;color:#657286}.designatedWaiting{max-width:1050px;margin:0 auto 16px;background:#fff8dd;border:1px solid #ead486;border-radius:14px;padding:12px 14px;color:#755b08;font-weight:800}.eyebrow{font-weight:800;color:#2674e8}.actions{display:flex;gap:8px;flex-wrap:wrap}.sheet{background:#fff;width:210mm;min-height:277mm;margin:0 auto;padding:12mm;border:1px solid #d7dde6;box-shadow:0 10px 30px rgba(35,53,78,.08)}.sheetHead{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #172033;padding-bottom:4mm;margin-bottom:4mm}.sheetHead h2{font-size:20px;margin:2mm 0 0}.formType{font-size:12px;font-weight:900;letter-spacing:.08em}.recordStatus{border:1px solid #8e9aad;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800}.vehicleGrid{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid #6f7885;border-left:1px solid #6f7885;margin-bottom:5mm}.vehicleGrid>div{min-height:15mm;border-right:1px solid #6f7885;border-bottom:1px solid #6f7885;padding:2.5mm 3mm;display:grid;gap:1mm}.vehicleGrid small,.designatedGrid small{font-size:10px;color:#5e6875}.vehicleGrid b{font-size:13px}.itemTable{border:1px solid #59616c}.tableHead,.tableRow{display:grid;grid-template-columns:1.5fr 16mm 1fr;min-height:11mm}.tableHead{background:#f1f3f6;font-weight:900}.tableHead>* , .tableRow>*{padding:2.5mm;border-right:1px solid #777f8a;display:flex;align-items:center}.tableHead>*:last-child,.tableRow>*:last-child{border-right:0}.tableRow{border-top:1px solid #777f8a}.tableRow strong{justify-content:center;font-size:18px}.designatedGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:3mm}.designatedGrid>div{border:1px solid #777f8a;min-height:18mm;padding:3mm;display:grid;gap:2mm}.designatedGrid .wide{grid-column:1/-1}.designatedGrid b{font-size:17px}.empty{padding:12mm;text-align:center;border:1px dashed #aab2bd;color:#758091}.foot{display:flex;justify-content:space-between;gap:8px;margin-top:6mm;padding-top:3mm;border-top:1px solid #aab2bd;font-size:10px;color:#68727f}@media(max-width:850px){.control{display:block}.actions{margin-top:12px}.sheet{width:100%;min-height:auto;padding:16px}.vehicleGrid{grid-template-columns:1fr}.designatedGrid{grid-template-columns:1fr}.designatedGrid .wide{grid-column:auto}}@media print{@page{size:A4 portrait;margin:0}body{background:#fff}.page{max-width:none;padding:0}.noPrint{display:none!important}.sheet{width:210mm;min-height:297mm;margin:0;padding:10mm 11mm;border:0;box-shadow:none}.sheetHead{margin-top:0}.foot{position:relative;break-inside:avoid}.itemTable,.designatedGrid{break-inside:avoid}}
      `}</style>
    </main>
  );
}
