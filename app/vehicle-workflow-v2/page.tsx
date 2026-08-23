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

type Box = { x: number; y: number; w: number; h: number };
type ReadResult = { raw: string; value: string };

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

function normalizeOCR(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function display(v: Vehicle) {
  return v.registration || v.number || v.chassis || "車両";
}

function westernToJapaneseMonth(year: number, month: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "";
  if (year >= 2019) return `令和${year === 2019 ? "元" : year - 2018}年${month}月`;
  if (year >= 1989) return `平成${year === 1989 ? "元" : year - 1988}年${month}月`;
  if (year >= 1926) return `昭和${year === 1926 ? "元" : year - 1925}年${month}月`;
  return `${year}年${month}月`;
}

function parseJapaneseMonth(text: string) {
  const t = normalizeOCR(text).replace(/\s+/g, " ");
  const era = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (era) {
    const y = era[2] === "元" ? "元" : String(Number(era[2]));
    const m = Number(era[3]);
    if (m >= 1 && m <= 12) return `${era[1]}${y}年${m}月`;
  }
  const western = t.match(/(20\d{2}|19\d{2})\s*[年/.\-]\s*(\d{1,2})/);
  if (western) return westernToJapaneseMonth(Number(western[1]), Number(western[2]));
  return "";
}

function formatJapaneseMonth(value: string) {
  return value ? parseJapaneseMonth(value) || value : "";
}

function detectFuel(text: string): Vehicle["type"] {
  const t = normalizeOCR(text);
  if (/軽油|ディーゼル/i.test(t)) return "ディーゼル";
  if (/ハイブリッド|\bHV\b|ガソリン.*電気|電気.*ガソリン/i.test(t)) return "HV";
  if (/電気自動車|\bEV\b/i.test(t)) return "EV";
  if (/ガソリン|揮発油/i.test(t)) return "ガソリン";
  return "その他";
}

function digitsJoined(s: string) {
  return s.replace(/[^0-9]/g, "");
}

function cleanRegistration(text: string) {
  const t = normalizeOCR(text).replace(/[|]/g, " ");
  const m = t.match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  if (!m) return "";
  const cls = digitsJoined(m[2]);
  const serial = digitsJoined(m[4]);
  if (cls.length !== 3 || serial.length !== 4) return "";
  return `${m[1]} ${cls} ${m[3]} ${serial}`;
}

function cleanChassis(text: string) {
  const compact = normalizeOCR(text).toUpperCase().replace(/\s+/g, "").replace(/[ー―–—]/g, "-");
  const candidates = compact.match(/[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}/g) || [];
  if (!candidates.length) return "";
  return candidates
    .map((x) => {
      const [a, b] = x.split("-");
      return `${a}-${b.replace(/O/g, "0")}`;
    })
    .sort((a, b) => b.length - a.length)[0];
}

function cleanModel(text: string) {
  let compact = normalizeOCR(text).toUpperCase().replace(/\s+/g, "").replace(/[ー―–—]/g, "-");
  compact = compact.replace(/^C(?=[0-9][A-Z]{2}-)/, "");
  const candidates = compact.match(/[0-9A-Z]{2,5}-[A-Z]{1,5}[0-9A-Z]{2,10}/g) || [];
  return candidates
    .filter((x) => !/^[A-Z]{1,4}[0-9]{2,6}-[0-9]{4,10}$/.test(x))
    .sort((a, b) => b.length - a.length)[0] || "";
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function repairModelWithChassis(model: string, chassis: string) {
  if (!model || !chassis || !model.includes("-") || !chassis.includes("-")) return model;
  const family = chassis.split("-")[0];
  const [prefix, rawRight] = model.split("-");
  if (rawRight.startsWith(family)) return model;

  for (let i = 0; i < Math.min(rawRight.length, family.length + 2); i++) {
    const removed = rawRight.slice(0, i) + rawRight.slice(i + 1);
    if (removed.startsWith(family)) return `${prefix}-${removed}`;
  }

  const head = rawRight.slice(0, family.length);
  if (head.length === family.length && levenshtein(head, family) <= 1) {
    return `${prefix}-${family}${rawRight.slice(family.length)}`;
  }
  return model;
}

function cleanWeight(text: string) {
  const t = normalizeOCR(text).replace(/[Il|]/g, "1").replace(/,/g, "");
  const kg = t.match(/([0-9]{3,5})\s*(?:kg|KG)/);
  if (kg) {
    const n = Number(kg[1]);
    if (n >= 500 && n <= 30000) return String(n);
  }
  const nums = t.match(/\b[0-9]{3,5}\b/g) || [];
  for (const raw of nums) {
    const n = Number(raw);
    if (n >= 500 && n <= 30000) return String(n);
  }
  return "";
}

function contextAfter(text: string, labels: string[], length = 120) {
  const t = normalizeOCR(text);
  for (const label of labels) {
    const i = t.indexOf(label);
    if (i >= 0) return t.slice(i, i + length);
  }
  return "";
}

function firstRegistrationFromGlobal(text: string) {
  const c = contextAfter(text, ["初度登録年月", "初度登録"], 100);
  return parseJapaneseMonth(c);
}

function weightFromGlobal(text: string) {
  const c = contextAfter(text, ["車両重量"], 90);
  return cleanWeight(c);
}

async function loadCanvas(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像を開けませんでした。"));
      el.src = url;
    });
    const scale = Math.min(1, 3600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("画像を処理できませんでした。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectPaper(canvas: HTMLCanvasElement): Box {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(3, Math.floor(Math.max(w, h) / 700));
  const isPaper = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const bright = (r + g + b) / 3;
    return bright > 128 && Math.max(r, g, b) - Math.min(r, g, b) < 75;
  };

  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (isPaper(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > 0.28) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);

  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (isPaper(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > 0.28) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  if (box.w < w * .45 || box.h < h * .45) return { x: 0, y: 0, w, h };
  return box;
}

function rel(p: Box, x: number, y: number, w: number, h: number): Box {
  return {
    x: Math.round(p.x + p.w * x),
    y: Math.round(p.y + p.h * y),
    w: Math.round(p.w * w),
    h: Math.round(p.h * h),
  };
}

function cropForOCR(source: HTMLCanvasElement, box: Box, targetWidth = 2200, binary = false) {
  const scale = Math.max(1, Math.min(6, targetWidth / Math.max(1, box.w)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(box.w * scale));
  c.height = Math.max(1, Math.round(box.h * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("切り出しに失敗しました。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);

  const img = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  const gray = new Uint8Array(c.width * c.height);
  for (let p = 0, i = 0; p < img.data.length; p += 4, i++) {
    const v = Math.round(img.data[p] * .22 + img.data[p + 1] * .70 + img.data[p + 2] * .08);
    gray[i] = v;
    sum += v;
  }
  const mean = sum / Math.max(1, gray.length);
  const threshold = Math.max(105, Math.min(205, mean - 22));
  for (let p = 0, i = 0; p < img.data.length; p += 4, i++) {
    const g = gray[i];
    const v = binary ? (g < threshold ? 0 : 255) : Math.max(0, Math.min(255, Math.round((g - 130) * 1.55 + 155)));
    img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function recognize(worker: any, canvas: HTMLCanvasElement, psm: any, whitelist = "") {
  const params: Record<string, string> = {
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: String(psm),
    user_defined_dpi: "300",
  };
  params.tessedit_char_whitelist = whitelist;
  await worker.setParameters(params);
  return normalizeOCR((await worker.recognize(canvas)).data.text || "");
}

async function readWithFallback(
  worker: any,
  source: HTMLCanvasElement,
  paper: Box,
  psm: any,
  mainBox: [number, number, number, number],
  fallbackBox: [number, number, number, number],
  parser: (s: string) => string,
  whitelist = ""
): Promise<ReadResult> {
  const a = await recognize(worker, cropForOCR(source, rel(paper, ...mainBox), 2300, false), psm, whitelist);
  const av = parser(a);
  if (av) return { raw: a, value: av };
  const b = await recognize(worker, cropForOCR(source, rel(paper, ...fallbackBox), 2500, true), psm, whitelist);
  return { raw: [a, b].filter(Boolean).join(" / "), value: parser(`${a}\n${b}`) };
}

export default function VehicleWorkflowV2Page() {
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
        if (!session) { setMessage("ログイン後に車両一覧を読み込みます。"); return; }
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
          firstRegistration: formatJapaneseMonth(v.first_registration || ""),
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
    return vehicles.filter((v) =>
      [v.number, v.registration, v.last4, v.chassis, v.model].join(" ").toLowerCase().includes(q) ||
      (digits.length >= 2 && v.last4.includes(digits.slice(-4)))
    ).slice(0, 80);
  }, [vehicles, search]);

  function selectVehicle(v: Vehicle) {
    setVehicle(v);
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(v));
    setMessage(`${display(v)} を作業車両に選択しました。`);
  }

  async function readVehicleCertificate(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("写真・画像の車検証を選んでください。PDF対応は後で追加できます。");
      return;
    }
    setDocBusy(true);
    setDocProgress(1);
    setDocText("");
    setMessage("車検証を項目ごとに高精度で読み取り中です…");
    if (docPreview) URL.revokeObjectURL(docPreview);
    setDocPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      const source = await loadCanvas(file);
      const paper = detectPaper(source);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      const P = tesseract.PSM;
      const single = P?.SINGLE_LINE ?? "7";

      const reg = await readWithFallback(
        worker, source, paper, single,
        [.15, .125, .72, .045], [.09, .11, .82, .07],
        cleanRegistration
      );
      setDocProgress(18);

      const chassis = await readWithFallback(
        worker, source, paper, single,
        [.15, .158, .72, .045], [.08, .145, .84, .07],
        cleanChassis,
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
      );
      setDocProgress(34);

      const first = await readWithFallback(
        worker, source, paper, single,
        [.42, .188, .28, .045], [.34, .178, .42, .07],
        parseJapaneseMonth
      );
      setDocProgress(49);

      const modelRead = await readWithFallback(
        worker, source, paper, single,
        [.12, .338, .39, .050], [.07, .325, .50, .075],
        cleanModel,
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
      );
      setDocProgress(64);

      const weight = await readWithFallback(
        worker, source, paper, single,
        [.13, .412, .24, .048], [.08, .40, .34, .075],
        cleanWeight,
        "0123456789kgKG"
      );
      setDocProgress(77);

      const fuelRaw = await recognize(worker, cropForOCR(source, rel(paper, .09, .475, .38, .075), 2200, false), single);
      const fuelType = detectFuel(fuelRaw);
      setDocProgress(86);

      const global = await recognize(worker, cropForOCR(source, rel(paper, .03, .07, .94, .54), 2600, false), P?.SPARSE_TEXT ?? "11");
      setDocProgress(95);

      const registration = reg.value || cleanRegistration(global);
      const finalChassis = chassis.value || cleanChassis(global);
      const rawModel = modelRead.value || cleanModel(global);
      const model = repairModelWithChassis(rawModel, finalChassis);
      const firstRegistration = first.value || firstRegistrationFromGlobal(global);
      const finalWeight = weight.value || weightFromGlobal(global);
      const type = fuelType !== "その他" ? fuelType : detectFuel(contextAfter(global, ["燃料の種類", "燃料"], 100));
      const last4 = registration.match(/([0-9]{4})(?!.*[0-9])/)?.[1] || "";

      const extracted: Vehicle = {
        ...EMPTY,
        number: finalChassis || registration,
        registration,
        last4,
        chassis: finalChassis,
        model,
        type,
        weight: finalWeight,
        firstRegistration,
      };

      const existing = vehicles.find((v) =>
        (finalChassis && v.chassis === finalChassis) ||
        (registration && v.registration === registration)
      );
      const candidate = existing ? { ...extracted, id: existing.id, customerId: existing.customerId } : extracted;
      setVehicle(candidate);

      const readCount = [registration, finalChassis, model, type !== "その他" ? type : "", finalWeight, firstRegistration].filter(Boolean).length;
      setDocText([
        `紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`,
        `【登録番号 生OCR】 ${reg.raw}`,
        `【登録番号 採用】 ${registration || "未読"}`,
        `【車台番号 生OCR】 ${chassis.raw}`,
        `【車台番号 採用】 ${finalChassis || "未読"}`,
        `【型式 生OCR】 ${modelRead.raw}`,
        `【型式 採用】 ${model || "未読"}`,
        `【車両重量 生OCR】 ${weight.raw}`,
        `【車両重量 採用】 ${finalWeight || "未読"}`,
        `【燃料 生OCR】 ${fuelRaw}`,
        `【燃料 採用】 ${type}`,
        `【初度登録 生OCR】 ${first.raw}`,
        `【初度登録 採用】 ${firstRegistration || "未読"}`,
        "",
        "【上半分OCR】",
        global,
      ].join("\n"));
      setDocProgress(100);

      if (readCount >= 5) {
        setMessage(`6項目中${readCount}項目を読み取りました。内容を確認して「車両を保存」を押してください。`);
      } else {
        setMessage(`読み取れたのは6項目中${readCount}項目です。読めない項目は空欄のままにしました。OCR詳細を確認してください。`);
      }
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
      registration_number_last4: (vehicle.registration.match(/([0-9]{4})(?!.*[0-9])/)?.[1] || vehicle.last4).slice(-4) || null,
      chassis_number: vehicle.chassis.trim() || null,
      model: vehicle.model.trim() || null,
      fuel_type: vehicle.type,
      vehicle_weight: vehicle.weight ? Number(vehicle.weight) : null,
      first_registration: formatJapaneseMonth(vehicle.firstRegistration) || null,
      customer_id: vehicle.customerId || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = vehicle.id
      ? await supabase.from("vehicles").update(payload).eq("id", vehicle.id).select().single()
      : await supabase.from("vehicles").insert(payload).select().single();
    if (error) { setMessage(`車両保存エラー: ${error.message}`); return; }
    const saved: Vehicle = {
      ...vehicle,
      id: data.id,
      number: payload.vehicle_number,
      last4: payload.registration_number_last4 || "",
      firstRegistration: payload.first_registration || "",
    };
    setVehicle(saved);
    setVehicles((old) => [saved, ...old.filter((x) => x.id !== saved.id && x.number !== saved.number)]);
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(saved));
    setMessage("車両情報を保存し、作業車両に設定しました。");
  }

  function startOCR() {
    if (!vehicle.number && !vehicle.chassis) { setMessage("先に作業する車両を選んでください。"); return; }
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
        <p>車体番号・ナンバー下4桁・車台番号・型式で検索できます。選択した車両は部品OCRと紐付けます。</p>
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
        <p>登録番号・車台番号・型式・燃料・車両重量・初度登録を、車検証の各欄を個別に拡大して読み取ります。確信できない値は勝手に埋めず空欄にします。</p>
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
          <label>登録番号<input value={vehicle.registration} onChange={(e) => setVehicle({ ...vehicle, registration: e.target.value, last4: e.target.value.match(/([0-9]{4})(?!.*[0-9])/)?.[1] || "" })} /></label>
          <label>ナンバー下4桁<input inputMode="numeric" maxLength={4} value={vehicle.last4} onChange={(e) => setVehicle({ ...vehicle, last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label>
          <label>車台番号<input value={vehicle.chassis} onChange={(e) => setVehicle({ ...vehicle, chassis: e.target.value })} /></label>
          <label>型式<input value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} /></label>
          <label>燃料<select value={vehicle.type} onChange={(e) => setVehicle({ ...vehicle, type: e.target.value as Vehicle["type"] })}><option>EV</option><option>ガソリン</option><option>HV</option><option>ディーゼル</option><option>その他</option></select></label>
          <label>車両重量 kg<input inputMode="numeric" value={vehicle.weight} onChange={(e) => setVehicle({ ...vehicle, weight: e.target.value })} /></label>
          <label>初度登録（和暦）<input placeholder="例：令和2年4月" value={vehicle.firstRegistration} onChange={(e) => setVehicle({ ...vehicle, firstRegistration: e.target.value })} /></label>
        </div>
        <div className="actions"><button onClick={() => { setVehicle(EMPTY); setMessage("新しい車両を入力してください。"); }}>＋新規車両</button><button onClick={saveVehicle}>車両を保存</button></div>
        <button className="primary" onClick={startOCR}>この車両で伝票OCRへ →</button>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.top button,button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:16px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{font-size:24px;margin:0 0 8px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0;line-height:1.6}.search,input,select{width:100%;border:1px solid #cdd7e5;border-radius:11px;padding:12px;font-size:16px;background:#fff}.list{display:grid;gap:8px;margin-top:12px;max-height:380px;overflow:auto}.vehicleRow{text-align:left;display:grid;gap:3px;color:#172033}.vehicleRow span,.vehicleRow small{color:#5d6878;font-weight:500}.vehicleRow.active{border:2px solid #2f6fe4;background:#eef4ff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid label{display:grid;gap:6px;color:#5d6878;font-weight:700}.actions,.docActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.docActions button{flex:1 1 260px}.primary,.primaryDoc{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.primary{width:100%;margin-top:12px;font-size:18px;padding:16px}.hidden{display:none}.preview{display:block;width:100%;max-height:520px;object-fit:contain;border-radius:14px;margin-top:14px;background:#f4f6fa}.progress{height:8px;background:#e4eaf3;border-radius:999px;overflow:hidden;margin-top:14px}.progress>div{height:100%;background:#2f6fe4;transition:width .2s}details{margin-top:14px;border:1px solid #d9e0ea;border-radius:12px;padding:12px}summary{font-weight:800;cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px}@media(max-width:650px){.grid{grid-template-columns:1fr}.docActions button{flex:1 1 100%}}
      `}</style>
    </main>
  );
}
