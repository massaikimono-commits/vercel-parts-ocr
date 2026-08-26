"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const PASS_THROUGH = "pdfNativePassThrough";

const LABELS = {
  recordDate: ["記録年月日"],
  documentNumber: ["記録事項番号"],
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

function compact(value) {
  return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
}

function pick(text, values) {
  const t = compact(text);
  return values.find((value) => t.includes(compact(value))) || "";
}

function jpMonth(text) {
  const t = norm(text);
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function jpDate(text) {
  const t = norm(text);
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function registration(text) {
  const t = norm(text);
  const m = t.match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  if (!m) return "";
  return `${m[1]} ${m[2].replace(/\D/g, "")} ${m[3]} ${m[4].replace(/\D/g, "")}`;
}

function chassis(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "");
  const matches = t.match(/[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9O]{4,12}/g) || [];
  return matches
    .map((value) => {
      const [left, right] = value.split("-");
      return `${left}-${right.replace(/O/g, "0")}`;
    })
    .sort((a, b) => b.length - a.length)[0] || "";
}

function model(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "");
  const matches = t.match(/(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14}/g) || [];
  return matches
    .filter((value) => !/^[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9]{4,12}$/.test(value))
    .sort((a, b) => b.length - a.length)[0] || "";
}

function engineModel(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "");
  const matches = t.match(/[A-Z0-9]{2,8}-[A-Z0-9]{2,10}/g) || [];
  return matches.find((value) => /[A-Z]/.test(value) && /\d/.test(value) && !/^\d[A-Z]{1,3}-[A-Z0-9]{4,}$/.test(value)) || "";
}

function integer(text, min, max) {
  const values = norm(text).replace(/,/g, "").match(/\d{1,6}/g) || [];
  for (const value of values) {
    const n = Number(value);
    if (n >= min && n <= max) return String(n);
  }
  return "";
}

function intOrDash(text, min, max) {
  return integer(text, min, max) || (/^-+$/.test(norm(text)) || /(^|\s)-($|\s)/.test(norm(text)) ? "-" : "");
}

function freeText(text) {
  const cleaned = norm(text)
    .replace(/\[[0-9\s_-]+\]/g, "")
    .replace(/［[0-9\s_-]+］/g, "")
    .replace(/^[\s:：|/\\-]+|[\s:：|/\\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 100) return "";
  if (!/[一-龠ぁ-んァ-ヶA-Za-z0-9＊*]/.test(cleaned)) return "";
  return cleaned;
}

function outputValue(text) {
  const m = norm(text).match(/\d+(?:\.\d+)?\s*(?:L|l|kW|KW|kw)?/);
  return m ? m[0].replace(/\s+/g, "") : "";
}

function tokenFromItem(item, pageWidth, pageHeight) {
  const text = norm(item?.str || "");
  if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(tr[4] || 0) / Math.max(1, pageWidth);
  const baseline = Number(tr[5] || 0) / Math.max(1, pageHeight);
  const h = Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, pageHeight);
  const w = Math.max(Number(item?.width || 0), 1) / Math.max(1, pageWidth);
  return { text, x, y: 1 - baseline, w, h };
}

function buildLines(tokens) {
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const token of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= Math.max(0.0045, token.h * 0.7));
    if (!line) {
      line = { y: token.y, tokens: [] };
      lines.push(line);
    }
    line.tokens.push(token);
    line.y = line.tokens.reduce((sum, value) => sum + value.y, 0) / line.tokens.length;
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = line.tokens.map((token) => token.text).join(" ");
  }
  return lines.sort((a, b) => a.y - b.y);
}

function findAnchor(lines, labels) {
  for (const label of labels || []) {
    const wanted = compact(label);
    for (const line of lines) {
      for (let start = 0; start < line.tokens.length; start += 1) {
        let joined = "";
        let end = start;
        for (; end < Math.min(line.tokens.length, start + 12); end += 1) {
          joined += compact(line.tokens[end].text);
          if (joined.includes(wanted)) {
            const slice = line.tokens.slice(start, end + 1);
            const x = Math.min(...slice.map((token) => token.x));
            const right = Math.max(...slice.map((token) => token.x + token.w));
            const h = Math.max(...slice.map((token) => token.h));
            return { line, x, right, y: line.y, h };
          }
          if (joined.length > wanted.length + 24) break;
        }
      }
    }
  }
  return null;
}

function textBelow(lines, anchor, xPad = 0.035, maxDy = 0.055) {
  if (!anchor) return "";
  const left = Math.max(0, anchor.x - xPad);
  const right = Math.min(1, anchor.right + xPad);
  const candidates = [];
  for (const line of lines) {
    const dy = line.y - anchor.y;
    if (dy <= 0.002 || dy > maxDy) continue;
    for (const token of line.tokens) {
      const center = token.x + token.w / 2;
      if (center >= left && center <= right) candidates.push({ ...token, dy });
    }
  }
  return candidates.sort((a, b) => a.dy - b.dy || a.x - b.x).map((token) => token.text).join(" ");
}

function textRight(anchor, span = 0.72) {
  if (!anchor) return "";
  const values = anchor.line.tokens.filter((token) => token.x >= anchor.right - 0.002 && token.x <= Math.min(1, anchor.right + span));
  return values.map((token) => token.text).join(" ");
}

function anchored(lines, labels, parser, options = {}) {
  const anchor = findAnchor(lines, labels);
  if (!anchor) return "";
  const rightFirst = options.mode === "right";
  const rightText = textRight(anchor, options.rightSpan ?? 0.72);
  const belowText = textBelow(lines, anchor, options.xPad ?? 0.035, options.maxDy ?? 0.055);
  const first = rightFirst ? parser(rightText) : parser(belowText);
  if (first) return first;
  return rightFirst ? parser(belowText) : parser(rightText);
}

function parseNative(tokens) {
  const lines = buildLines(tokens);
  const allText = lines.map((line) => line.text).join("\n");
  const patch = {};
  const put = (key, value) => { if (value) patch[key] = value; };

  put("registrationNumber", registration(allText));
  put("chassisNumber", chassis(allText));
  put("model", anchored(lines, LABELS.model, model, { xPad: 0.07, maxDy: 0.05 }) || model(allText));
  put("engineModel", anchored(lines, LABELS.engineModel, engineModel, { xPad: 0.055, maxDy: 0.05 }));
  put("vehicleName", anchored(lines, LABELS.vehicleName, (s) => pick(s, MAKERS), { xPad: 0.055 }) || pick(allText, MAKERS));

  put("registrationDate", anchored(lines, LABELS.registrationDate, jpDate, { xPad: 0.06 }));
  put("firstRegistration", anchored(lines, LABELS.firstRegistration, jpMonth, { xPad: 0.055 }));
  put("inspectionExpiry", anchored(lines, LABELS.inspectionExpiry, jpDate, { mode: "right", rightSpan: 0.34, maxDy: 0.045 }));
  put("recordDate", anchored(lines, LABELS.recordDate, jpDate, { mode: "right", rightSpan: 0.24, maxDy: 0.035 }));
  put("documentNumber", anchored(lines, LABELS.documentNumber, (s) => (norm(s).replace(/\D/g, "").match(/\d{8,14}/) || [""])[0], { mode: "right", rightSpan: 0.24 }));

  put("userName", anchored(lines, LABELS.userName, freeText, { mode: "right", rightSpan: 0.78, maxDy: 0.035 }));
  put("userAddress", anchored(lines, LABELS.userAddress, freeText, { mode: "right", rightSpan: 0.80, maxDy: 0.035 }));
  put("baseLocation", anchored(lines, LABELS.baseLocation, (s) => /[＊*]{2,}/.test(s) ? "***" : freeText(s), { mode: "right", rightSpan: 0.80, maxDy: 0.035 }));

  put("vehicleClass", anchored(lines, LABELS.vehicleClass, (s) => pick(s, ["普通", "小型", "軽自動車", "大型特殊"]), { xPad: 0.045 }));
  put("purpose", anchored(lines, LABELS.purpose, (s) => pick(s, ["乗用", "貨物", "乗合", "特種"]), { xPad: 0.045 }));
  put("privateBusiness", anchored(lines, LABELS.privateBusiness, (s) => pick(s, ["自家用", "事業用"]), { xPad: 0.055 }));
  put("bodyShape", anchored(lines, LABELS.bodyShape, (s) => pick(s, BODY_TYPES), { xPad: 0.05 }));

  put("seatingCapacity", anchored(lines, LABELS.seatingCapacity, (s) => integer(s, 1, 99), { xPad: 0.03 }));
  put("maxPayloadKg", anchored(lines, LABELS.maxPayloadKg, (s) => intOrDash(s, 1, 99999), { xPad: 0.035 }));
  put("vehicleWeightKg", anchored(lines, LABELS.vehicleWeightKg, (s) => integer(s, 100, 99999), { xPad: 0.035 }));
  put("grossVehicleWeightKg", anchored(lines, LABELS.grossVehicleWeightKg, (s) => integer(s, 100, 99999), { xPad: 0.035 }));
  put("lengthCm", anchored(lines, LABELS.lengthCm, (s) => integer(s, 50, 3000), { xPad: 0.025 }));
  put("widthCm", anchored(lines, LABELS.widthCm, (s) => integer(s, 50, 1000), { xPad: 0.025 }));
  put("heightCm", anchored(lines, LABELS.heightCm, (s) => integer(s, 50, 1000), { xPad: 0.025 }));

  put("frontFrontAxleWeightKg", anchored(lines, LABELS.frontFrontAxleWeightKg, (s) => intOrDash(s, 1, 30000), { xPad: 0.035 }));
  put("frontRearAxleWeightKg", anchored(lines, LABELS.frontRearAxleWeightKg, (s) => intOrDash(s, 1, 30000), { xPad: 0.035 }));
  put("rearFrontAxleWeightKg", anchored(lines, LABELS.rearFrontAxleWeightKg, (s) => intOrDash(s, 1, 30000), { xPad: 0.035 }));
  put("rearRearAxleWeightKg", anchored(lines, LABELS.rearRearAxleWeightKg, (s) => intOrDash(s, 1, 30000), { xPad: 0.035 }));

  put("displacementOrRatedOutput", anchored(lines, LABELS.displacementOrRatedOutput, outputValue, { xPad: 0.055 }));
  put("fuel", anchored(lines, LABELS.fuel, (s) => pick(s, ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"]), { xPad: 0.045 }) || pick(allText, ["軽油", "ガソリン", "揮発油", "LPG", "CNG", "水素"]));
  put("modelDesignationNumber", anchored(lines, LABELS.modelDesignationNumber, (s) => integer(s, 1, 999999), { xPad: 0.04 }));
  put("classificationNumber", anchored(lines, LABELS.classificationNumber, (s) => {
    const m = norm(s).match(/\b\d{4}\b/);
    return m ? m[0] : integer(s, 1, 999999);
  }, { xPad: 0.04 }));

  const core = ["registrationNumber", "chassisNumber", "model", "vehicleName", "engineModel", "vehicleWeightKg", "grossVehicleWeightKg", "lengthCm", "widthCm", "heightCm", "userName", "userAddress", "firstRegistration", "registrationDate", "inspectionExpiry"];
  const coreCount = core.filter((key) => patch[key]).length;
  const totalCount = Object.keys(patch).length;
  const confident = Boolean((patch.registrationNumber || patch.chassisNumber) && coreCount >= 7 && totalCount >= 10);
  return { patch, coreCount, totalCount, confident, lines, allText };
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function pageTokens(page) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return (content.items || []).map((item) => tokenFromItem(item, viewport.width, viewport.height)).filter(Boolean);
}

async function choosePage(pdf) {
  let best = { pageNumber: 1, score: -1, tokens: [] };
  const max = Math.min(pdf.numPages || 1, 8);
  for (let pageNumber = 1; pageNumber <= max; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const tokens = await pageTokens(page).catch(() => []);
    const text = compact(tokens.map((token) => token.text).join(" "));
    let score = 0;
    if (text.includes("自動車検査証")) score += 5;
    if (text.includes("車両情報")) score += 4;
    if (text.includes("自動車登録番号") || text.includes("車両番号")) score += 3;
    if (text.includes("車台番号")) score += 3;
    if (text.includes("初度登録")) score += 2;
    if (score > best.score) best = { pageNumber, score, tokens };
  }
  return best;
}

async function renderPage(pdf, pageNumber, targetWidth = 1800) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(4, targetWidth / Math.max(1, base.width)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function cropLower(source) {
  const y = Math.round(source.height * 0.50);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height - y;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, y, source.width, source.height - y, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function hasQr(canvas) {
  try {
    const browser = await import("@zxing/browser");
    const lib = await import("@zxing/library");
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const reader = new browser.BrowserQRCodeReader(hints);
    for (const source of [canvas, cropLower(canvas)]) {
      try {
        const result = await reader.decodeFromCanvas(source);
        if (result?.getText?.() || result?.text || result?.getRawBytes?.()?.length) return true;
      } catch {}
    }
  } catch {}
  return false;
}

function vehicleCard() {
  return Array.from(document.querySelectorAll("section.card")).find((section) => section.querySelector("h2")?.textContent?.includes("車検証から読み取る")) || null;
}

function statusBox() {
  const card = vehicleCard();
  if (!card) return null;
  let box = card.querySelector("[data-pdf-native-status]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.pdfNativeStatus = "1";
    box.style.marginTop = "12px";
    box.style.padding = "14px";
    box.style.borderRadius = "14px";
    box.style.border = "1px solid #a8ddbf";
    box.style.background = "#effaf4";
    box.style.color = "#174c2e";
    box.style.fontWeight = "800";
    card.querySelector(".actions")?.insertAdjacentElement("afterend", box);
  }
  return box;
}

function showStatus(message, error = false) {
  const box = statusBox();
  if (!box) return;
  box.textContent = message;
  box.style.background = error ? "#fff1f1" : "#effaf4";
  box.style.borderColor = error ? "#efb7b7" : "#a8ddbf";
  box.style.color = error ? "#922" : "#174c2e";
}

function showDebug(result) {
  const card = vehicleCard();
  if (!card) return;
  let details = card.querySelector("[data-pdf-native-debug]");
  if (!details) {
    details = document.createElement("details");
    details.dataset.pdfNativeDebug = "1";
    details.style.marginTop = "12px";
    details.innerHTML = "<summary style='font-weight:800;cursor:pointer'>PDFネイティブ読み取り詳細（確認用）</summary><pre style='white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px'></pre>";
    card.appendChild(details);
  }
  const pre = details.querySelector("pre");
  if (!pre) return;
  const rows = Object.entries(result.patch).map(([key, value]) => `${key}: ${value}`);
  pre.textContent = [`PDF text-layer tokens: ${result.tokens || 0}`, `採用: ${result.totalCount}項目 / core ${result.coreCount}項目`, "", ...rows, "", "--- PDF text rows ---", ...result.lines.map((line) => line.text)].join("\n");
}

function showPreview(canvas) {
  const card = vehicleCard();
  if (!card) return;
  let img = card.querySelector("img[data-pdf-native-preview]");
  if (!img) {
    img = document.createElement("img");
    img.dataset.pdfNativePreview = "1";
    img.alt = "PDF車検証プレビュー";
    img.style.display = "block";
    img.style.width = "100%";
    img.style.maxHeight = "560px";
    img.style.objectFit = "contain";
    img.style.borderRadius = "14px";
    img.style.marginTop = "14px";
    img.style.background = "#f4f6fa";
    card.appendChild(img);
  }
  img.src = canvas.toDataURL("image/jpeg", 0.88);
}

function resetFormBeforeNativeApply() {
  const buttons = Array.from(document.querySelectorAll("button"));
  const button = buttons.find((candidate) => (candidate.textContent || "").includes("＋新規車両"));
  button?.click();
}

function dispatchPatch(patch) {
  window[PDF_PRIORITY_KEY] = patch;
  window[QR_PRIORITY_KEY] = null;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
}

function passToExistingPipeline(input) {
  input.dataset[PASS_THROUGH] = "1";
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function enhanceInputs() {
  if (!location.pathname.startsWith("/vehicle-workflow")) return;
  const card = vehicleCard();
  if (!card) return;
  card.querySelectorAll('input[type="file"]').forEach((input) => {
    if (!input.hasAttribute("capture")) input.setAttribute("accept", "image/*,application/pdf,.pdf");
  });
  const buttons = Array.from(card.querySelectorAll(".actions button"));
  if (buttons[1] && !buttons[1].textContent?.includes("PDF")) buttons[1].textContent = "📄 PDF / 写真から読み取る";
}

export default function CertificatePdfNativeReader() {
  useLayoutEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    let tries = 0;
    const timer = window.setInterval(() => {
      enhanceInputs();
      tries += 1;
      if (tries >= 20) window.clearInterval(timer);
    }, 200);
    enhanceInputs();

    const onChange = async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (input.dataset[PASS_THROUGH] === "1") {
        delete input.dataset[PASS_THROUGH];
        return;
      }
      const file = input.files?.[0];
      if (!file) return;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (!isPdf) {
        window[PDF_PRIORITY_KEY] = null;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      showStatus("PDFネイティブ解析中… 文字レイヤーを直接読んでいます。");

      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        try {
          const chosen = await choosePage(pdf);
          const page = await pdf.getPage(chosen.pageNumber);
          const tokens = chosen.tokens.length ? chosen.tokens : await pageTokens(page);
          const parsed = parseNative(tokens);
          const canvas = await renderPage(pdf, chosen.pageNumber, 1800);
          const qrFound = await hasQr(canvas);
          showPreview(canvas);
          showDebug({ ...parsed, tokens: tokens.length });

          if (dead) return;
          if (qrFound) {
            showStatus(`PDF ${chosen.pageNumber}ページ目: QRを検出しました。既存のQR優先ルートへ引き継ぎます。`);
            passToExistingPipeline(input);
            return;
          }

          if (!parsed.confident) {
            showStatus(`PDF文字レイヤーは取得できましたが候補が${parsed.totalCount}項目のため、OCRフォールバックへ引き継ぎます。`);
            passToExistingPipeline(input);
            return;
          }

          resetFormBeforeNativeApply();
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (dead) return;
          dispatchPatch(parsed.patch);
          showStatus(`PDFネイティブ v1 完了: OCR 0pass / ${parsed.totalCount}項目をPDF文字から直接取得しました。QRなしでもOCRせず採用しています。`);
          input.value = "";
        } finally {
          await pdf.destroy?.().catch?.(() => {});
        }
      } catch (error) {
        console.error(error);
        showStatus(`PDFネイティブ解析エラー: ${error?.message || error}。OCRフォールバックへ切り替えます。`, true);
        passToExistingPipeline(input);
      }
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
