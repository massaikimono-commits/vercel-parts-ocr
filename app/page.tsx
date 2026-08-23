/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

type Part = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
};

type Vehicle = {
  number: string;
  model: string;
  type: "EV" | "ガソリン" | "HV" | "その他";
  weight: string;
  registration: string;
  last4: string;
  chassis: string;
  firstRegistration: string;
  customerId: string;
};

type Customer = {
  id: string;
  type: "individual" | "company";
  name: string;
  companyName: string;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  notes: string;
};

type Box = { x: number; y: number; w: number; h: number };
type Template = {
  widthMm: number;
  heightMm: number;
  fields: { name: Box; qty: Box; retail: Box; cost: Box };
};

type CropBox = { x: number; y: number; w: number; h: number };

type PreparedOCRImages = {
  full: Blob;
  table: Blob;
};

const initialTemplate: Template = {
  widthMm: 210,
  heightMm: 297,
  fields: {
    name: { x: 45, y: 28, w: 42, h: 5 },
    qty: { x: 89, y: 28, w: 9, h: 5 },
    retail: { x: 102, y: 28, w: 18, h: 5 },
    cost: { x: 122, y: 28, w: 18, h: 5 },
  },
};

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const money = (s: string) => s.replace(/[^\d.-]/g, "");

const OCR_HEADERS = [
  "納品書",
  "品番",
  "品名",
  "受注数",
  "出庫数",
  "標準価格",
  "単価",
  "金額",
  "合計金額",
  "伝票",
  "コード",
  "年月日",
  "区分",
  "車台番号",
  "型式",
  "備考",
  "倉庫",
  "棚番",
  "受注残",
];

function normalizeOCR(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[￥¥]/g, "¥")
    .replace(/[，、]/g, ",")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[｜¦]/g, "|")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "");
}

function amountValues(line: string) {
  const matches = line.match(/\d{1,3}(?:[, ]\d{3})+|\d{4,7}/g) || [];
  return matches
    .map((raw) => ({ raw, value: Number(raw.replace(/[, ]/g, "")) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 100 && x.value <= 2000000);
}

function candidateQty(line: string, firstAmountRaw?: string) {
  const before = firstAmountRaw ? line.slice(0, line.indexOf(firstAmountRaw)) : line;
  const matches = before.match(/(?:^|\s)(\d{1,3})(?=\s|$)/g) || [];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const n = Number(matches[i].trim());
    if (n >= 1 && n <= 999) return String(n);
  }
  return "1";
}

function cleanName(line: string) {
  return line
    .replace(/¥\s*\d[\d, ]*/g, " ")
    .replace(/\b\d{4,7}\b/g, " ")
    .replace(/^[\s:;|・.\-]+|[\s:;|・.\-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function nameScore(line: string) {
  if (!line) return -100;
  if (OCR_HEADERS.some((h) => line.includes(h))) return -100;

  const cleaned = cleanName(line);
  if (cleaned.length < 2) return -100;

  let score = 0;
  if (/[ぁ-んァ-ヶ一-龠]/.test(cleaned)) score += 5;
  if (/[A-Za-z]/.test(cleaned)) score += 1;
  if (/ASSY|KIT|SET|COMP|クラッチ|ブレーキ|パッド|フィルタ|オイル/i.test(cleaned)) score += 3;
  if (/[\/／]/.test(cleaned)) score += 1;
  if (/^[A-Z0-9_.\/-]+$/i.test(cleaned)) score -= 3;

  const digits = (cleaned.match(/\d/g) || []).length;
  if (digits > cleaned.length * 0.45) score -= 4;
  if (cleaned.length > 45) score -= 2;
  return score;
}

function findNearbyName(lines: string[], rowIndex: number) {
  let best = "";
  let bestScore = -100;

  for (let i = Math.max(0, rowIndex - 5); i <= Math.min(lines.length - 1, rowIndex + 1); i += 1) {
    if (i === rowIndex) continue;
    const s = nameScore(lines[i]);
    if (s > bestScore) {
      bestScore = s;
      best = cleanName(lines[i]);
    }
  }
  return bestScore >= 1 ? best : "";
}

function parseOCR(text: string): Part[] {
  const lines = normalizeOCR(text)
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: Part[] = [];

  // 表の1行に「個数 / 標準価格 / 単価 / 金額」が並ぶケースを優先。
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const amounts = amountValues(line);
    if (amounts.length < 2) continue;

    const name = findNearbyName(lines, i);
    if (!name) continue;

    const qty = candidateQty(line, amounts[0]?.raw);
    out.push({
      id: uid(),
      name,
      qty,
      retail: String(amounts[0].value),
      cost: String(amounts[1].value),
      source: `${name} | ${line}`,
    });
  }

  // Tesseractが列を改行した場合のフォールバック。
  if (!out.length) {
    for (let i = 0; i < lines.length - 1; i += 1) {
      const joined = `${lines[i]} ${lines[i + 1]}`;
      const amounts = amountValues(joined);
      if (amounts.length < 2) continue;

      const name = findNearbyName(lines, i);
      if (!name) continue;

      out.push({
        id: uid(),
        name,
        qty: candidateQty(joined, amounts[0]?.raw),
        retail: String(amounts[0].value),
        cost: String(amounts[1].value),
        source: `${name} | ${joined}`,
      });
      i += 1;
    }
  }

  // 旧形式（カンマ/タブ区切り）も残す。
  if (!out.length) {
    for (const line of lines) {
      const c = line
        .split(/[,\t|]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (c.length < 4) continue;
      const n = c.slice(1).filter((x) => /\d/.test(x));
      if (n.length < 3) continue;
      out.push({
        id: uid(),
        name: c[0],
        qty: n[0].replace(/[^\d.-]/g, ""),
        retail: money(n[1]),
        cost: money(n[2]),
        source: line,
      });
    }
  }

  const seen = new Set<string>();
  return out.filter((p) => {
    const key = `${p.name.replace(/\s/g, "").toLowerCase()}|${p.qty}|${p.retail}|${p.cost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.94) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像変換に失敗しました。"))),
      "image/jpeg",
      quality
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を開けませんでした。"));
    };
    img.src = url;
  });
}

function detectPaperBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };

  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 900));
  const rowHits = new Array(h).fill(0);

  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const warm = r + g > b * 2.05;
    return (bright > 150 && r > 105 && g > 105) || (bright > 108 && warm && r > 95 && g > 95);
  };

  for (let y = 0; y < h; y += step) {
    let hits = 0;
    let samples = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hits += 1;
      samples += 1;
    }
    rowHits[y] = samples ? hits / samples : 0;
  }

  const rowThreshold = 0.16;
  let top = 0;
  let bottom = h - 1;
  const goodRows: number[] = [];
  for (let y = 0; y < h; y += step) if (rowHits[y] >= rowThreshold) goodRows.push(y);
  if (goodRows.length >= 4) {
    top = Math.max(0, goodRows[0] - step * 2);
    bottom = Math.min(h - 1, goodRows[goodRows.length - 1] + step * 2);
  }

  const colHits = new Array(w).fill(0);
  for (let x = 0; x < w; x += step) {
    let hits = 0;
    let samples = 0;
    for (let y = top; y <= bottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hits += 1;
      samples += 1;
    }
    colHits[x] = samples ? hits / samples : 0;
  }

  const goodCols: number[] = [];
  for (let x = 0; x < w; x += step) if (colHits[x] >= 0.18) goodCols.push(x);
  let left = 0;
  let right = w - 1;
  if (goodCols.length >= 4) {
    left = Math.max(0, goodCols[0] - step * 2);
    right = Math.min(w - 1, goodCols[goodCols.length - 1] + step * 2);
  }

  const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  if (box.w * box.h < w * h * 0.24 || box.w < w * 0.45 || box.h < h * 0.28) {
    return { x: 0, y: 0, w, h };
  }
  return box;
}

function otsuThreshold(gray: Uint8ClampedArray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 150;
  let maxVariance = 0;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      best = t;
    }
  }
  return Math.max(92, Math.min(190, best));
}

async function renderEnhanced(
  source: HTMLCanvasElement,
  crop: CropBox,
  targetWidth: number,
  binary: boolean
) {
  const scale = Math.min(targetWidth / crop.w, 2.8);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(crop.w * scale));
  out.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像処理を開始できませんでした。");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);

  const image = ctx.getImageData(0, 0, out.width, out.height);
  const gray = new Uint8ClampedArray(out.width * out.height);
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    let v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.38 + 138)));
    gray[i] = v;
  }

  const threshold = otsuThreshold(gray);
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (binary) v = v < threshold ? 0 : 255;
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvasBlob(out, binary ? 0.96 : 0.94);
}

async function prepareOCRImages(file: File): Promise<PreparedOCRImages> {
  const img = await loadImage(file);
  const maxDetect = 1500;
  const scale = Math.min(1, maxDetect / Math.max(img.naturalWidth, img.naturalHeight));
  const source = document.createElement("canvas");
  source.width = Math.max(1, Math.round(img.naturalWidth * scale));
  source.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = source.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0, source.width, source.height);

  const paper = detectPaperBox(source);
  const table: CropBox = {
    x: paper.x,
    y: Math.round(paper.y + paper.h * 0.30),
    w: paper.w,
    h: Math.round(paper.h * 0.48),
  };
  table.y = Math.min(source.height - 1, Math.max(0, table.y));
  table.h = Math.max(1, Math.min(source.height - table.y, table.h));

  const [full, tableBlob] = await Promise.all([
    renderEnhanced(source, paper, 2200, false),
    renderEnhanced(source, table, 2500, true),
  ]);
  return { full, table: tableBlob };
}

function mergeParts(parts: Part[]) {
  const seen = new Set<string>();
  return parts.filter((p) => {
    const key = `${p.name.replace(/\s/g, "").toLowerCase()}|${p.qty}|${p.retail}|${p.cost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [tab, setTab] = useState<
    "vehicle" | "customerVehicle" | "ocr" | "data" | "print" | "settings"
  >("vehicle");

  const emptyVehicle: Vehicle = {
    number: "",
    model: "",
    type: "EV",
    weight: "",
    registration: "",
    last4: "",
    chassis: "",
    firstRegistration: "",
    customerId: "",
  };
  const emptyCustomer: Customer = {
    id: "",
    type: "individual",
    name: "",
    companyName: "",
    phone: "",
    email: "",
    postalCode: "",
    address: "",
    notes: "",
  };

  const [vehicle, setVehicle] = useState<Vehicle>(emptyVehicle);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const [template, setTemplate] = useState<Template>(initialTemplate);
  const [guide, setGuide] = useState("");
  const [printCount, setPrintCount] = useState(10);
  const [selected, setSelected] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setAuthLoading(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setAuthLoading(false);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    try {
      const p = localStorage.getItem("parts-data");
      if (p) setParts(JSON.parse(p));
      const t = localStorage.getItem("parts-template");
      if (t) setTemplate(JSON.parse(t));
    } catch {}
  }, []);

  useEffect(() => localStorage.setItem("parts-data", JSON.stringify(parts)), [parts]);
  useEffect(() => localStorage.setItem("parts-template", JSON.stringify(template)), [template]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const [{ data: cs }, { data: vs }] = await Promise.all([
        supabase.from("customers").select("*").order("created_at", { ascending: false }),
        supabase.from("vehicles").select("*").order("created_at", { ascending: false }),
      ]);
      if (cs) {
        setCustomers(cs.map((c: any) => ({
          id: c.id,
          type: c.customer_type,
          name: c.name,
          companyName: c.company_name || "",
          phone: c.phone || "",
          email: c.email || "",
          postalCode: c.postal_code || "",
          address: c.address || "",
          notes: c.notes || "",
        })));
      }
      if (vs) {
        setVehicles(vs.map((v: any) => ({
          number: v.vehicle_number,
          model: v.model || "",
          type: (v.fuel_type || "その他") as Vehicle["type"],
          weight: v.vehicle_weight == null ? "" : String(v.vehicle_weight),
          registration: v.registration_number || "",
          last4: v.registration_number_last4 || "",
          chassis: v.chassis_number || "",
          firstRegistration: v.first_registration || "",
          customerId: v.customer_id || "",
          id: v.id,
        }) as any));
      }
    })();
  }, [session]);

  const filtered = useMemo(
    () => vehicles.filter((v) => !vehicleSearch || v.number.includes(vehicleSearch) || v.model.includes(vehicleSearch)),
    [vehicles, vehicleSearch]
  );
  const customerFiltered = useMemo(
    () => customers.filter((c) => !customerSearch || c.name.includes(customerSearch) || c.companyName.includes(customerSearch) || c.phone.includes(customerSearch)),
    [customers, customerSearch]
  );
  const registrationFiltered = useMemo(
    () => vehicles.filter((v) => !registrationSearch || v.last4 === registrationSearch.trim().slice(-4)),
    [vehicles, registrationSearch]
  );

  async function saveVehicle() {
    if (!vehicle.number.trim()) return setMsg("車体番号を入力してください。");
    if (!session) return setMsg("ログインしてください。");

    const normalized = {
      ...vehicle,
      number: vehicle.number.trim(),
      model: vehicle.model.trim(),
      registration: vehicle.registration.trim(),
      chassis: vehicle.chassis.trim(),
      firstRegistration: vehicle.firstRegistration.trim(),
      weight: vehicle.weight.trim(),
      customerId: vehicle.customerId.trim(),
      last4: (vehicle.registration.replace(/\D/g, "").slice(-4) || vehicle.last4).slice(-4),
    };
    const payload = {
      vehicle_number: normalized.number,
      registration_number: normalized.registration || null,
      model: normalized.model || null,
      fuel_type: normalized.type,
      vehicle_weight: normalized.weight ? Number(normalized.weight) : null,
      customer_id: normalized.customerId || null,
      chassis_number: normalized.chassis || null,
      first_registration: normalized.firstRegistration || null,
      registration_number_last4: normalized.last4 || null,
      updated_at: new Date().toISOString(),
    };
    const existing = (vehicle as any).id;
    const { data, error } = existing
      ? await supabase.from("vehicles").update(payload).eq("id", existing).select().single()
      : await supabase.from("vehicles").insert(payload).select().single();
    if (error) return setMsg(`車両保存エラー: ${error.message}`);
    const saved: any = { ...normalized, id: data.id };
    setVehicles((v) => [saved, ...v.filter((x: any) => x.number !== saved.number)].slice(0, 500));
    setVehicle(saved);
    setMsg("車両情報を保存しました。");
  }

  async function saveCustomer() {
    if (!customer.name.trim() && !customer.companyName.trim()) return setMsg("顧客名または会社名を入力してください。");
    if (!session) return setMsg("ログインしてください。");
    const payload = {
      customer_type: customer.type,
      name: customer.name || customer.companyName,
      company_name: customer.companyName || null,
      phone: customer.phone || null,
      email: customer.email || null,
      postal_code: customer.postalCode || null,
      address: customer.address || null,
      notes: customer.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = customer.id
      ? await supabase.from("customers").update(payload).eq("id", customer.id).select().single()
      : await supabase.from("customers").insert(payload).select().single();
    if (error) return setMsg(`顧客保存エラー: ${error.message}`);
    const saved = { ...customer, id: data.id };
    setCustomers((c) => [saved, ...c.filter((x) => x.id !== saved.id)].slice(0, 500));
    setCustomer(saved);
    setMsg("顧客情報を保存しました。");
  }

  async function doOCR(file: File) {
    setOcrBusy(true);
    setProgress(0);
    setMsg("画像を自動補正しています…");

    let worker: any = null;
    try {
      const prepared = await prepareOCRImages(file);
      setProgress(8);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            const p = Math.round((m.progress || 0) * 42);
            setProgress((old) => Math.max(old, Math.min(95, p)));
          }
        },
      });

      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3",
      });
      const fullResult = await worker.recognize(prepared.full);
      setProgress(52);

      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
      });
      const tableResult = await worker.recognize(prepared.table);
      setProgress(98);

      const combinedText = [
        "【伝票全体】",
        fullResult.data.text || "",
        "",
        "【部品表拡大】",
        tableResult.data.text || "",
      ].join("\n");
      setOcrText(combinedText);

      const found = mergeParts([
        ...parseOCR(tableResult.data.text || ""),
        ...parseOCR(fullResult.data.text || ""),
      ]);
      if (found.length) setParts((p) => [...found, ...p]);
      setProgress(100);
      setMsg(
        found.length
          ? `${found.length}件を自動抽出しました。部品名称・個数・定価・仕入れを確認してください。`
          : "文字は読み取りましたが4項目を自動抽出できませんでした。OCR結果を確認してください。"
      );
    } catch (error: any) {
      console.error(error);
      setMsg("OCRに失敗しました。伝票全体が画面に入るように撮影して再試行してください。");
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setOcrBusy(false);
    }
  }

  function updatePart(id: string, key: keyof Part, val: string) {
    setParts((p) => p.map((x) => (x.id === id ? { ...x, [key]: val } : x)));
  }

  function copyTSV() {
    const s = ["部品名称\t個数\t定価\t仕入れ", ...parts.map((p) => `${p.name}\t${p.qty}\t${p.retail}\t${p.cost}`)].join("\n");
    navigator.clipboard?.writeText(s);
    setMsg("Excel貼り付け用データをコピーしました。");
  }

  function csv() {
    const s = [["部品名称", "個数", "定価", "仕入れ"], ...parts.map((p) => [p.name, p.qty, p.retail, p.cost])]
      .map((r) => r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + s], { type: "text/csv;charset=utf-8" }));
    a.download = "parts.csv";
    a.click();
  }

  function setBox(f: "name" | "qty" | "retail" | "cost", k: keyof Box, v: string) {
    setTemplate((t) => ({ ...t, fields: { ...t.fields, [f]: { ...t.fields[f], [k]: Number(v) } } }));
  }

  function importGuide(file: File) {
    const r = new FileReader();
    r.onload = () => setGuide(String(r.result || ""));
    r.readAsDataURL(file);
  }

  const active = parts.find((p) => p.id === selected);

  if (authLoading) {
    return <main><section className="card"><h1>読み込み中…</h1></section></main>;
  }

  if (!session) {
    return (
      <main>
        <header className="header"><div className="title" style={{ fontSize: "42px", fontWeight: 800 }}>icb</div></header>
        <section className="card">
          <h1>ログイン</h1>
          <input type="text" autoCapitalize="none" autoCorrect="off" placeholder="ログインID" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
          <input type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="actions">
            <button className="primary" onClick={async () => {
              setAuthMsg("");
              const id = loginId.trim().toLowerCase();
              if (!id) return setAuthMsg("ログインIDを入力してください。");
              if (!password) return setAuthMsg("パスワードを入力してください。");
              const { error } = await supabase.auth.signInWithPassword({ email: `${id}@icb.local`, password });
              if (error) setAuthMsg("ログインIDまたはパスワードが違います。");
            }}>ログイン</button>
          </div>
          {authMsg && <div className="notice">{authMsg}</div>}
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="header"><div className="title">icb</div><div className="desc">部品伝票OCR・車両管理・印刷</div></header>
      <nav className="tabs">
        {([
          ["vehicle", "①車体番号"],
          ["customerVehicle", "⑤顧客・車両管理"],
          ["ocr", "②伝票OCR"],
          ["data", "③データ"],
          ["print", "④印刷"],
          ["settings", "⑥印刷位置設定"],
        ] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <div className="actions noPrint"><button onClick={async () => supabase.auth.signOut()}>ログアウト</button></div>
      {msg && <div className="notice">{msg}</div>}

      {tab === "vehicle" && (
        <section className="card">
          <h1>車体番号</h1>
          <input placeholder="車体番号" value={vehicle.number} onChange={(e) => setVehicle({ ...vehicle, number: e.target.value })} />
          <input placeholder="型式" value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} />
          <select value={vehicle.type} onChange={(e) => setVehicle({ ...vehicle, type: e.target.value as Vehicle["type"] })}>
            <option>EV</option><option>ガソリン</option><option>HV</option><option>その他</option>
          </select>
          <input inputMode="numeric" placeholder="車両重量 kg" value={vehicle.weight} onChange={(e) => setVehicle({ ...vehicle, weight: e.target.value })} />
          <button className="primary" onClick={saveVehicle}>保存</button>
          <hr />
          <input placeholder="車体番号で検索" value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} />
          <div className="list">{filtered.map((v, i) => <button className="row" key={i} onClick={() => setVehicle(v)}>{v.number}　{v.model}　{v.type}</button>)}</div>
          {!filtered.length && <div className="empty">車両未選択</div>}
          <button onClick={() => setTab("ocr")}>次へ：伝票OCR →</button>
        </section>
      )}

      {tab === "customerVehicle" && (
        <section className="card">
          <h1>顧客・車両管理</h1>
          <p>顧客と車両を登録し、車両を顧客に紐付けます。登録番号の下4桁でも検索できます。</p>
          <div className="manage-grid">
            <div className="subcard">
              <h2>顧客登録</h2>
              <select value={customer.type} onChange={(e) => setCustomer({ ...customer, type: e.target.value as Customer["type"] })}>
                <option value="individual">個人</option><option value="company">法人</option>
              </select>
              <input placeholder="顧客名" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              <input placeholder="会社名（法人の場合）" value={customer.companyName} onChange={(e) => setCustomer({ ...customer, companyName: e.target.value })} />
              <input inputMode="tel" placeholder="電話番号" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
              <input type="email" placeholder="メールアドレス" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
              <input inputMode="numeric" placeholder="郵便番号" value={customer.postalCode} onChange={(e) => setCustomer({ ...customer, postalCode: e.target.value })} />
              <input placeholder="住所" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
              <textarea placeholder="備考" value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
              <div className="actions"><button className="primary" onClick={saveCustomer}>顧客を保存</button><button onClick={() => setCustomer({ ...emptyCustomer })}>新規</button></div>
              <input placeholder="顧客名・会社名・電話番号で検索" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
              <div className="list">{customerFiltered.map((c) => <button className="row" key={c.id} onClick={() => setCustomer(c)}>{c.companyName || c.name}　{c.phone}</button>)}</div>
            </div>

            <div className="subcard">
              <h2>車両登録</h2>
              <input placeholder="車体番号" value={vehicle.number} onChange={(e) => setVehicle({ ...vehicle, number: e.target.value })} />
              <input placeholder="登録番号（ナンバー）" value={vehicle.registration} onChange={(e) => setVehicle({ ...vehicle, registration: e.target.value, last4: e.target.value.replace(/\D/g, "").slice(-4) })} />
              <input inputMode="numeric" maxLength={4} placeholder="登録番号 下4桁" value={vehicle.last4} onChange={(e) => setVehicle({ ...vehicle, last4: e.target.value.replace(/\D/g, "").slice(-4) })} />
              <input placeholder="車台番号" value={vehicle.chassis} onChange={(e) => setVehicle({ ...vehicle, chassis: e.target.value })} />
              <input placeholder="型式" value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} />
              <select value={vehicle.type} onChange={(e) => setVehicle({ ...vehicle, type: e.target.value as Vehicle["type"] })}>
                <option>EV</option><option>ガソリン</option><option>HV</option><option>その他</option>
              </select>
              <input placeholder="初度登録" value={vehicle.firstRegistration} onChange={(e) => setVehicle({ ...vehicle, firstRegistration: e.target.value })} />
              <input inputMode="numeric" placeholder="車両重量 kg" value={vehicle.weight} onChange={(e) => setVehicle({ ...vehicle, weight: e.target.value })} />
              <select value={vehicle.customerId} onChange={(e) => setVehicle({ ...vehicle, customerId: e.target.value })}>
                <option value="">顧客を選択</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name}</option>)}
              </select>
              <div className="actions"><button className="primary" onClick={saveVehicle}>車両を保存</button><button onClick={() => setVehicle({ ...emptyVehicle })}>新規</button></div>
              <input inputMode="numeric" maxLength={4} placeholder="登録番号下4桁で検索" value={registrationSearch} onChange={(e) => setRegistrationSearch(e.target.value.replace(/\D/g, "").slice(-4))} />
              <div className="list">{registrationFiltered.map((v) => {
                const c = customers.find((x) => x.id === v.customerId);
                return <button className="row" key={v.number} onClick={() => setVehicle(v)}>{v.registration || v.number}　{v.model}　{c?.companyName || c?.name || "顧客未登録"}</button>;
              })}</div>
            </div>
          </div>
        </section>
      )}

      {tab === "ocr" && (
        <section className="card">
          <h1>部品伝票OCR</h1>
          <p>伝票を自動で切り出し・高コントラスト化してから、日本語＋英数字で2回読み取ります。1回の撮影から複数部品を候補抽出します。</p>
          <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && doOCR(e.target.files[0])} />
          <button className="primary big" disabled={ocrBusy} onClick={() => fileRef.current?.click()}>{ocrBusy ? `OCR中 ${progress}%` : "📷 部品伝票を撮影・読み込む"}</button>
          <textarea value={ocrText} onChange={(e) => setOcrText(e.target.value)} placeholder="OCRの生テキスト" />
          <div className="actions">
            <button onClick={() => setParts((p) => [...parseOCR(ocrText), ...p])}>OCR結果から追加</button>
            <button onClick={() => setParts((p) => [...p, { id: uid(), name: "", qty: "1", retail: "", cost: "" }])}>＋手入力</button>
          </div>
          <h2>抽出データ</h2>
          <div className="table"><table><thead><tr><th>部品名称</th><th>個数</th><th>定価</th><th>仕入れ</th><th></th></tr></thead><tbody>
            {parts.map((p) => <tr key={p.id}>
              <td><input value={p.name} onChange={(e) => updatePart(p.id, "name", e.target.value)} /></td>
              <td><input inputMode="numeric" value={p.qty} onChange={(e) => updatePart(p.id, "qty", e.target.value)} /></td>
              <td><input inputMode="decimal" value={p.retail} onChange={(e) => updatePart(p.id, "retail", e.target.value)} /></td>
              <td><input inputMode="decimal" value={p.cost} onChange={(e) => updatePart(p.id, "cost", e.target.value)} /></td>
              <td><button className="danger" onClick={() => setParts((x) => x.filter((y) => y.id !== p.id))}>削除</button></td>
            </tr>)}
          </tbody></table></div>
          <div className="actions"><button onClick={copyTSV}>📋 Excelへコピー</button><button onClick={csv}>CSV保存</button><button className="primary" onClick={() => setTab("print")}>印刷画面へ →</button></div>
        </section>
      )}

      {tab === "data" && (
        <section className="card">
          <h1>保存データ</h1>
          <p>部品データはブラウザ内に保存されます。Excelへはタブ区切りでそのまま貼り付けできます。</p>
          <div className="stats">部品：<b>{parts.length}</b>件　車両：<b>{vehicles.length}</b>件</div>
          <div className="actions"><button onClick={copyTSV}>📋 Excelへコピー</button><button onClick={csv}>CSV保存</button><button onClick={() => setParts([])}>部品データ全消去</button></div>
        </section>
      )}

      {tab === "print" && (
        <section className="card">
          <div className="noPrint">
            <h1>指定用紙へ印刷</h1>
            <p>部品出庫伝票の空欄へ、部品名称・個数・定価・仕入れだけを重ね刷りします。</p>
            <label>印刷件数 <input type="number" min="1" max={Math.max(1, parts.length)} value={printCount} onChange={(e) => setPrintCount(Number(e.target.value))} /></label>
            <div className="actions"><button className="primary" onClick={() => window.print()}>🖨 印刷する</button><button onClick={() => setTab("settings")}>印刷位置を調整</button></div>
          </div>
          <div className="sheet">{parts.slice(0, printCount).map((p, i) => <div key={p.id}>{(["name", "qty", "retail", "cost"] as const).map((f) => {
            const b = template.fields[f];
            return <div key={f} className={"overlay " + (f === "name" ? "name" : "")} style={{ left: `${b.x}mm`, top: `${b.y + i * 7}mm`, width: `${b.w}mm`, height: `${b.h}mm` }}>{f === "name" ? p.name : f === "qty" ? p.qty : f === "retail" ? p.retail : p.cost}</div>;
          })}</div>)}</div>
        </section>
      )}

      {tab === "settings" && (
        <section className="card">
          <h1>印刷位置設定</h1>
          <p>実物の用紙写真をガイドとして読み込み、4項目のX/Y/W/Hをmmで調整します。</p>
          <label className="file">📷 用紙写真を読み込む<input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && importGuide(e.target.files[0])} /></label>
          <div className="positions">{(["name", "qty", "retail", "cost"] as const).map((f) => <div className="pos" key={f}>
            <h3>{f === "name" ? "部品名称" : f === "qty" ? "個数" : f === "retail" ? "定価" : "仕入れ"}</h3>
            {(["x", "y", "w", "h"] as const).map((k) => <label key={k}>{k.toUpperCase()}<input type="number" step=".5" value={template.fields[f][k]} onChange={(e) => setBox(f, k, e.target.value)} /></label>)}
          </div>)}</div>
          <label>位置確認する部品<select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">選択</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name || "名称未入力"}</option>)}</select></label>
          <div className="sheet preview">
            {guide ? <img src={guide} alt="用紙ガイド" /> : <div className="placeholder">A4用紙ガイド<br />用紙写真を読み込んでください</div>}
            {active && <div className="overlay active" style={{ left: `${template.fields.name.x}mm`, top: `${template.fields.name.y}mm`, width: `${template.fields.name.w}mm` }}>{active.name}</div>}
          </div>
          <button onClick={() => setTemplate(initialTemplate)}>初期位置に戻す</button>
        </section>
      )}

      <footer>icb / 部品伝票OCR・印刷</footer>
    </main>
  );
}
