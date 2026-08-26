"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const OWN_PASS = "pdfNativeV2PassThrough";
const V1_PASS = "pdfNativePassThrough";

const LABELS = {
  registrationNumber: ["自動車登録番号又は車両番号", "自動車登録番号", "車両番号"],
  chassisNumber: ["車台番号"],
  registrationDate: ["登録年月日/交付年月日", "登録年月日／交付年月日", "登録年月日", "交付年月日"],
  firstRegistration: ["初度登録年月", "初度登録"],
  inspectionExpiry: ["有効期間の満了する日", "有効期間満了日"],
  userName: ["使用者の氏名又は名称"],
  userAddress: ["使用者の住所"],
  baseLocation: ["使用の本拠の位置"],
  vehicleName: ["車名"],
  model: ["型式"],
  engineModel: ["原動機の型式"],
  vehicleClass: ["自動車の種別"],
  purpose: ["用途"],
  privateBusiness: ["自家用・事業用の別", "自家用・事業用"],
  bodyShape: ["車体の形状"],
  seatingCapacity: ["乗車定員"],
  maxPayloadKg: ["最大積載量"],
  vehicleWeightKg: ["車両重量"],
  grossVehicleWeightKg: ["車両総重量"],
  lengthCm: ["長さ"],
  widthCm: ["幅"],
  heightCm: ["高さ"],
  frontFrontAxleWeightKg: ["前前軸重"],
  frontRearAxleWeightKg: ["前後軸重"],
  rearFrontAxleWeightKg: ["後前軸重"],
  rearRearAxleWeightKg: ["後後軸重"],
  displacementOrRatedOutput: ["総排気量又は定格出力", "総排気量"],
  fuel: ["燃料の種類", "燃料"],
  modelDesignationNumber: ["型式指定番号"],
  classificationNumber: ["類別区分番号"],
};

const MAKERS = ["トヨタ", "レクサス", "日産", "ホンダ", "三菱", "マツダ", "スバル", "スズキ", "ダイハツ", "いすゞ", "日野", "UDトラックス", "メルセデス・ベンツ", "フォルクスワーゲン", "アウディ", "BMW", "ボルボ"];
const BODY_TYPES = ["キャブオーバ", "ステーションワゴン", "ボンネット", "ピックアップ", "トラック", "ダンプ", "セダン", "箱型", "バン", "バス", "幌型"];

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
function compact(value) { return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, ""); }
function pick(text, values) { const t = compact(text); return values.find((v) => t.includes(compact(v))) || ""; }
function digits(text) { return norm(text).replace(/\D/g, ""); }
function jpMonth(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return ""; const mo = Number(m[3]); if (mo < 1 || mo > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月`;
}
function jpDate(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return ""; const mo = Number(m[3]), d = Number(m[4]); if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月${d}日`;
}
function registration(text) {
  const m = norm(text).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  return m ? `${m[1]} ${digits(m[2])} ${m[3]} ${digits(m[4])}` : "";
}
function chassis(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "");
  const a = t.match(/[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9O]{4,12}/g) || [];
  return a.map((x) => { const [l, r] = x.split("-"); return `${l}-${r.replace(/O/g, "0")}`; }).sort((a, b) => b.length - a.length)[0] || "";
}
function model(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "");
  const a = t.match(/(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14}/g) || [];
  return a.filter((x) => !/^[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9]{4,12}$/.test(x)).sort((a, b) => b.length - a.length)[0] || "";
}
function engine(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "");
  const a = t.match(/[A-Z0-9]{2,8}-[A-Z0-9]{2,10}/g) || [];
  return a.find((x) => /[A-Z]/.test(x) && /\d/.test(x) && !/^\d[A-Z]{1,3}-[A-Z0-9]{4,}$/.test(x)) || "";
}
function integer(text, min, max) {
  const a = norm(text).replace(/,/g, "").match(/\d{1,6}/g) || [];
  for (const x of a) { const n = Number(x); if (n >= min && n <= max) return String(n); }
  return "";
}
function intOrDash(text, min, max) {
  const n = integer(text, min, max); if (n) return n;
  return /(^|\s)-+\s*(?:kg|KG)?($|\s)/.test(norm(text)) || /^-+$/.test(norm(text)) ? "-" : "";
}
function code(text, maxLen = 6) {
  const a = norm(text).replace(/,/g, "").match(new RegExp(`\\b\\d{1,${maxLen}}\\b`, "g")) || [];
  return a[0] || "";
}
function outputValue(text) {
  const m = norm(text).match(/\d+(?:\.\d+)?\s*(?:L|l|kW|KW|kw)?/);
  return m ? m[0].replace(/\s+/g, "") : "";
}
function freeText(text) {
  const t = norm(text)
    .replace(/\[[0-9\s_-]+\]/g, "")
    .replace(/［[0-9\s_-]+］/g, "")
    .replace(/^[\s:：|/\\-]+|[\s:：|/\\-]+$/g, "")
    .replace(/\s+/g, " ").trim();
  if (!t || t.length > 110 || !/[一-龠ぁ-んァ-ヶA-Za-z0-9＊*]/.test(t)) return "";
  return t;
}

function tokenFromItem(item, pageWidth, pageHeight) {
  const text = norm(item?.str || ""); if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(tr[4] || 0) / Math.max(1, pageWidth);
  const baseline = Number(tr[5] || 0) / Math.max(1, pageHeight);
  const h = Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, pageHeight);
  const w = Math.max(Number(item?.width || 0), 1) / Math.max(1, pageWidth);
  return { text, x, y: 1 - baseline, w, h };
}
function buildLines(tokens) {
  const out = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = out.find((v) => Math.abs(v.y - token.y) <= Math.max(0.0045, token.h * 0.72));
    if (!line) { line = { y: token.y, tokens: [] }; out.push(line); }
    line.tokens.push(token); line.y = line.tokens.reduce((s, v) => s + v.y, 0) / line.tokens.length;
  }
  for (const line of out) { line.tokens.sort((a, b) => a.x - b.x); line.text = line.tokens.map((v) => v.text).join(" "); }
  return out.sort((a, b) => a.y - b.y);
}
function findAnchor(lines, labels) {
  for (const label of labels || []) {
    const wanted = compact(label);
    for (const line of lines) {
      for (let s = 0; s < line.tokens.length; s += 1) {
        let joined = "";
        for (let e = s; e < Math.min(line.tokens.length, s + 16); e += 1) {
          joined += compact(line.tokens[e].text);
          if (joined.includes(wanted)) {
            const slice = line.tokens.slice(s, e + 1);
            const x = Math.min(...slice.map((v) => v.x));
            const right = Math.max(...slice.map((v) => v.x + v.w));
            return { key: "", x, right, y: line.y, h: Math.max(...slice.map((v) => v.h)), line };
          }
          if (joined.length > wanted.length + 30) break;
        }
      }
    }
  }
  return null;
}
function rightOf(lines, labels, parser, span = 0.78) {
  const a = findAnchor(lines, labels); if (!a) return "";
  const same = a.line.tokens.filter((v) => v.x >= a.right - 0.002 && v.x <= Math.min(1, a.right + span)).map((v) => v.text).join(" ");
  return parser(same);
}
function rowValue(lines, specs, targetKey, parser, maxDy = 0.075) {
  const anchors = specs.map(([key, labels]) => { const a = findAnchor(lines, labels); return a ? { ...a, key } : null; }).filter(Boolean).sort((a, b) => a.x - b.x);
  const target = anchors.find((a) => a.key === targetKey); if (!target) return "";
  const i = anchors.indexOf(target);
  const center = (a) => a.x + Math.max(0.001, a.right - a.x) / 2;
  const left = i > 0 ? (center(anchors[i - 1]) + center(target)) / 2 : Math.max(0, target.x - 0.035);
  const right = i < anchors.length - 1 ? (center(target) + center(anchors[i + 1])) / 2 : Math.min(1, target.right + 0.16);
  const values = lines.filter((line) => line.y > target.y + 0.003 && line.y - target.y <= maxDy).sort((a, b) => a.y - b.y);
  for (const line of values) {
    const text = line.tokens.filter((v) => { const c = v.x + v.w / 2; return c >= left && c < right; }).map((v) => v.text).join(" ");
    const parsed = parser(text); if (parsed) return parsed;
  }
  return "";
}

const TOP = [
  ["registrationNumber", LABELS.registrationNumber], ["registrationDate", LABELS.registrationDate], ["firstRegistration", LABELS.firstRegistration],
  ["vehicleClass", LABELS.vehicleClass], ["purpose", LABELS.purpose], ["privateBusiness", LABELS.privateBusiness], ["bodyShape", LABELS.bodyShape],
];
const NAME_WEIGHT = [
  ["vehicleName", LABELS.vehicleName], ["seatingCapacity", LABELS.seatingCapacity], ["maxPayloadKg", LABELS.maxPayloadKg],
  ["vehicleWeightKg", LABELS.vehicleWeightKg], ["grossVehicleWeightKg", LABELS.grossVehicleWeightKg],
];
const DIMENSIONS = [
  ["chassisNumber", LABELS.chassisNumber], ["lengthCm", LABELS.lengthCm], ["widthCm", LABELS.widthCm], ["heightCm", LABELS.heightCm],
  ["frontFrontAxleWeightKg", LABELS.frontFrontAxleWeightKg], ["frontRearAxleWeightKg", LABELS.frontRearAxleWeightKg],
  ["rearFrontAxleWeightKg", LABELS.rearFrontAxleWeightKg], ["rearRearAxleWeightKg", LABELS.rearRearAxleWeightKg],
];
const MODEL_ROW = [
  ["model", LABELS.model], ["engineModel", LABELS.engineModel], ["displacementOrRatedOutput", LABELS.displacementOrRatedOutput],
  ["fuel", LABELS.fuel], ["modelDesignationNumber", LABELS.modelDesignationNumber], ["classificationNumber", LABELS.classificationNumber],
];
const EXPIRY_ROW = [
  ["inspectionExpiry", LABELS.inspectionExpiry], ["inspectionPeriod", ["車検期間"]], ["mileage", ["走行距離"]], ["averageMileage", ["月平均走行距離"]],
];

function parseNativeV2(tokens) {
  const lines = buildLines(tokens); const allText = lines.map((v) => v.text).join("\n"); const patch = {};
  const put = (k, v) => { if (v !== "" && v != null) patch[k] = v; };

  put("registrationNumber", rowValue(lines, TOP, "registrationNumber", registration, 0.06) || registration(allText));
  put("registrationDate", rowValue(lines, TOP, "registrationDate", jpDate, 0.06));
  put("firstRegistration", rowValue(lines, TOP, "firstRegistration", jpMonth, 0.06));
  put("vehicleClass", rowValue(lines, TOP, "vehicleClass", (s) => pick(s, ["普通", "小型", "軽自動車", "大型特殊"]), 0.06));
  put("purpose", rowValue(lines, TOP, "purpose", (s) => pick(s, ["乗用", "貨物", "乗合", "特種"]), 0.06));
  put("privateBusiness", rowValue(lines, TOP, "privateBusiness", (s) => pick(s, ["自家用", "事業用"]), 0.06));
  put("bodyShape", rowValue(lines, TOP, "bodyShape", (s) => pick(s, BODY_TYPES), 0.06));

  put("vehicleName", rowValue(lines, NAME_WEIGHT, "vehicleName", (s) => pick(s, MAKERS), 0.075) || pick(allText, MAKERS));
  put("seatingCapacity", rowValue(lines, NAME_WEIGHT, "seatingCapacity", (s) => integer(s, 1, 99), 0.075));
  put("maxPayloadKg", rowValue(lines, NAME_WEIGHT, "maxPayloadKg", (s) => intOrDash(s, 1, 99999), 0.075));
  put("vehicleWeightKg", rowValue(lines, NAME_WEIGHT, "vehicleWeightKg", (s) => integer(s, 100, 99999), 0.075));
  put("grossVehicleWeightKg", rowValue(lines, NAME_WEIGHT, "grossVehicleWeightKg", (s) => integer(s, 100, 99999), 0.075));

  put("chassisNumber", rowValue(lines, DIMENSIONS, "chassisNumber", chassis, 0.07) || chassis(allText));
  put("lengthCm", rowValue(lines, DIMENSIONS, "lengthCm", (s) => integer(s, 50, 3000), 0.07));
  put("widthCm", rowValue(lines, DIMENSIONS, "widthCm", (s) => integer(s, 50, 1000), 0.07));
  put("heightCm", rowValue(lines, DIMENSIONS, "heightCm", (s) => integer(s, 50, 1000), 0.07));
  put("frontFrontAxleWeightKg", rowValue(lines, DIMENSIONS, "frontFrontAxleWeightKg", (s) => intOrDash(s, 1, 30000), 0.07));
  put("frontRearAxleWeightKg", rowValue(lines, DIMENSIONS, "frontRearAxleWeightKg", (s) => intOrDash(s, 1, 30000), 0.07));
  put("rearFrontAxleWeightKg", rowValue(lines, DIMENSIONS, "rearFrontAxleWeightKg", (s) => intOrDash(s, 1, 30000), 0.07));
  put("rearRearAxleWeightKg", rowValue(lines, DIMENSIONS, "rearRearAxleWeightKg", (s) => intOrDash(s, 1, 30000), 0.07));

  put("model", rowValue(lines, MODEL_ROW, "model", model, 0.07) || model(allText));
  put("engineModel", rowValue(lines, MODEL_ROW, "engineModel", engine, 0.07));
  put("displacementOrRatedOutput", rowValue(lines, MODEL_ROW, "displacementOrRatedOutput", outputValue, 0.07));
  put("fuel", rowValue(lines, MODEL_ROW, "fuel", (s) => pick(s, ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"]), 0.07));
  put("modelDesignationNumber", rowValue(lines, MODEL_ROW, "modelDesignationNumber", (s) => code(s, 6), 0.07));
  put("classificationNumber", rowValue(lines, MODEL_ROW, "classificationNumber", (s) => code(s, 6), 0.07));

  put("inspectionExpiry", rowValue(lines, EXPIRY_ROW, "inspectionExpiry", jpDate, 0.08));
  put("userName", rightOf(lines, LABELS.userName, freeText));
  put("userAddress", rightOf(lines, LABELS.userAddress, freeText));
  put("baseLocation", rightOf(lines, LABELS.baseLocation, (s) => /[＊*]{2,}/.test(s) ? "***" : freeText(s), 0.55));

  const core = ["registrationNumber", "chassisNumber", "model", "vehicleName", "vehicleWeightKg", "lengthCm", "widthCm", "heightCm", "fuel"];
  const coreCount = core.filter((k) => patch[k]).length;
  const totalCount = Object.keys(patch).length;
  return { patch, lines, allText, coreCount, totalCount, confident: Boolean(patch.registrationNumber && patch.chassisNumber && patch.model && coreCount >= 7 && totalCount >= 16) };
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
}
async function pageTokens(page) {
  const viewport = page.getViewport({ scale: 1 }); const content = await page.getTextContent();
  return content.items.map((item) => tokenFromItem(item, viewport.width, viewport.height)).filter(Boolean);
}
async function choosePage(pdf) {
  let best = { pageNumber: 1, tokens: [], score: -1 };
  for (let n = 1; n <= Math.min(pdf.numPages, 6); n += 1) {
    const page = await pdf.getPage(n); const tokens = await pageTokens(page); const text = tokens.map((v) => v.text).join(" ");
    const score = (compact(text).includes("車両情報") ? 8 : 0) + (compact(text).includes("自動車登録番号") ? 6 : 0) + (compact(text).includes("車台番号") ? 5 : 0) + (compact(text).includes("使用者の住所") ? 4 : 0) + Math.min(6, tokens.length / 80);
    if (score > best.score) best = { pageNumber: n, tokens, score };
  }
  return best;
}
async function renderPage(pdf, pageNumber, targetWidth = 1800) {
  const page = await pdf.getPage(pageNumber); const base = page.getViewport({ scale: 1 }); const scale = targetWidth / Math.max(1, base.width); const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas"); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height); const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise; return canvas;
}
function cropLower(source) {
  const y = Math.floor(source.height * 0.72); const c = document.createElement("canvas"); c.width = source.width; c.height = source.height - y; const x = c.getContext("2d"); x.drawImage(source, 0, y, source.width, source.height - y, 0, 0, c.width, c.height); return c;
}
async function hasQr(canvas) {
  try {
    const browser = await import("@zxing/browser"); const lib = await import("@zxing/library"); const hints = new Map(); hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]); hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const reader = new browser.BrowserQRCodeReader(hints);
    for (const source of [canvas, cropLower(canvas)]) { try { const r = await reader.decodeFromCanvas(source); if (r?.getText?.() || r?.text || r?.getRawBytes?.()?.length) return true; } catch {} }
  } catch {}
  return false;
}
function certificateCard() {
  return Array.from(document.querySelectorAll("section.card")).find((node) => (node.querySelector("h2")?.textContent || "").includes("車検証から")) || null;
}
function showStatus(text, ok = false) {
  const card = certificateCard(); if (!card) return;
  let box = card.querySelector("[data-pdf-native-v2-status]"); if (!box) { box = document.createElement("div"); box.dataset.pdfNativeV2Status = "1"; box.style.cssText = "margin-top:14px;padding:14px;border-radius:14px;font-weight:800;line-height:1.6;border:1px solid #b9d8c6;background:#effaf3;"; card.appendChild(box); }
  box.style.background = ok ? "#e9f8ef" : "#f3f7fc"; box.textContent = text;
}
function showPreview(canvas) {
  const card = certificateCard(); if (!card) return; let img = card.querySelector("[data-pdf-native-v2-preview]"); if (!img) { img = document.createElement("img"); img.dataset.pdfNativeV2Preview = "1"; img.style.cssText = "display:block;width:100%;max-height:560px;object-fit:contain;border-radius:14px;margin-top:14px;background:#f4f6fa;"; card.appendChild(img); }
  img.src = canvas.toDataURL("image/jpeg", 0.9);
}
function showDebug(parsed, tokenCount) {
  const card = certificateCard(); if (!card) return; let details = card.querySelector("[data-pdf-native-v2-debug]"); if (!details) { details = document.createElement("details"); details.dataset.pdfNativeV2Debug = "1"; details.style.cssText = "margin-top:14px;border:1px solid #cdd7e5;border-radius:12px;padding:12px;"; details.innerHTML = "<summary style='font-weight:800'>PDFネイティブ v2詳細（確認用）</summary><pre style='white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px'></pre>"; card.appendChild(details); }
  const pre = details.querySelector("pre"); if (pre) pre.textContent = [`文字トークン: ${tokenCount}`, `直接取得: ${parsed.totalCount}項目 / core ${parsed.coreCount}`, "", ...Object.entries(parsed.patch).map(([k, v]) => `${k}: ${v}`), "", "--- PDF文字列 ---", parsed.allText].join("\n");
}
function applyPatch(patch) {
  window[PDF_PRIORITY_KEY] = patch; window[QR_PRIORITY_KEY] = null; window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
}
function passToExisting(input) {
  input.dataset[OWN_PASS] = "1"; input.dataset[V1_PASS] = "1"; input.dispatchEvent(new Event("change", { bubbles: true }));
}
function enhanceInputs() {
  if (!location.pathname.startsWith("/vehicle-workflow")) return;
  document.querySelectorAll('input[type="file"]').forEach((input) => { const a = input.getAttribute("accept") || ""; if (!a.includes("application/pdf")) input.setAttribute("accept", [a, "application/pdf"].filter(Boolean).join(",")); });
}

export default function CertificatePdfNativeReaderV2() {
  useLayoutEffect(() => {
    let dead = false; enhanceInputs(); const timer = window.setInterval(enhanceInputs, 300);
    const onChange = async (event) => {
      const input = event.target; if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (input.dataset[OWN_PASS] === "1") { delete input.dataset[OWN_PASS]; return; }
      const file = input.files?.[0]; if (!file) return; const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""); if (!isPdf) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.(); showStatus("PDFネイティブ v2解析中… 表の列境界を直接読んでいます。");
      try {
        const pdfjs = await loadPdfJs(); const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        try {
          const chosen = await choosePage(pdf); const page = await pdf.getPage(chosen.pageNumber); const tokens = chosen.tokens.length ? chosen.tokens : await pageTokens(page); const parsed = parseNativeV2(tokens); const canvas = await renderPage(pdf, chosen.pageNumber, 1800); const qr = await hasQr(canvas); if (dead) return;
          showPreview(canvas); showDebug(parsed, tokens.length);
          if (qr) { showStatus(`PDF ${chosen.pageNumber}ページ目: QRあり。既存のQR優先ルートへ引き継ぎます。`); passToExisting(input); return; }
          if (!parsed.confident) { showStatus(`PDFネイティブ v2: 直接取得 ${parsed.totalCount}項目。確信度不足のため既存OCRへフォールバックします。`); passToExisting(input); return; }
          applyPatch(parsed.patch); showStatus(`PDFネイティブ v2 完了: OCR 0pass / ${parsed.totalCount}項目をPDF文字＋列位置から直接取得`, true); input.value = "";
        } finally { await pdf.destroy?.(); }
      } catch (e) { console.error("pdf native v2", e); showStatus("PDFネイティブ v2で直接解析できなかったため、既存OCRへ切り替えます。"); passToExisting(input); }
    };
    document.addEventListener("change", onChange, true);
    return () => { dead = true; window.clearInterval(timer); document.removeEventListener("change", onChange, true); };
  }, []);
  return null;
}
