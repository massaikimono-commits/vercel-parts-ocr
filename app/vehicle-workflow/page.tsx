/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

type Vehicle = {
  id?: string;
  number: string;
  registration: string;
  last4: string;
  chassis: string;
  model: string;
  type: "EV" | "ガソリン" | "HV" | "その他";
  weight: string;
  firstRegistration: string;
  customerId: string;
};

const EMPTY: Vehicle = {
  number: "",
  registration: "",
  last4: "",
  chassis: "",
  model: "",
  type: "その他",
  weight: "",
  firstRegistration: "",
  customerId: "",
};

const ACTIVE_KEY = "parts-active-vehicle";
const BEFORE_KEY = "parts-before-ocr-ids";

function display(v: Vehicle) {
  return v.registration || v.number || v.chassis || "車両";
}

export default function VehicleWorkflowPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle>(EMPTY);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("先に作業する車両を選ぶと、その後のOCRデータを車両ごとに整理できます。");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setMessage("ログイン後に車両一覧を読み込みます。");
          setBusy(false);
          return;
        }
        const { data, error } = await supabase.from("vehicles").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        const list = (data || []).map((v: any) => ({
          id: v.id,
          number: v.vehicle_number || "",
          registration: v.registration_number || "",
          last4: v.registration_number_last4 || "",
          chassis: v.chassis_number || "",
          model: v.model || "",
          type: (v.fuel_type || "その他") as Vehicle["type"],
          weight: v.vehicle_weight == null ? "" : String(v.vehicle_weight),
          firstRegistration: v.first_registration || "",
          customerId: v.customer_id || "",
        }));
        setVehicles(list);
        const saved = localStorage.getItem(ACTIVE_KEY);
        if (saved) {
          const active = JSON.parse(saved);
          const found = list.find((x: Vehicle) => x.id === active.id || x.number === active.number);
          if (found) setVehicle(found);
        }
      } catch (e: any) {
        setMessage(`車両一覧の読み込みエラー: ${e?.message || e}`);
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles.slice(0, 60);
    const digits = q.replace(/\D/g, "");
    return vehicles.filter((v) => {
      const text = [v.number, v.registration, v.last4, v.chassis, v.model].join(" ").toLowerCase();
      return text.includes(q) || (digits.length >= 2 && v.last4.includes(digits.slice(-4)));
    }).slice(0, 80);
  }, [vehicles, search]);

  function selectVehicle(v: Vehicle) {
    setVehicle(v);
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(v));
    setMessage(`${display(v)} を作業車両に選択しました。`);
  }

  async function saveVehicle() {
    if (!vehicle.number.trim() && !vehicle.chassis.trim()) {
      setMessage("車体番号または車台番号を入力してください。");
      return;
    }
    const payload = {
      vehicle_number: vehicle.number.trim() || vehicle.chassis.trim(),
      registration_number: vehicle.registration.trim() || null,
      registration_number_last4: (vehicle.registration.replace(/\D/g, "").slice(-4) || vehicle.last4).slice(-4) || null,
      chassis_number: vehicle.chassis.trim() || null,
      model: vehicle.model.trim() || null,
      fuel_type: vehicle.type,
      vehicle_weight: vehicle.weight ? Number(vehicle.weight) : null,
      first_registration: vehicle.firstRegistration || null,
      customer_id: vehicle.customerId || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = vehicle.id
      ? await supabase.from("vehicles").update(payload).eq("id", vehicle.id).select().single()
      : await supabase.from("vehicles").insert(payload).select().single();
    if (error) {
      setMessage(`車両保存エラー: ${error.message}`);
      return;
    }
    const saved: Vehicle = { ...vehicle, id: data.id, number: payload.vehicle_number, last4: payload.registration_number_last4 || "" };
    setVehicle(saved);
    setVehicles((old) => [saved, ...old.filter((x) => x.id !== saved.id && x.number !== saved.number)]);
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(saved));
    setMessage("車両情報を保存し、作業車両に設定しました。");
  }

  function startOCR() {
    if (!vehicle.number && !vehicle.chassis) {
      setMessage("先に作業する車両を選んでください。");
      return;
    }
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(vehicle));
    try {
      const parts = JSON.parse(localStorage.getItem("parts-data") || "[]");
      localStorage.setItem(BEFORE_KEY, JSON.stringify(Array.isArray(parts) ? parts.map((p: any) => p.id).filter(Boolean) : []));
    } catch {
      localStorage.setItem(BEFORE_KEY, "[]");
    }
    location.assign("/ocr/auto");
  }

  return (
    <main className="page">
      <div className="top"><button onClick={() => location.assign("/")}>← メインへ</button><strong>icb</strong></div>
      <section className="card">
        <h1>作業車両を選択</h1>
        <p>車体番号・ナンバー下4桁・車台番号・型式で検索できます。選択した車両は、この後の部品OCRと紐付けるための「作業車両」になります。</p>
        <div className="notice">{busy ? "車両一覧を読み込み中…" : message}</div>
        <input className="search" placeholder="車体番号 / 下4桁 / 車台番号 / 型式で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="list">
          {filtered.map((v) => (
            <button key={v.id || v.number} className={`vehicleRow ${vehicle.id === v.id && v.id ? "active" : ""}`} onClick={() => selectVehicle(v)}>
              <b>{v.registration || v.number}</b>
              <span>{v.model || "型式未入力"}　下4桁 {v.last4 || "----"}</span>
              <small>{v.chassis || v.number}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>選択中 / 新規登録</h2>
        <div className="grid">
          <label>車体番号<input value={vehicle.number} onChange={(e) => setVehicle({ ...vehicle, number: e.target.value })} /></label>
          <label>登録番号<input value={vehicle.registration} onChange={(e) => setVehicle({ ...vehicle, registration: e.target.value, last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label>
          <label>ナンバー下4桁<input inputMode="numeric" maxLength={4} value={vehicle.last4} onChange={(e) => setVehicle({ ...vehicle, last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label>
          <label>車台番号<input value={vehicle.chassis} onChange={(e) => setVehicle({ ...vehicle, chassis: e.target.value })} /></label>
          <label>型式<input value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} /></label>
          <label>燃料<select value={vehicle.type} onChange={(e) => setVehicle({ ...vehicle, type: e.target.value as Vehicle["type"] })}><option>EV</option><option>ガソリン</option><option>HV</option><option>その他</option></select></label>
          <label>車両重量 kg<input inputMode="numeric" value={vehicle.weight} onChange={(e) => setVehicle({ ...vehicle, weight: e.target.value })} /></label>
          <label>初度登録<input type="month" value={vehicle.firstRegistration.slice(0, 7)} onChange={(e) => setVehicle({ ...vehicle, firstRegistration: e.target.value })} /></label>
        </div>
        <div className="actions"><button onClick={() => { setVehicle(EMPTY); setMessage("新しい車両を入力してください。"); }}>＋新規車両</button><button onClick={saveVehicle}>車両を保存</button></div>
        <button className="primary" onClick={startOCR}>この車両で伝票OCRへ →</button>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box} body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.top button,button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:16px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0;line-height:1.6}.search,input,select{width:100%;border:1px solid #cdd7e5;border-radius:11px;padding:12px;font-size:16px;background:#fff}.list{display:grid;gap:8px;margin-top:12px;max-height:380px;overflow:auto}.vehicleRow{text-align:left;display:grid;gap:3px;color:#172033}.vehicleRow span,.vehicleRow small{color:#5d6878;font-weight:500}.vehicleRow.active{border:2px solid #2f6fe4;background:#eef4ff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid label{display:grid;gap:6px;color:#5d6878;font-weight:700}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.primary{width:100%;margin-top:12px;background:#2f6fe4;color:#fff;border-color:#2f6fe4;font-size:18px;padding:16px}@media(max-width:650px){.grid{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}
