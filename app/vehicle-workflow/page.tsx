/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";

type Vehicle = {
  id?: string;
  number: string;
  registration: string;
  last4: string;
  chassis: string;
  model: string;
  type: "EV" | "ガソリン" | "HV" | "ディーゼル" | "その他";
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

function normalizeOCR(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function linesOf(text: string) {
  return normalizeOCR(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
}

function valueNearLabel(lines: string[], labels: RegExp[], maxLookAhead = 2) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const label of labels) {
      if (!label.test(line)) continue;
      const stripped = line.replace(label, "").replace(/^[\s:：・|]+/, "").trim();
      if (stripped.length >= 2) return stripped;
      for (let j = 1; j <= maxLookAhead; j += 1) {
        const next = lines[i + j]?.trim();
        if (next && next.length >= 2) return next;
      }
    }
  }
  return "";
}

function cleanRegistration(raw: string) {
  return raw
    .replace(/自動車登録番号|車両番号|登録番号|番号標/g, "")
    .replace(/[|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 40);
}

function cleanModel(raw: string) {
  return raw
    .replace(/型式指定番号.*$/g, "")
    .replace(/類別区分番号.*$/g, "")
    .replace(/型式/g, "")
    .replace(/^[\s:：・|]+/, "")
    .trim()
    .split(/\s{2,}| 車台番号| 原動機/)[0]
    .slice(0, 40);
}

function cleanChassis(raw: string) {
  const upper = raw.toUpperCase().replace(/[—―‐‑–]/g, "-");
  const candidates = upper.match(/[A-Z0-9]{2,8}-[A-Z0-9]{3,12}|[A-Z]{1,5}[0-9A-Z]{5,16}/g) || [];
  return candidates.sort((a, b) => b.length - a.length)[0] || upper.replace(/車台番号/g, "").trim().slice(0, 32);
}

function parseJapaneseMonth(text: string) {
  const normalized = normalizeOCR(text);
  const western = normalized.match(/(20\d{2}|19\d{2})\s*[年/.\-]\s*(\d{1,2})/);
  if (western) return `${western[1]}-${String(Number(western[2])).padStart(2, "0")}`;
  const era = normalized.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!era) return "";
  const n = era[2] === "元" ? 1 : Number(era[2]);
  const base = era[1] === "令和" ? 2018 : era[1] === "平成" ? 1988 : 1925;
  return `${base + n}-${String(Number(era[3])).padStart(2, "0")}`;
}

function detectFuel(text: string): Vehicle["type"] {
  const t = normalizeOCR(text);
  if (/電気自動車|電気\s*$|EV\b/i.test(t)) return "EV";
  if (/ハイブリッド|HV\b|ガソリン.*電気|電気.*ガソリン/i.test(t)) return "HV";
  if (/軽油|ディーゼル/i.test(t)) return "ディーゼル";
  if (/ガソリン|揮発油/i.test(t)) return "ガソリン";
  return "その他";
}

function extractVehicle(text: string, current: Vehicle): Vehicle {
  const normalized = normalizeOCR(text);
  const lines = linesOf(normalized);

  const registrationRaw = valueNearLabel(lines, [/(?:自動車)?登録番号(?:又は車両番号)?/i, /車両番号/i, /登録番号/i]);
  const chassisRaw = valueNearLabel(lines, [/車台番号/i, /車体番号/i]);
  const modelRaw = valueNearLabel(lines, [/^型式(?!指定番号)/i, /型\s*式(?!指定)/i]);
  const firstRaw = valueNearLabel(lines, [/初度登録年月/i, /初度検査年月/i]);

  const registration = cleanRegistration(registrationRaw || current.registration);
  const chassis = cleanChassis(chassisRaw || current.chassis);
  const model = cleanModel(modelRaw || current.model);

  const weightMatch = normalized.match(/車両重量[^\d]{0,30}([0-9Il|,]{3,7})\s*(?:kg|KG|キログラム)?/i)
    || normalized.match(/([0-9]{3,5})\s*kg/i);
  const weight = weightMatch ? weightMatch[1].replace(/[Il|]/g, "1").replace(/,/g, "") : current.weight;
  const firstRegistration = parseJapaneseMonth(firstRaw || normalized) || current.firstRegistration;
  const type = detectFuel(normalized) === "その他" ? current.type : detectFuel(normalized);
  const last4 = registration.replace(/\D/g, "").slice(-4) || current.last4;
  const number = registration || chassis || current.number;

  return {
    ...current,
    number,
    registration,
    last4,
    chassis,
    model,
    type,
    weight,
    firstRegistration,
  };
}

async function imageForOCR(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("画像を開けませんでした。"));
      image.src = url;
    });
    const maxSide = 2800;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("画像を処理できませんでした。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < imageData.data.length; p += 4) {
      const r = imageData.data[p];
      const g = imageData.data[p + 1];
      const b = imageData.data[p + 2];
      let v = Math.round(r * 0.22 + g * 0.70 + b * 0.08);
      v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.22 + 145)));
      imageData.data[p] = v;
      imageData.data[p + 1] = v;
      imageData.data[p + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function VehicleWorkflowPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle>(EMPTY);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("先に作業する車両を選ぶと、その後のOCRデータを車両ごとに整理できます。");
  const [busy, setBusy] = useState(true);
  const [docBusy, setDocBusy] = useState(false);
  const [docProgress, setDocProgress] = useState(0);
  const [docText, setDocText] = useState("");
  const [docPreview, setDocPreview] = useState("");

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
    return () => {
      if (docPreview) URL.revokeObjectURL(docPreview);
    };
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

  async function readVehicleCertificate(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("まず写真・画像の車検証OCRに対応しました。PDF読み取りは次の段階で追加します。");
      return;
    }
    setDocBusy(true);
    setDocProgress(1);
    setDocText("");
    setMessage("車検証を読み取り中です…");
    if (docPreview) URL.revokeObjectURL(docPreview);
    setDocPreview(URL.createObjectURL(file));
    let worker: any = null;
    try {
      const canvas = await imageForOCR(file);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") setDocProgress(Math.max(5, Math.round((m.progress || 0) * 100)));
        },
      });
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
        user_defined_dpi: "300",
      });
      const result = await worker.recognize(canvas);
      const text = normalizeOCR(result.data.text || "");
      setDocText(text);
      const extracted = extractVehicle(text, vehicle);
      setVehicle(extracted);
      setDocProgress(100);
      setMessage("車検証から候補を入力しました。内容を確認・修正してから「車両を保存」を押してください。");
    } catch (e: any) {
      console.error(e);
      setMessage(`車検証OCRエラー: ${e?.message || "読み取りに失敗しました。"}`);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setDocBusy(false);
    }
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

      <section className="card certificate">
        <h2>車検証から車両情報を読み取る</h2>
        <p>車検証を撮影するか、写真ライブラリから選ぶと、登録番号・車台番号・型式・燃料・車両重量・初度登録年月を候補入力します。</p>
        <input ref={cameraRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readVehicleCertificate(f); e.currentTarget.value = ""; }} />
        <input ref={libraryRef} className="hidden" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readVehicleCertificate(f); e.currentTarget.value = ""; }} />
        <div className="docActions">
          <button className="primaryDoc" disabled={docBusy} onClick={() => cameraRef.current?.click()}>📷 今撮影して読み取る</button>
          <button disabled={docBusy} onClick={() => libraryRef.current?.click()}>🖼 写真ライブラリから読み取る</button>
        </div>
        {docBusy && <div className="progress"><div style={{ width: `${docProgress}%` }} /></div>}
        {docPreview && <img className="preview" src={docPreview} alt="車検証プレビュー" />}
        {docText && <details><summary>OCR詳細（確認用）</summary><pre>{docText}</pre></details>}
      </section>

      <section className="card">
        <h2>選択中 / 新規登録</h2>
        <div className="grid">
          <label>車体番号<input value={vehicle.number} onChange={(e) => setVehicle({ ...vehicle, number: e.target.value })} /></label>
          <label>登録番号<input value={vehicle.registration} onChange={(e) => setVehicle({ ...vehicle, registration: e.target.value, last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label>
          <label>ナンバー下4桁<input inputMode="numeric" maxLength={4} value={vehicle.last4} onChange={(e) => setVehicle({ ...vehicle, last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label>
          <label>車台番号<input value={vehicle.chassis} onChange={(e) => setVehicle({ ...vehicle, chassis: e.target.value })} /></label>
          <label>型式<input value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} /></label>
          <label>燃料<select value={vehicle.type} onChange={(e) => setVehicle({ ...vehicle, type: e.target.value as Vehicle["type"] })}><option>EV</option><option>ガソリン</option><option>HV</option><option>ディーゼル</option><option>その他</option></select></label>
          <label>車両重量 kg<input inputMode="numeric" value={vehicle.weight} onChange={(e) => setVehicle({ ...vehicle, weight: e.target.value })} /></label>
          <label>初度登録<input type="month" value={vehicle.firstRegistration.slice(0, 7)} onChange={(e) => setVehicle({ ...vehicle, firstRegistration: e.target.value })} /></label>
        </div>
        <div className="actions"><button onClick={() => { setVehicle(EMPTY); setMessage("新しい車両を入力してください。"); }}>＋新規車両</button><button onClick={saveVehicle}>車両を保存</button></div>
        <button className="primary" onClick={startOCR}>この車両で伝票OCRへ →</button>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box} body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.top button,button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:16px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0;line-height:1.6}.search,input,select{width:100%;border:1px solid #cdd7e5;border-radius:11px;padding:12px;font-size:16px;background:#fff}.list{display:grid;gap:8px;margin-top:12px;max-height:380px;overflow:auto}.vehicleRow{text-align:left;display:grid;gap:3px;color:#172033}.vehicleRow span,.vehicleRow small{color:#5d6878;font-weight:500}.vehicleRow.active{border:2px solid #2f6fe4;background:#eef4ff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid label{display:grid;gap:6px;color:#5d6878;font-weight:700}.actions,.docActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.docActions button{flex:1 1 260px}.primary,.primaryDoc{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.primary{width:100%;margin-top:12px;font-size:18px;padding:16px}.hidden{display:none}.preview{display:block;width:100%;max-height:440px;object-fit:contain;border-radius:14px;margin-top:14px;background:#f4f6fa}.progress{height:8px;background:#e4eaf3;border-radius:999px;overflow:hidden;margin-top:14px}.progress>div{height:100%;background:#2f6fe4;transition:width .2s}details{margin-top:14px;border:1px solid #d9e0ea;border-radius:12px;padding:12px}summary{font-weight:800;cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px}@media(max-width:650px){.grid{grid-template-columns:1fr}.docActions button{flex:1 1 100%}}
      `}</style>
    </main>
  );
}
