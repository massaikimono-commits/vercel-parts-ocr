/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number: string | null;
  registration_number_last4: string | null;
  vehicle_number: string | null;
  chassis_number: string | null;
  maker: string | null;
  model: string | null;
  model_code: string | null;
  fuel_type: string | null;
  vehicle_type: string | null;
  vehicle_weight: number | null;
  curb_weight_kg: number | null;
  rear_rear_axle_weight_kg: number | null;
  rear_front_axle_weight_kg: number | null;
};

type WorkOrder = {
  id: string;
  reason: string;
  status: string;
  worker_name: string | null;
  scheduled_at: string | null;
};

type Part = {
  id: string;
  part_name: string;
  quantity: number | null;
  created_at: string;
};

type InspectionItem = {
  id: string;
  label: string;
  mark: "" | "／" | "✓" | "×" | "L" | "○";
  note: string;
};

type DesignatedValues = {
  rearLeft: string;
  rearRight: string;
  totalBrake: string;
  parkingLeft: string;
  parkingRight: string;
  rearAxleWeight: string;
  vehicleWeight: string;
};

const ACTIVE_KEY = "parts-active-vehicle";
const DEFAULT_ITEMS: InspectionItem[] = [
  { id: "brake-pad", label: "ブレーキ・パッドの摩耗", mark: "", note: "" },
  { id: "brake-drum", label: "ブレーキ・ドラム／ディスク", mark: "", note: "" },
  { id: "brake-fluid", label: "ブレーキ液", mark: "", note: "" },
  { id: "engine-oil", label: "エンジン・オイル", mark: "", note: "" },
  { id: "belt", label: "ベルト類", mark: "", note: "" },
  { id: "tire", label: "タイヤ", mark: "", note: "" },
  { id: "lamp", label: "灯火装置", mark: "", note: "" },
  { id: "battery", label: "バッテリー／電気装置", mark: "", note: "" },
];

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const n = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator <= 0) return "-";
  return (numerator / denominator).toFixed(3);
}

function vehicleLabel(v: Vehicle | null) {
  if (!v) return "車両未選択";
  return v.registration_number || v.vehicle_number || v.chassis_number || "車両";
}

export default function InspectionPage() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workOrderId, setWorkOrderId] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [mode, setMode] = useState<"inspection" | "designated">("inspection");
  const [inspectionDate, setInspectionDate] = useState(todayJst());
  const [intervalMonths, setIntervalMonths] = useState("12");
  const [items, setItems] = useState<InspectionItem[]>(DEFAULT_ITEMS);
  const [recordId, setRecordId] = useState("");
  const [status, setStatus] = useState<"draft" | "confirmed" | "printed">("draft");
  const [designated, setDesignated] = useState<DesignatedValues>({
    rearLeft: "", rearRight: "", totalBrake: "", parkingLeft: "", parkingRight: "", rearAxleWeight: "", vehicleWeight: "",
  });
  const [message, setMessage] = useState("作業車両の記録簿を作成します。");
  const [busy, setBusy] = useState(true);

  useEffect(() => { void load(); }, []);

  async function load() {
    setBusy(true);
    try {
      const active = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
      if (!active?.id) {
        setMessage("先に顧客・車両管理から作業車両を選択してください。");
        return;
      }

      const [vehicleRes, workRes, partsRes, recordRes] = await Promise.all([
        supabase.from("vehicles").select("id,customer_id,registration_number,registration_number_last4,vehicle_number,chassis_number,maker,model,model_code,fuel_type,vehicle_type,vehicle_weight,curb_weight_kg,rear_rear_axle_weight_kg,rear_front_axle_weight_kg").eq("id", active.id).single(),
        supabase.from("work_orders").select("id,reason,status,worker_name,scheduled_at").eq("vehicle_id", active.id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(20),
        supabase.from("parts").select("id,part_name,quantity,created_at").eq("vehicle_id", active.id).order("created_at", { ascending: false }).limit(100),
        supabase.from("inspection_records").select("id,record_type,inspection_date,interval_months,items,status,work_order_id,updated_at").eq("vehicle_id", active.id).order("updated_at", { ascending: false }).limit(20),
      ]);
      if (vehicleRes.error) throw vehicleRes.error;
      if (workRes.error) throw workRes.error;
      if (partsRes.error) throw partsRes.error;
      if (recordRes.error) throw recordRes.error;

      const v = vehicleRes.data as Vehicle;
      setVehicle(v);
      setWorkOrders((workRes.data || []) as WorkOrder[]);
      setParts((partsRes.data || []) as Part[]);
      if (workRes.data?.[0]?.id) setWorkOrderId(workRes.data[0].id);
      setDesignated((old) => ({
        ...old,
        rearAxleWeight: String(v.rear_rear_axle_weight_kg || v.rear_front_axle_weight_kg || ""),
        vehicleWeight: String(v.vehicle_weight || v.curb_weight_kg || ""),
      }));

      if (v.customer_id) {
        const { data: c } = await supabase.from("customers").select("name,company_name,schedule_display_name").eq("id", v.customer_id).maybeSingle();
        if (c) setCustomerName(c.schedule_display_name || c.company_name || c.name || "");
      }

      const latestInspection = (recordRes.data || []).find((x: any) => x.record_type === "点検整備記録簿");
      if (latestInspection) {
        setRecordId(latestInspection.id);
        setInspectionDate(latestInspection.inspection_date || todayJst());
        setIntervalMonths(String(latestInspection.interval_months || 12));
        if (Array.isArray(latestInspection.items) && latestInspection.items.length) setItems(latestInspection.items);
        setStatus(latestInspection.status || "draft");
        if (latestInspection.work_order_id) setWorkOrderId(latestInspection.work_order_id);
      }
      setMessage("車両情報・部品履歴・記録簿履歴を読み込みました。");
    } catch (error: any) {
      setMessage(`読み込みエラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  const partSuggestions = useMemo(() => {
    const names = parts.map((p) => p.part_name).filter(Boolean);
    const suggestions: string[] = [];
    const joined = names.join(" ").toLowerCase();
    if (/ブレーキ|パッド|シュー|ロータ/.test(joined)) suggestions.push("制動装置の交換部品あり → ブレーキ項目を確認");
    if (/オイル|oil/.test(joined)) suggestions.push("オイル関連部品あり → 油脂類の補給／交換を確認");
    if (/ベルト|belt/.test(joined)) suggestions.push("ベルト関連部品あり → ベルト類を確認");
    if (/タイヤ|tire/.test(joined)) suggestions.push("タイヤ関連部品あり → タイヤ項目を確認");
    if (/バッテ|battery/.test(joined)) suggestions.push("バッテリー関連部品あり → 電気装置を確認");
    return suggestions;
  }, [parts]);

  const designatedCalc = useMemo(() => {
    const rear = (numberOrNull(designated.rearLeft) || 0) + (numberOrNull(designated.rearRight) || 0);
    const parking = (numberOrNull(designated.parkingLeft) || 0) + (numberOrNull(designated.parkingRight) || 0);
    return {
      rearSum: rear,
      parkingSum: parking,
      rearRatio: ratio(rear, numberOrNull(designated.rearAxleWeight)),
      totalRatio: ratio(numberOrNull(designated.totalBrake), numberOrNull(designated.vehicleWeight)),
      parkingRatio: ratio(parking, numberOrNull(designated.vehicleWeight)),
    };
  }, [designated]);

  function updateItem(id: string, patch: Partial<InspectionItem>) {
    setItems((old) => old.map((x) => x.id === id ? { ...x, ...patch } : x));
  }

  async function saveInspection(nextStatus: "draft" | "confirmed" = "draft") {
    if (!vehicle) return;
    setBusy(true);
    try {
      const payload = {
        vehicle_id: vehicle.id,
        work_order_id: workOrderId || null,
        record_type: "点検整備記録簿",
        inspection_date: inspectionDate || null,
        interval_months: Number(intervalMonths) || null,
        items,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = recordId
        ? await supabase.from("inspection_records").update(payload).eq("id", recordId).select("id,status").single()
        : await supabase.from("inspection_records").insert(payload).select("id,status").single();
      if (error) throw error;
      setRecordId(data.id);
      setStatus(data.status);

      const existingJob = await supabase.from("inspection_jobs").select("id").eq("vehicle_id", vehicle.id).eq("work_order_id", workOrderId || null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const jobPayload = {
        vehicle_id: vehicle.id,
        work_order_id: workOrderId || null,
        record_type: "INSPECTION_RECORD",
        inspection_interval_months: Number(intervalMonths) || null,
        powertrain: vehicle.fuel_type || vehicle.vehicle_type || null,
        auto_decision_status: nextStatus === "confirmed" ? "CONFIRMED" : (partSuggestions.length ? "NEEDS_REVIEW" : "PENDING"),
        inspection_date: inspectionDate || null,
        registration_number_snapshot: vehicle.registration_number || null,
        chassis_number_snapshot: vehicle.chassis_number || null,
        updated_at: new Date().toISOString(),
      };
      const jobError = existingJob.data?.id
        ? (await supabase.from("inspection_jobs").update(jobPayload).eq("id", existingJob.data.id)).error
        : (await supabase.from("inspection_jobs").insert(jobPayload)).error;
      if (jobError) throw jobError;
      setMessage(nextStatus === "confirmed" ? "点検整備記録簿を確認済みにしました。" : "点検整備記録簿の下書きを保存しました。");
    } catch (error: any) {
      setMessage(`保存エラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDesignated(nextStatus: "draft" | "confirmed" = "draft") {
    if (!vehicle) return;
    setBusy(true);
    try {
      const payloadItems = [{
        id: "brake-force",
        label: "制動力計算",
        values: designated,
        calculated: designatedCalc,
      }];
      const { data: existing } = await supabase.from("inspection_records").select("id").eq("vehicle_id", vehicle.id).eq("record_type", "指定整備記録簿").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const payload = {
        vehicle_id: vehicle.id,
        work_order_id: workOrderId || null,
        record_type: "指定整備記録簿",
        inspection_date: inspectionDate || null,
        interval_months: null,
        items: payloadItems,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      const { error } = existing?.id
        ? await supabase.from("inspection_records").update(payload).eq("id", existing.id)
        : await supabase.from("inspection_records").insert(payload);
      if (error) throw error;
      setMessage(nextStatus === "confirmed" ? "指定整備記録簿を確認済みにしました。" : "指定整備記録簿の下書きを保存しました。");
    } catch (error: any) {
      setMessage(`保存エラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  async function printCurrent() {
    if (mode === "inspection") await saveInspection(status === "confirmed" ? "confirmed" : "draft");
    else await saveDesignated("draft");
    window.print();
  }

  return (
    <main className="page">
      <header className="top noPrint"><button onClick={() => location.assign("/customer-vehicles")}>← 車両管理へ</button><strong>icb</strong></header>

      <section className="card hero">
        <div><div className="eyebrow">記録簿ワークスペース</div><h1>{vehicleLabel(vehicle)}</h1><p>{customerName || "顧客未割り当て"}　{[vehicle?.maker, vehicle?.model || vehicle?.model_code].filter(Boolean).join(" / ")}</p></div>
        <div className="vehicleMeta"><span>車台番号 {vehicle?.chassis_number || "-"}</span><span>燃料 {vehicle?.fuel_type || vehicle?.vehicle_type || "-"}</span></div>
        <div className="notice">{busy ? "処理中…" : message}</div>
      </section>

      <nav className="modeTabs noPrint">
        <button className={mode === "inspection" ? "active" : ""} onClick={() => setMode("inspection")}>点検整備記録簿</button>
        <button className={mode === "designated" ? "active" : ""} onClick={() => setMode("designated")}>指定整備記録簿</button>
      </nav>

      <section className="card noPrint">
        <div className="grid">
          <label>対象作業<select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}><option value="">作業指定なし</option>{workOrders.map((w) => <option key={w.id} value={w.id}>{w.reason} {w.worker_name ? ` / ${w.worker_name}` : ""}</option>)}</select></label>
          <label>点検日<input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} /></label>
        </div>
      </section>

      {mode === "inspection" ? (
        <>
          <section className="card">
            <div className="sectionHead"><h2>点検整備記録簿</h2><span className="badge">{status === "confirmed" ? "確認済み" : "下書き"}</span></div>
            <div className="grid noPrint"><label>点検周期<select value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)}><option value="3">3ヶ月</option><option value="6">6ヶ月</option><option value="12">12ヶ月</option><option value="24">24ヶ月</option></select></label></div>
            {!!partSuggestions.length && <div className="suggest noPrint"><b>部品履歴からの確認候補</b>{partSuggestions.map((x, i) => <div key={i}>・{x}</div>)}<small>候補だけ表示し、記号は担当者が確定します。</small></div>}
            <div className="itemList">
              {items.map((item) => <div className="inspectionItem" key={item.id}><div className="itemLabel">{item.label}</div><select value={item.mark} onChange={(e) => updateItem(item.id, { mark: e.target.value as InspectionItem["mark"] })}><option value="">空欄</option><option>／</option><option>✓</option><option>×</option><option>L</option><option>○</option></select><input placeholder="備考" value={item.note} onChange={(e) => updateItem(item.id, { note: e.target.value })} /></div>)}
            </div>
          </section>
          <section className="card actions noPrint"><button onClick={() => void saveInspection("draft")}>下書き保存</button><button className="primary" onClick={() => void saveInspection("confirmed")}>担当者確認済みにする</button><button onClick={() => void printCurrent()}>🖨 印刷</button></section>
        </>
      ) : (
        <>
          <section className="card">
            <h2>指定整備記録簿・制動力計算</h2>
            <p className="help noPrint">左右の検査値を入力すると、後軸・総和・駐車ブレーキの比率を自動計算します。</p>
            <div className="calcGrid">
              <label>後ブレーキ 左<input inputMode="decimal" value={designated.rearLeft} onChange={(e) => setDesignated({ ...designated, rearLeft: e.target.value })} /></label>
              <label>後ブレーキ 右<input inputMode="decimal" value={designated.rearRight} onChange={(e) => setDesignated({ ...designated, rearRight: e.target.value })} /></label>
              <label>後軸重<input inputMode="decimal" value={designated.rearAxleWeight} onChange={(e) => setDesignated({ ...designated, rearAxleWeight: e.target.value })} /></label>
              <div className="result"><small>後軸制動力</small><b>{designatedCalc.rearSum} ÷ {designated.rearAxleWeight || "-"} = {designatedCalc.rearRatio}</b></div>
              <label>ブレーキ総和<input inputMode="decimal" value={designated.totalBrake} onChange={(e) => setDesignated({ ...designated, totalBrake: e.target.value })} /></label>
              <label>車両重量<input inputMode="decimal" value={designated.vehicleWeight} onChange={(e) => setDesignated({ ...designated, vehicleWeight: e.target.value })} /></label>
              <div className="result"><small>総和</small><b>{designated.totalBrake || "-"} ÷ {designated.vehicleWeight || "-"} = {designatedCalc.totalRatio}</b></div>
              <label>サイドブレーキ 左<input inputMode="decimal" value={designated.parkingLeft} onChange={(e) => setDesignated({ ...designated, parkingLeft: e.target.value })} /></label>
              <label>サイドブレーキ 右<input inputMode="decimal" value={designated.parkingRight} onChange={(e) => setDesignated({ ...designated, parkingRight: e.target.value })} /></label>
              <div className="result"><small>サイドブレーキ</small><b>{designatedCalc.parkingSum} ÷ {designated.vehicleWeight || "-"} = {designatedCalc.parkingRatio}</b></div>
            </div>
          </section>
          <section className="card actions noPrint"><button onClick={() => void saveDesignated("draft")}>下書き保存</button><button className="primary" onClick={() => void saveDesignated("confirmed")}>担当者確認済みにする</button><button onClick={() => void printCurrent()}>🖨 印刷</button></section>
        </>
      )}

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:980px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button,input,select{font:inherit}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:10px 13px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}.hero h1{font-size:31px;margin:5px 0}.hero p{color:#647184}.eyebrow{font-weight:800;color:#2674e8}.vehicleMeta{display:flex;gap:8px;flex-wrap:wrap}.vehicleMeta span,.badge{background:#eef4ff;border-radius:999px;padding:5px 9px;font-size:13px}.notice{margin-top:12px;background:#edf7ef;border:1px solid #c5e5ce;border-radius:12px;padding:11px 13px}.modeTabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.modeTabs .active,.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid label,.calcGrid label{display:grid;gap:6px;color:#5f6b7a;font-weight:700}input,select{width:100%;border:1px solid #cbd6e3;border-radius:10px;padding:11px;background:#fff}.sectionHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.suggest{background:#fff8df;border:1px solid #ead88f;border-radius:12px;padding:12px 14px;margin:14px 0;line-height:1.7}.suggest small{display:block;color:#71662f;margin-top:4px}.itemList{display:grid;gap:8px}.inspectionItem{display:grid;grid-template-columns:minmax(220px,1.4fr) 110px 1fr;gap:8px;align-items:center;border-bottom:1px solid #edf0f4;padding:8px 0}.itemLabel{font-weight:800}.actions{display:flex;gap:8px;flex-wrap:wrap}.calcGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.result{grid-column:1/-1;background:#f4f7fb;border-radius:12px;padding:13px;display:grid}.result b{font-size:19px}.result small,.help{color:#6a7788}.help{line-height:1.7}@media(max-width:680px){.grid,.calcGrid{grid-template-columns:1fr}.inspectionItem{grid-template-columns:1fr 90px}.inspectionItem input{grid-column:1/-1}.modeTabs{grid-template-columns:1fr}}
        @media print{body{background:#fff}.page{max-width:none;padding:0}.noPrint{display:none!important}.card{border:0;border-radius:0;padding:7mm;margin:0}.inspectionItem{grid-template-columns:1fr 20mm 1fr}.inspectionItem select,.inspectionItem input,.calcGrid input{border:0;padding:2px}.result{border:1px solid #aaa;background:#fff}}
      `}</style>
    </main>
  );
}
