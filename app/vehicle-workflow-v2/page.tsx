/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";

type FuelType = "EV" | "ガソリン" | "HV" | "ディーゼル" | "その他";

type CertificateFields = {
  recordDate: string;
  documentNumber: string;
  registrationNumber: string;
  chassisNumber: string;
  registrationDate: string;
  firstRegistration: string;
  inspectionExpiry: string;
  userName: string;
  userAddress: string;
  baseLocation: string;
  vehicleName: string;
  model: string;
  engineModel: string;
  vehicleClass: string;
  purpose: string;
  privateBusiness: string;
  bodyShape: string;
  seatingCapacity: string;
  maxPayloadKg: string;
  vehicleWeightKg: string;
  grossVehicleWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  frontFrontAxleWeightKg: string;
  frontRearAxleWeightKg: string;
  rearFrontAxleWeightKg: string;
  rearRearAxleWeightKg: string;
  displacementOrRatedOutput: string;
  fuel: string;
  modelDesignationNumber: string;
  classificationNumber: string;
};

type Vehicle = {
  id?: string;
  number: string;
  registration: string;
  last4: string;
  chassis: string;
  model: string;
  type: FuelType;
  weight: string;
  firstRegistration: string;
  customerId: string;
  certificate: CertificateFields;
};

type Box = { x: number; y: number; w: number; h: number };
type ReadResult = { raw: string; value: string };

const EMPTY_CERTIFICATE: CertificateFields = {
  recordDate: "",
  documentNumber: "",
  registrationNumber: "",
  chassisNumber: "",
  registrationDate: "",
  firstRegistration: "",
  inspectionExpiry: "",
  userName: "",
  userAddress: "",
  baseLocation: "",
  vehicleName: "",
  model: "",
  engineModel: "",
  vehicleClass: "",
  purpose: "",
  privateBusiness: "",
  bodyShape: "",
  seatingCapacity: "",
  maxPayloadKg: "",
  vehicleWeightKg: "",
  grossVehicleWeightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  frontFrontAxleWeightKg: "",
  frontRearAxleWeightKg: "",
  rearFrontAxleWeightKg: "",
  rearRearAxleWeightKg: "",
  displacementOrRatedOutput: "",
  fuel: "",
  modelDesignationNumber: "",
  classificationNumber: "",
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
  certificate: { ...EMPTY_CERTIFICATE },
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

function eraToWestern(era: string, yearText: string) {
  const y = yearText === "元" ? 1 : Number(yearText);
  if (!Number.isFinite(y) || y < 1) return 0;
  if (era === "令和") return 2018 + y;
  if (era === "平成") return 1988 + y;
  if (era === "昭和") return 1925 + y;
  return 0;
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

function parseJapaneseDate(text: string) {
  const t = normalizeOCR(text).replace(/\s+/g, " ");
  const era = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (era) {
    const y = era[2] === "元" ? "元" : String(Number(era[2]));
    const m = Number(era[3]);
    const d = Number(era[4]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${era[1]}${y}年${m}月${d}日`;
  }
  return "";
}

function japaneseDateToIso(text: string) {
  const t = normalizeOCR(text);
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const year = eraToWestern(m[1], m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatJapaneseMonth(value: string) {
  return value ? parseJapaneseMonth(value) || value : "";
}

function detectFuel(text: string): FuelType {
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

function stripLabels(text: string, labels: string[] = []) {
  let t = normalizeOCR(text).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  for (const label of labels) t = t.split(label).join(" ");
  t = t.replace(/^[\s|:：,，.。・/\\\-]+/, "").replace(/[\s|:：,，.。・/\\\-]+$/, "").trim();
  if (!t || t.length > 120) return "";
  return t;
}

function cleanInteger(text: string, min: number, max: number) {
  const t = normalizeOCR(text).replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/,/g, "");
  const nums = t.match(/\d{1,6}/g) || [];
  for (const raw of nums) {
    const n = Number(raw);
    if (n >= min && n <= max) return String(n);
  }
  return "";
}

function cleanIntegerOrDash(text: string, min: number, max: number) {
  const n = cleanInteger(text, min, max);
  if (n) return n;
  const t = normalizeOCR(text);
  return /(^|\s)-($|\s)/.test(t) ? "-" : "";
}

function cleanDocumentNumber(text: string) {
  const d = digitsJoined(normalizeOCR(text));
  const m = d.match(/\d{10,14}/);
  return m?.[0] || "";
}

function cleanCode(text: string) {
  const t = normalizeOCR(text).toUpperCase().replace(/\s+/g, "");
  const m = t.match(/[A-Z0-9][A-Z0-9-]{1,20}/);
  return m?.[0] || "";
}

function cleanOutput(text: string) {
  const t = stripLabels(text, ["総排気量又は定格出力", "総排気量", "定格出力"]);
  if (!t) return "";
  const m = t.match(/[0-9]+(?:\.[0-9]+)?\s*(?:L|l|kW|KW|kw)?/);
  return m?.[0]?.replace(/\s+/g, "") || t.slice(0, 24);
}

function toNullableInt(value: string) {
  const n = Number(value);
  return value && value !== "-" && Number.isFinite(n) ? n : null;
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

function cropForOCR(source: HTMLCanvasElement, box: Box, targetWidth = 1800, binary = false) {
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
    tessedit_char_whitelist: whitelist,
  };
  await worker.setParameters(params);
  return normalizeOCR((await worker.recognize(canvas)).data.text || "");
}

async function readCell(
  worker: any,
  source: HTMLCanvasElement,
  paper: Box,
  psm: any,
  box: [number, number, number, number],
  parser: (s: string) => string,
  whitelist = "",
  fallbackPad = .010,
): Promise<ReadResult> {
  const a = await recognize(worker, cropForOCR(source, rel(paper, ...box), 1800, false), psm, whitelist);
  const av = parser(a);
  if (av) return { raw: a, value: av };
  const [x, y, w, h] = box;
  const fb: [number, number, number, number] = [
    Math.max(0, x - fallbackPad),
    Math.max(0, y - fallbackPad),
    Math.min(1 - Math.max(0, x - fallbackPad), w + fallbackPad * 2),
    Math.min(1 - Math.max(0, y - fallbackPad), h + fallbackPad * 2),
  ];
  const b = await recognize(worker, cropForOCR(source, rel(paper, ...fb), 2000, true), psm, whitelist);
  return { raw: [a, b].filter(Boolean).join(" / "), value: parser(`${a}\n${b}`) };
}

const FIELD_LABELS: Array<[keyof CertificateFields, string]> = [
  ["recordDate", "記録年月日"],
  ["documentNumber", "記録事項番号"],
  ["registrationNumber", "自動車登録番号又は車両番号"],
  ["chassisNumber", "車台番号"],
  ["registrationDate", "登録年月日／交付年月日"],
  ["firstRegistration", "初度登録年月"],
  ["inspectionExpiry", "有効期間の満了する日"],
  ["userName", "使用者の氏名又は名称"],
  ["userAddress", "使用者の住所"],
  ["baseLocation", "使用の本拠の位置"],
  ["vehicleName", "車名"],
  ["model", "型式"],
  ["engineModel", "原動機の型式"],
  ["vehicleClass", "自動車の種別"],
  ["purpose", "用途"],
  ["privateBusiness", "自家用・事業用の別"],
  ["bodyShape", "車体の形状"],
  ["seatingCapacity", "乗車定員"],
  ["maxPayloadKg", "最大積載量 kg"],
  ["vehicleWeightKg", "車両重量 kg"],
  ["grossVehicleWeightKg", "車両総重量 kg"],
  ["lengthCm", "長さ cm"],
  ["widthCm", "幅 cm"],
  ["heightCm", "高さ cm"],
  ["frontFrontAxleWeightKg", "前前軸重 kg"],
  ["frontRearAxleWeightKg", "前後軸重 kg"],
  ["rearFrontAxleWeightKg", "後前軸重 kg"],
  ["rearRearAxleWeightKg", "後後軸重 kg"],
  ["displacementOrRatedOutput", "総排気量又は定格出力"],
  ["fuel", "燃料の種類"],
  ["modelDesignationNumber", "型式指定番号"],
  ["classificationNumber", "類別区分番号"],
];

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
          type: (v.fuel_type || "その他") as FuelType,
          weight: v.vehicle_weight == null ? "" : String(v.vehicle_weight),
          firstRegistration: formatJapaneseMonth(v.first_registration || ""),
          customerId: v.customer_id || "",
          certificate: { ...EMPTY_CERTIFICATE, ...(v.certificate_fields || {}) },
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

  function updateCertificateField(key: keyof CertificateFields, value: string) {
    const certificate = { ...vehicle.certificate, [key]: value };
    const next: Vehicle = { ...vehicle, certificate };
    if (key === "registrationNumber") {
      next.registration = value;
      next.last4 = value.match(/([0-9]{4})(?!.*[0-9])/)?.[1] || "";
    }
    if (key === "chassisNumber") next.chassis = value;
    if (key === "model") next.model = value;
    if (key === "vehicleWeightKg") next.weight = value;
    if (key === "firstRegistration") next.firstRegistration = value;
    if (key === "fuel") next.type = detectFuel(value);
    setVehicle(next);
  }

  async function readVehicleCertificate(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("写真・画像の車検証を選んでください。PDF対応は後で追加できます。");
      return;
    }
    setDocBusy(true);
    setDocProgress(1);
    setDocText("");
    setMessage("備考欄より上の車検証情報を読み取り中です…");
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
      const block = P?.SINGLE_BLOCK ?? "6";
      const debug: string[] = [`紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
      const fields: CertificateFields = { ...EMPTY_CERTIFICATE };
      let done = 0;
      const total = 32;
      const tick = () => { done += 1; setDocProgress(Math.min(96, Math.round((done / total) * 95))); };
      const read = async (
        key: keyof CertificateFields,
        box: [number, number, number, number],
        parser: (s: string) => string,
        whitelist = "",
        psm = single,
      ) => {
        const r = await readCell(worker, source, paper, psm, box, parser, whitelist);
        fields[key] = r.value;
        debug.push(`【${FIELD_LABELS.find(([k]) => k === key)?.[1] || key} 生OCR】 ${r.raw || "(空)"}`);
        debug.push(`【${FIELD_LABELS.find(([k]) => k === key)?.[1] || key} 採用】 ${r.value || "未読"}`);
        tick();
      };

      await read("recordDate", [.67, .070, .29, .040], parseJapaneseDate);
      await read("documentNumber", [.75, .100, .21, .034], cleanDocumentNumber, "0123456789");
      await read("registrationNumber", [.17, .122, .75, .042], cleanRegistration);
      await read("chassisNumber", [.15, .155, .75, .042], cleanChassis, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");
      await read("registrationDate", [.22, .184, .21, .044], parseJapaneseDate);
      await read("firstRegistration", [.46, .184, .20, .044], parseJapaneseMonth);
      await read("inspectionExpiry", [.70, .184, .25, .044], parseJapaneseDate);
      await read("userName", [.23, .230, .69, .042], (s) => stripLabels(s, ["使用者の氏名又は名称"]), "", block);
      await read("userAddress", [.23, .262, .69, .044], (s) => stripLabels(s, ["使用者の住所"]), "", block);
      await read("baseLocation", [.23, .294, .69, .044], (s) => stripLabels(s, ["使用の本拠の位置"]), "", block);
      await read("vehicleName", [.15, .329, .29, .040], (s) => stripLabels(s, ["車名"]));

      const modelRead = await readCell(worker, source, paper, single, [.13, .356, .38, .045], cleanModel, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");
      debug.push(`【型式 生OCR】 ${modelRead.raw || "(空)"}`); tick();
      await read("engineModel", [.61, .356, .23, .045], cleanCode, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");
      await read("vehicleClass", [.14, .386, .20, .042], (s) => stripLabels(s, ["自動車の種別"]));
      await read("purpose", [.40, .386, .18, .042], (s) => stripLabels(s, ["用途"]));
      await read("privateBusiness", [.68, .386, .24, .042], (s) => stripLabels(s, ["自家用・事業用の別", "自家用・事業用"]));
      await read("bodyShape", [.14, .416, .26, .042], (s) => stripLabels(s, ["車体の形状"]));
      await read("seatingCapacity", [.50, .416, .12, .042], (s) => cleanInteger(s, 1, 99), "0123456789人");
      await read("maxPayloadKg", [.78, .416, .16, .042], (s) => cleanIntegerOrDash(s, 1, 99999), "0123456789-kgKG");
      await read("vehicleWeightKg", [.14, .446, .16, .042], (s) => cleanInteger(s, 100, 99999), "0123456789kgKG");
      await read("grossVehicleWeightKg", [.37, .446, .18, .042], (s) => cleanInteger(s, 100, 99999), "0123456789kgKG");
      await read("lengthCm", [.61, .446, .09, .042], (s) => cleanInteger(s, 50, 3000), "0123456789cmCM");
      await read("widthCm", [.73, .446, .09, .042], (s) => cleanInteger(s, 50, 1000), "0123456789cmCM");
      await read("heightCm", [.85, .446, .10, .042], (s) => cleanInteger(s, 50, 1000), "0123456789cmCM");
      await read("frontFrontAxleWeightKg", [.14, .476, .13, .040], (s) => cleanIntegerOrDash(s, 1, 30000), "0123456789-kgKG");
      await read("frontRearAxleWeightKg", [.30, .476, .13, .040], (s) => cleanIntegerOrDash(s, 1, 30000), "0123456789-kgKG");
      await read("rearFrontAxleWeightKg", [.46, .476, .13, .040], (s) => cleanIntegerOrDash(s, 1, 30000), "0123456789-kgKG");
      await read("rearRearAxleWeightKg", [.62, .476, .13, .040], (s) => cleanIntegerOrDash(s, 1, 30000), "0123456789-kgKG");
      await read("displacementOrRatedOutput", [.78, .476, .18, .040], cleanOutput, "0123456789.LlkWKWkw");
      await read("fuel", [.14, .506, .25, .040], (s) => stripLabels(s, ["燃料の種類"]));
      await read("modelDesignationNumber", [.56, .506, .17, .040], (s) => cleanIntegerOrDash(s, 1, 999999), "0123456789-");
      await read("classificationNumber", [.79, .506, .16, .040], (s) => cleanIntegerOrDash(s, 1, 999999), "0123456789-");

      const global = await recognize(worker, cropForOCR(source, rel(paper, .03, .065, .94, .48), 2500, false), P?.SPARSE_TEXT ?? "11");
      debug.push("", "【備考欄より上 全体OCR】", global);

      fields.registrationNumber ||= cleanRegistration(global);
      fields.chassisNumber ||= cleanChassis(global);
      const rawModel = modelRead.value || cleanModel(global);
      fields.model = repairModelWithChassis(rawModel, fields.chassisNumber);
      fields.firstRegistration ||= parseJapaneseMonth(global);
      if (!fields.fuel) {
        const fuelMatch = global.match(/(?:燃料の種類|燃料)\s*([^\n]{1,20})/);
        fields.fuel = fuelMatch ? stripLabels(fuelMatch[1]) : "";
      }

      const type = detectFuel(fields.fuel || global);
      const last4 = fields.registrationNumber.match(/([0-9]{4})(?!.*[0-9])/)?.[1] || "";
      const extracted: Vehicle = {
        ...EMPTY,
        number: fields.chassisNumber || fields.registrationNumber,
        registration: fields.registrationNumber,
        last4,
        chassis: fields.chassisNumber,
        model: fields.model,
        type,
        weight: fields.vehicleWeightKg,
        firstRegistration: fields.firstRegistration,
        certificate: fields,
      };

      const existing = vehicles.find((v) =>
        (fields.chassisNumber && v.chassis === fields.chassisNumber) ||
        (fields.registrationNumber && v.registration === fields.registrationNumber)
      );
      const candidate = existing ? { ...extracted, id: existing.id, customerId: existing.customerId } : extracted;
      setVehicle(candidate);
      const readCount = FIELD_LABELS.filter(([key]) => Boolean(fields[key])).length;
      setDocText(debug.join("\n"));
      setDocProgress(100);
      setMessage(`備考欄より上の${FIELD_LABELS.length}項目中${readCount}項目を読み取りました。内容を確認・修正してから保存してください。`);
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
    const c = vehicle.certificate;
    const payload = {
      vehicle_number: vehicle.number.trim() || vehicle.chassis.trim(),
      registration_number: vehicle.registration.trim() || null,
      registration_number_last4: (vehicle.registration.match(/([0-9]{4})(?!.*[0-9])/)?.[1] || vehicle.last4).slice(-4) || null,
      chassis_number: vehicle.chassis.trim() || null,
      model: vehicle.model.trim() || null,
      fuel_type: vehicle.type,
      vehicle_weight: vehicle.weight ? Number(vehicle.weight) : null,
      curb_weight_kg: toNullableInt(c.vehicleWeightKg),
      gross_vehicle_weight_kg: toNullableInt(c.grossVehicleWeightKg),
      seating_capacity: toNullableInt(c.seatingCapacity),
      engine_model: c.engineModel || null,
      usage_category: c.purpose || null,
      body_type: c.bodyShape || null,
      inspection_certificate_number: c.documentNumber || null,
      user_name_snapshot: c.userName || null,
      first_registration: formatJapaneseMonth(vehicle.firstRegistration) || null,
      inspection_expiry_date: japaneseDateToIso(c.inspectionExpiry),
      certificate_fields: c,
      front_front_axle_weight_kg: toNullableInt(c.frontFrontAxleWeightKg),
      front_rear_axle_weight_kg: toNullableInt(c.frontRearAxleWeightKg),
      rear_front_axle_weight_kg: toNullableInt(c.rearFrontAxleWeightKg),
      rear_rear_axle_weight_kg: toNullableInt(c.rearRearAxleWeightKg),
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
    setMessage("車検証の全項目と軸重を含めて車両情報を保存しました。");
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
        <p>備考欄より上にある基本情報・使用者情報・車両詳細情報を全部読み取ります。前前軸重・前後軸重・後前軸重・後後軸重も保存します。確信できない項目は空欄にします。</p>
        <input ref={cameraRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readVehicleCertificate(f); e.currentTarget.value = ""; }} />
        <input ref={libraryRef} className="hidden" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readVehicleCertificate(f); e.currentTarget.value = ""; }} />
        <div className="docActions">
          <button className="primaryDoc" disabled={docBusy} onClick={() => cameraRef.current?.click()}>📷 今撮影して読み取る</button>
          <button disabled={docBusy} onClick={() => libraryRef.current?.click()}>🖼 写真ライブラリから読み取る</button>
        </div>
        {docBusy && <><div className="progress"><div style={{ width: `${docProgress}%` }} /></div><p className="progressText">読み取り中 {docProgress}%</p></>}
        {docPreview && <img className="preview" src={docPreview} alt="車検証プレビュー" />}
        {docText && <details><summary>OCR詳細（確認用）</summary><pre>{docText}</pre></details>}
      </section>

      <section className="card">
        <h2>選択中 / 新規登録</h2>
        <div className="grid">
          <label>車体番号<input value={vehicle.number} onChange={(e) => setVehicle({ ...vehicle, number: e.target.value })} /></label>
          <label>登録番号<input value={vehicle.registration} onChange={(e) => updateCertificateField("registrationNumber", e.target.value)} /></label>
          <label>ナンバー下4桁<input inputMode="numeric" maxLength={4} value={vehicle.last4} onChange={(e) => setVehicle({ ...vehicle, last4: e.target.value.replace(/\D/g, "").slice(-4) })} /></label>
          <label>車台番号<input value={vehicle.chassis} onChange={(e) => updateCertificateField("chassisNumber", e.target.value)} /></label>
          <label>型式<input value={vehicle.model} onChange={(e) => updateCertificateField("model", e.target.value)} /></label>
          <label>燃料<select value={vehicle.type} onChange={(e) => setVehicle({ ...vehicle, type: e.target.value as FuelType })}><option>EV</option><option>ガソリン</option><option>HV</option><option>ディーゼル</option><option>その他</option></select></label>
          <label>車両重量 kg<input inputMode="numeric" value={vehicle.weight} onChange={(e) => updateCertificateField("vehicleWeightKg", e.target.value)} /></label>
          <label>初度登録（和暦）<input placeholder="例：令和2年4月" value={vehicle.firstRegistration} onChange={(e) => updateCertificateField("firstRegistration", e.target.value)} /></label>
        </div>
      </section>

      <section className="card allFields">
        <h2>車検証読み取り情報（備考欄より上）</h2>
        <p>読み取った内容はここで全部確認・修正できます。「－」は車検証上で該当値がない欄です。</p>
        <div className="fullGrid">
          {FIELD_LABELS.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input value={vehicle.certificate[key]} onChange={(e) => updateCertificateField(key, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="axleNote">
          <b>軸重</b>
          <span>前前 {vehicle.certificate.frontFrontAxleWeightKg || "未読"} kg</span>
          <span>前後 {vehicle.certificate.frontRearAxleWeightKg || "未読"} kg</span>
          <span>後前 {vehicle.certificate.rearFrontAxleWeightKg || "未読"} kg</span>
          <span>後後 {vehicle.certificate.rearRearAxleWeightKg || "未読"} kg</span>
        </div>
        <div className="actions"><button onClick={() => { setVehicle({ ...EMPTY, certificate: { ...EMPTY_CERTIFICATE } }); setMessage("新しい車両を入力してください。"); }}>＋新規車両</button><button onClick={saveVehicle}>車両を保存</button></div>
        <button className="primary" onClick={startOCR}>この車両で伝票OCRへ →</button>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.top button,button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:16px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{font-size:24px;margin:0 0 8px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0;line-height:1.6}.search,input,select{width:100%;border:1px solid #cdd7e5;border-radius:11px;padding:12px;font-size:16px;background:#fff}.list{display:grid;gap:8px;margin-top:12px;max-height:380px;overflow:auto}.vehicleRow{text-align:left;display:grid;gap:3px;color:#172033}.vehicleRow span,.vehicleRow small{color:#5d6878;font-weight:500}.vehicleRow.active{border:2px solid #2f6fe4;background:#eef4ff}.grid,.fullGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid label,.fullGrid label{display:grid;gap:6px;color:#5d6878;font-weight:700}.fullGrid label span{font-size:14px}.actions,.docActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.docActions button{flex:1 1 260px}.primary,.primaryDoc{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.primary{width:100%;margin-top:12px;font-size:18px;padding:16px}.hidden{display:none}.preview{display:block;width:100%;max-height:520px;object-fit:contain;border-radius:14px;margin-top:14px;background:#f4f6fa}.progress{height:8px;background:#e4eaf3;border-radius:999px;overflow:hidden;margin-top:14px}.progress>div{height:100%;background:#2f6fe4;transition:width .2s}.progressText{font-size:13px;margin:5px 0 0}details{margin-top:14px;border:1px solid #d9e0ea;border-radius:12px;padding:12px}summary{font-weight:800;cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px}.axleNote{margin-top:16px;background:#eef4ff;border:1px solid #c8d8fb;border-radius:14px;padding:14px;display:flex;gap:12px;flex-wrap:wrap}.axleNote b{width:100%}.axleNote span{font-weight:700;color:#315fba}@media(max-width:650px){.grid,.fullGrid{grid-template-columns:1fr}.docActions button{flex:1 1 100%}.card{padding:18px}.page{padding-left:10px;padding-right:10px}}
      `}</style>
    </main>
  );
}
