"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";
import { normalizeJapanesePlateRegion } from "./lib/japanese-plate-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-targeted-cell-recovery-v13-debug";

const FIELD_LABELS = {
  recordDate: "記録年月日",
  documentNumber: "記録事項番号",
  registrationNumber: "自動車登録番号又は車両番号",
  chassisNumber: "車台番号",
  registrationDate: "登録年月日／交付年月日",
  firstRegistration: "初度登録年月",
  inspectionExpiry: "有効期間の満了する日",
  userName: "使用者の氏名又は名称",
  userAddress: "使用者の住所",
  baseLocation: "使用の本拠の位置",
  vehicleName: "車名",
  model: "型式",
  engineModel: "原動機の型式",
  vehicleClass: "自動車の種別",
  purpose: "用途",
  privateBusiness: "自家用・事業用の別",
  bodyShape: "車体の形状",
  seatingCapacity: "乗車定員",
  maxPayloadKg: "最大積載量 kg",
  vehicleWeightKg: "車両重量 kg",
  grossVehicleWeightKg: "車両総重量 kg",
  lengthCm: "長さ cm",
  widthCm: "幅 cm",
  heightCm: "高さ cm",
  frontFrontAxleWeightKg: "前前軸重 kg",
  frontRearAxleWeightKg: "前後軸重 kg",
  rearFrontAxleWeightKg: "後前軸重 kg",
  rearRearAxleWeightKg: "後後軸重 kg",
  displacementOrRatedOutput: "総排気量又は定格出力",
  fuel: "燃料の種類",
  modelDesignationNumber: "型式指定番号",
  classificationNumber: "類別区分番号",
};

// Standard Japanese vehicle-certificate value-cell positions, relative to the detected paper.
// These are deliberately small: QR handles structured fields first, and OCR touches only missing cells.
const REGIONS = {
  recordDate: [0.62, 0.078, 0.30, 0.055],
  documentNumber: [0.66, 0.122, 0.24, 0.050],
  registrationNumber: [0.16, 0.170, 0.48, 0.055],
  chassisNumber: [0.08, 0.200, 0.50, 0.055],
  registrationDate: [0.12, 0.232, 0.29, 0.055],
  firstRegistration: [0.35, 0.232, 0.24, 0.055],
  inspectionExpiry: [0.58, 0.232, 0.31, 0.055],
  userName: [0.13, 0.285, 0.53, 0.058],
  userAddress: [0.12, 0.323, 0.69, 0.060],
  baseLocation: [0.12, 0.360, 0.52, 0.058],
  vehicleName: [0.06, 0.402, 0.27, 0.052],
  model: [0.06, 0.430, 0.37, 0.058],
  engineModel: [0.43, 0.430, 0.27, 0.058],
  vehicleClass: [0.10, 0.460, 0.23, 0.052],
  purpose: [0.30, 0.460, 0.21, 0.052],
  privateBusiness: [0.53, 0.460, 0.25, 0.052],
  bodyShape: [0.10, 0.488, 0.23, 0.052],
  seatingCapacity: [0.51, 0.488, 0.15, 0.052],
  maxPayloadKg: [0.69, 0.488, 0.20, 0.052],
  numericRow: [0.10, 0.514, 0.77, 0.048],
  vehicleWeightKg: [0.10, 0.514, 0.18, 0.048],
  grossVehicleWeightKg: [0.31, 0.514, 0.20, 0.048],
  lengthCm: [0.46, 0.514, 0.15, 0.048],
  widthCm: [0.59, 0.514, 0.14, 0.048],
  heightCm: [0.71, 0.514, 0.16, 0.048],
  frontFrontAxleWeightKg: [0.10, 0.541, 0.18, 0.048],
  frontRearAxleWeightKg: [0.27, 0.541, 0.16, 0.048],
  rearFrontAxleWeightKg: [0.40, 0.541, 0.16, 0.048],
  rearRearAxleWeightKg: [0.53, 0.541, 0.17, 0.048],
  displacementOrRatedOutput: [0.66, 0.541, 0.22, 0.048],
  fuel: [0.10, 0.568, 0.21, 0.048],
  modelDesignationNumber: [0.43, 0.568, 0.19, 0.048],
  classificationNumber: [0.62, 0.568, 0.22, 0.048],
};

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\t\u3000]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

function section(title) {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function fieldInput(labelText) {
  const card = section("車検証読み取り情報");
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function valueByKey(key) {
  return norm(fieldInput(FIELD_LABELS[key])?.value || "");
}

function setReactInputValue(input, next) {
  if (!(input instanceof HTMLInputElement) || !next || input.value === next) return;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, next);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details");
    box.id = DEBUG_ID;
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #69a985";
    box.style.borderRadius = "12px";
    box.style.background = "#ecfdf5";
    box.innerHTML = '<summary style="font-weight:800">固定セル軽量OCR v14（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const summary = box.querySelector("summary");
  if (summary) summary.textContent = "固定セル軽量OCR v14（確認用）";
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

function pipelineReady() {
  const pre = document.querySelector("#certificate-layout-recognition-v6-debug pre");
  return /共通罫線セルOCR v6 完了/.test(pre?.textContent || "");
}

function regionObject(region) {
  const [x, y, width, height] = region;
  return { x, y, width, height };
}

function cropRegion(source, region, targetWidth = 1050) {
  const { x, y, width, height } = regionObject(region);
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * height)));
  const scale = Math.max(1, Math.min(3.4, targetWidth / sw));
  const pad = 18;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  return canvas;
}

async function recognize(worker, tesseract, source, region, options = {}) {
  const canvas = cropRegion(source, region, options.targetWidth || 1050);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(options.psm ?? tesseract.PSM?.SINGLE_LINE ?? 7),
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: options.whitelist || "",
    });
    const result = await worker.recognize(canvas);
    return {
      text: norm(result?.data?.text || ""),
      confidence: Number(result?.data?.confidence || 0),
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function digits(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8")
    .replace(/\D/g, "");
}

function parseNumber(raw, min, max) {
  for (const token of norm(raw).match(/[0-9OQDGIL|!SZB]{1,7}/g) || []) {
    const d = digits(token);
    if (!d) continue;
    const n = Number(d);
    if (n >= min && n <= max) return String(n);
  }
  return "";
}

function parseIntDash(raw, min, max) {
  const n = parseNumber(raw, min, max);
  if (n) return n;
  return /(^|\s)-($|\s)|[-－ー―]{2,}/.test(norm(raw)) ? "-" : "";
}

function parsePlate(raw = "") {
  const text = norm(raw)
    .replace(/自動車登録番号又は車両番号/g, " ")
    .replace(/自動車登録番号/g, " ")
    .replace(/車両番号/g, " ");
  const m = text.match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9OQDGIL|SZB]{3})\s*([ぁ-ん])\s*([0-9OQDGIL|SZB]{1,4})/);
  if (!m) return "";
  const region = normalizeJapanesePlateRegion(m[1]);
  const klass = digits(m[2]);
  const serial = digits(m[4]);
  if (!region || klass.length !== 3 || serial.length < 1 || serial.length > 4) return "";
  return `${region} ${klass} ${m[3]} ${serial}`;
}

function modelCore() {
  const raw = valueByKey("model") || window.__vehicleCertificateQrPriority?.model || "";
  const text = norm(raw).toUpperCase().replace(/\s+/g, "");
  return text.includes("-") ? text.split("-").pop() : text;
}

function canonicalCode(value = "") {
  return norm(value).toUpperCase().replace(/\s+/g, "")
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function parseChassis(raw = "") {
  const core = modelCore();
  const text = norm(raw).toUpperCase().replace(/[‐‑‒–—―ー−]/g, "-").replace(/\s+/g, "");
  for (const match of text.matchAll(/([A-Z0-9]{3,10})-([0-9OQDIL|!SZBG]{4,10})/g)) {
    const suffix = digits(match[2]);
    if (suffix.length < 4 || suffix.length > 10) continue;
    const prefix = match[1];
    if (core && canonicalCode(prefix) !== canonicalCode(core)) continue;
    return `${core || prefix}-${suffix}`;
  }
  return "";
}

function parseEraDate(raw = "") {
  const text = norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/\s+/g, "");
  const match = text.match(/(令和|平成|昭和)([0-9OQDGIL|SZB]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?([0-9OQDGIL|SZB]{1,2})[日HＢB]?/);
  if (!match) return "";
  const year = Number(digits(match[2]));
  const month = Number(digits(match[3]));
  const day = Number(digits(match[4]));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${match[1]}${year}年${month}月${day}日`;
}

function parseEraMonth(raw = "") {
  const text = norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/\s+/g, "");
  const match = text.match(/(令和|平成|昭和)([0-9OQDGIL|SZB]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?/);
  if (!match) return "";
  const year = Number(digits(match[2]));
  const month = Number(digits(match[3]));
  if (!year || month < 1 || month > 12) return "";
  return `${match[1]}${year}年${month}月`;
}

function parseDocNumber(raw = "") {
  const candidates = norm(raw).match(/(?:[0-9OQDGIL|SZB][\s-]*){10,14}/g) || [];
  for (const candidate of candidates) {
    const d = digits(candidate);
    if (d.length >= 10 && d.length <= 14 && new Set(d).size >= 4) return d;
  }
  return "";
}

function parseModel(raw = "") {
  const text = norm(raw).toUpperCase().replace(/\s+/g, "").replace(/[＿_]/g, "-");
  return text.match(/(?:DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG)-[A-Z0-9]{3,12}/)?.[0] || "";
}

function parseEngine(raw = "") {
  const text = norm(raw).toUpperCase().replace(/\s+/g, "").replace(/[‐‑‒–—―ー−]/g, "-");
  const model = canonicalCode(valueByKey("model"));
  const candidates = text.match(/[A-Z0-9]{2,8}(?:-[A-Z0-9]{2,10})?/g) || [];
  return candidates.find(candidate => {
    if (!/[A-Z]/.test(candidate) || !/\d/.test(candidate)) return false;
    if (candidate.length < 3 || candidate.length > 18) return false;
    if (model && canonicalCode(candidate) === model) return false;
    return true;
  }) || "";
}

function parseMaker(raw = "") {
  const text = norm(raw);
  return ["トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "いすゞ", "日野", "UDトラックス", "レクサス"].find(name => text.includes(name)) || "";
}

function parseVehicleClass(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  if (text.includes("軽自動車")) return "軽自動車";
  if (text.includes("大型特殊")) return "大型特殊自動車";
  if (text.includes("小型")) return "小型自動車";
  if (text.includes("普通")) return "普通自動車";
  return "";
}

function parsePurpose(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  return ["貨物", "乗用", "乗合", "特種"].find(item => text.includes(item)) || "";
}

function parsePrivateBusiness(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  return ["自家用", "事業用"].find(item => text.includes(item)) || "";
}

function parseBody(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  return ["箱型", "バン", "キャブオーバ", "ステーションワゴン", "セダン", "ボンネット", "トラック", "ダンプ", "幌型", "ピックアップ", "バス"].find(item => text.includes(item)) || "";
}

function parseFuel(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  const found = ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find(item => text.includes(item));
  return found === "揮発油" ? "ガソリン" : (found || "");
}

function parseBaseLocation(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  if (/使用者(?:の)?住所に同じ/.test(text)) return "使用者住所に同じ";
  return cleanFreeText(raw, 60);
}

function cleanFreeText(raw = "", max = 80) {
  let text = norm(raw)
    .replace(/使用者の氏名又は名称|使用者の住所|使用の本拠の位置/g, " ")
    .replace(/[|｜]+/g, " ")
    .replace(/[\[【（(].*?[\]】）)]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text || text.length > max) return "";
  const useful = (text.match(/[一-龠々ぁ-んァ-ヶA-Za-z0-9]/g) || []).length;
  return useful >= 2 ? text : "";
}

function parseUserName(raw = "") {
  const text = cleanFreeText(raw, 48);
  if (!text) return "";
  return text.replace(/\s*\d{4,6}\s*$/g, "").trim();
}

function parseAddress(raw = "") {
  const text = cleanFreeText(raw, 80);
  if (!text) return "";
  return text.replace(/\s*[\[【(（]?\d{5,6}[\]】)）]?\s*$/g, "").trim();
}

function parseOutput(raw = "") {
  const text = norm(raw).replace(/,/g, ".");
  const match = text.match(/\d{1,2}(?:\.\d{1,2})?/);
  if (!match) return "";
  const n = Number(match[0]);
  return n > 0 && n < 1000 ? String(n) : "";
}

function parseNumericRow(raw = "") {
  const nums = (norm(raw).match(/[0-9OQDGIL|!SZB]{2,6}/g) || [])
    .map(token => Number(digits(token)))
    .filter(Number.isFinite);
  for (let i = 0; i + 4 < nums.length; i += 1) {
    const [vw, gw, len, wid, hei] = nums.slice(i, i + 5);
    if (vw >= 100 && vw <= 50000 && gw >= vw && gw <= 80000 && len >= 200 && len <= 3000 && wid >= 100 && wid <= 350 && hei >= 100 && hei <= 600) {
      return {
        vehicleWeightKg: String(vw),
        grossVehicleWeightKg: String(gw),
        lengthCm: String(len),
        widthCm: String(wid),
        heightCm: String(hei),
      };
    }
  }
  return null;
}

function plausibleNumber(key, min, max) {
  const raw = valueByKey(key).match(/\d+(?:\.\d+)?/);
  const n = raw ? Number(raw[0]) : NaN;
  return Number.isFinite(n) && n >= min && n <= max;
}

function releaseSession(session) {
  try {
    const seen = new Set();
    const all = [session?.prepared?.source, session?.prepared?.normalized, ...Object.values(session?.prepared?.variants || {})];
    for (const canvas of all) {
      if (!canvas || seen.has(canvas)) continue;
      seen.add(canvas);
      canvas.width = 1;
      canvas.height = 1;
    }
  } catch {}
}

export default function CertificateTargetedCellRecoveryV14() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let stopped = false;
    let running = false;
    let completed = false;
    let timer = 0;

    const run = async () => {
      if (stopped || running || completed || !pipelineReady()) return;
      const sourceFile = window.__vehicleCertificateSourceFile;
      if (!sourceFile) return;

      const wants = {
        recordDate: !parseEraDate(valueByKey("recordDate")),
        documentNumber: !parseDocNumber(valueByKey("documentNumber")),
        registrationNumber: !parsePlate(valueByKey("registrationNumber")),
        chassisNumber: !valueByKey("chassisNumber"),
        registrationDate: !parseEraDate(valueByKey("registrationDate")),
        firstRegistration: !parseEraMonth(valueByKey("firstRegistration")),
        inspectionExpiry: !parseEraDate(valueByKey("inspectionExpiry")),
        userName: !valueByKey("userName"),
        userAddress: !valueByKey("userAddress"),
        baseLocation: !valueByKey("baseLocation"),
        vehicleName: !valueByKey("vehicleName"),
        model: !valueByKey("model"),
        engineModel: !valueByKey("engineModel"),
        vehicleClass: !valueByKey("vehicleClass"),
        purpose: !valueByKey("purpose"),
        privateBusiness: !valueByKey("privateBusiness"),
        bodyShape: !valueByKey("bodyShape"),
        seatingCapacity: !plausibleNumber("seatingCapacity", 1, 99),
        maxPayloadKg: !valueByKey("maxPayloadKg"),
        vehicleWeightKg: !plausibleNumber("vehicleWeightKg", 100, 50000),
        grossVehicleWeightKg: !plausibleNumber("grossVehicleWeightKg", 100, 80000),
        lengthCm: !plausibleNumber("lengthCm", 200, 3000),
        widthCm: !plausibleNumber("widthCm", 100, 350),
        heightCm: !plausibleNumber("heightCm", 100, 600),
        frontFrontAxleWeightKg: !valueByKey("frontFrontAxleWeightKg"),
        frontRearAxleWeightKg: !valueByKey("frontRearAxleWeightKg"),
        rearFrontAxleWeightKg: !valueByKey("rearFrontAxleWeightKg"),
        rearRearAxleWeightKg: !valueByKey("rearRearAxleWeightKg"),
        displacementOrRatedOutput: !valueByKey("displacementOrRatedOutput"),
        fuel: !valueByKey("fuel"),
        modelDesignationNumber: !valueByKey("modelDesignationNumber"),
        classificationNumber: !valueByKey("classificationNumber"),
      };

      const pendingKeys = Object.entries(wants).filter(([, yes]) => yes).map(([key]) => key);
      if (!pendingKeys.length) {
        completed = true;
        showDebug(["状態: 固定セル軽量OCR v14 完了", "不足項目なし / OCR 0pass"]);
        return;
      }

      running = true;
      let worker = null;
      let session = null;
      const started = performance.now();
      let ocrCalls = 0;
      try {
        showDebug([
          "状態: 固定セル軽量OCR v14 実行中",
          "全ページOCR: 0pass",
          `不足項目: ${pendingKeys.join(" / ")}`,
        ]);

        session = await createDocumentRecognitionSession(sourceFile, {
          maxSide: 1900,
          cropPaper: true,
          minPaperConfidence: 0.38,
        });
        if (stopped) return;

        const page = session.prepared.normalized;
        const contrast = session.prepared.variants?.contrast || page;
        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const patch = {};
        const lines = ["状態: 固定セル軽量OCR v14 完了", "全ページOCR: 0pass / QR取得済み項目はOCR省略"];

        const read = async (key, parser, options = {}) => {
          if (!wants[key] || patch[key]) return "";
          const region = REGIONS[key];
          if (!region) return "";
          const first = await recognize(worker, t, page, region, options);
          ocrCalls += 1;
          let parsed = parser(first.text);
          if (!parsed && options.contrast !== false) {
            const second = await recognize(worker, t, contrast, region, options);
            ocrCalls += 1;
            parsed = parser(second.text);
            if (parsed) lines.push(`${key}: ${parsed} / contrast conf=${second.confidence.toFixed(1)}`);
          } else if (parsed) {
            lines.push(`${key}: ${parsed} / conf=${first.confidence.toFixed(1)}`);
          }
          if (!parsed) lines.push(`${key}: 保留`);
          return parsed || "";
        };

        patch.recordDate = await read("recordDate", parseEraDate, { targetWidth: 1200 });
        patch.documentNumber = await read("documentNumber", parseDocNumber, { whitelist: "0123456789OQDILSBZG| ", targetWidth: 1050 });
        patch.registrationNumber = await read("registrationNumber", parsePlate, { targetWidth: 1350 });
        patch.chassisNumber = await read("chassisNumber", parseChassis, { whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ", targetWidth: 1250 });
        patch.registrationDate = await read("registrationDate", parseEraDate, { targetWidth: 1150 });
        patch.firstRegistration = await read("firstRegistration", parseEraMonth, { targetWidth: 1050 });
        patch.inspectionExpiry = await read("inspectionExpiry", parseEraDate, { targetWidth: 1200 });
        patch.userName = await read("userName", parseUserName, { psm: t.PSM?.SINGLE_BLOCK ?? 6, targetWidth: 1500 });
        patch.userAddress = await read("userAddress", parseAddress, { psm: t.PSM?.SINGLE_BLOCK ?? 6, targetWidth: 1650 });
        patch.baseLocation = await read("baseLocation", parseBaseLocation, { psm: t.PSM?.SINGLE_BLOCK ?? 6, targetWidth: 1400 });
        patch.vehicleName = await read("vehicleName", parseMaker, { targetWidth: 950 });
        patch.model = await read("model", parseModel, { whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ", targetWidth: 1150 });
        patch.engineModel = await read("engineModel", parseEngine, { whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ", targetWidth: 1150 });
        patch.vehicleClass = await read("vehicleClass", parseVehicleClass, { targetWidth: 950 });
        patch.purpose = await read("purpose", parsePurpose, { targetWidth: 900 });
        patch.privateBusiness = await read("privateBusiness", parsePrivateBusiness, { targetWidth: 1000 });
        patch.bodyShape = await read("bodyShape", parseBody, { targetWidth: 950 });
        patch.seatingCapacity = await read("seatingCapacity", raw => parseNumber(raw, 1, 99), { whitelist: "0123456789 ", targetWidth: 800 });
        patch.maxPayloadKg = await read("maxPayloadKg", raw => parseIntDash(raw, 1, 99999), { whitelist: "0123456789- ", targetWidth: 850 });

        if (wants.vehicleWeightKg || wants.grossVehicleWeightKg || wants.lengthCm || wants.widthCm || wants.heightCm) {
          const row = await recognize(worker, t, page, REGIONS.numericRow, {
            psm: t.PSM?.SINGLE_LINE ?? 7,
            whitelist: "0123456789OQDILSBZG| ",
            targetWidth: 1700,
          });
          ocrCalls += 1;
          const parsedRow = parseNumericRow(row.text);
          if (parsedRow) {
            for (const [key, result] of Object.entries(parsedRow)) {
              if (wants[key]) patch[key] = result;
            }
            lines.push(`numericRow: ${parsedRow.vehicleWeightKg}/${parsedRow.grossVehicleWeightKg}/${parsedRow.lengthCm}/${parsedRow.widthCm}/${parsedRow.heightCm} / conf=${row.confidence.toFixed(1)}`);
          }
        }

        patch.vehicleWeightKg ||= await read("vehicleWeightKg", raw => parseNumber(raw, 100, 50000), { whitelist: "0123456789 ", targetWidth: 900 });
        patch.grossVehicleWeightKg ||= await read("grossVehicleWeightKg", raw => parseNumber(raw, 100, 80000), { whitelist: "0123456789 ", targetWidth: 900 });
        patch.lengthCm ||= await read("lengthCm", raw => parseNumber(raw, 200, 3000), { whitelist: "0123456789 ", targetWidth: 800 });
        patch.widthCm ||= await read("widthCm", raw => parseNumber(raw, 100, 350), { whitelist: "0123456789 ", targetWidth: 800 });
        patch.heightCm ||= await read("heightCm", raw => parseNumber(raw, 100, 600), { whitelist: "0123456789 ", targetWidth: 800 });

        patch.frontFrontAxleWeightKg = await read("frontFrontAxleWeightKg", raw => parseIntDash(raw, 1, 30000), { whitelist: "0123456789- ", targetWidth: 850 });
        patch.frontRearAxleWeightKg = await read("frontRearAxleWeightKg", raw => parseIntDash(raw, 1, 30000), { whitelist: "0123456789- ", targetWidth: 800 });
        patch.rearFrontAxleWeightKg = await read("rearFrontAxleWeightKg", raw => parseIntDash(raw, 1, 30000), { whitelist: "0123456789- ", targetWidth: 800 });
        patch.rearRearAxleWeightKg = await read("rearRearAxleWeightKg", raw => parseIntDash(raw, 1, 30000), { whitelist: "0123456789- ", targetWidth: 850 });
        patch.displacementOrRatedOutput = await read("displacementOrRatedOutput", parseOutput, { whitelist: "0123456789.LlkWKWkw ", targetWidth: 1000 });
        patch.fuel = await read("fuel", parseFuel, { targetWidth: 900 });
        patch.modelDesignationNumber = await read("modelDesignationNumber", raw => parseNumber(raw, 1, 999999), { whitelist: "0123456789 ", targetWidth: 850 });
        patch.classificationNumber = await read("classificationNumber", raw => {
          const d = digits(raw);
          return d && d.length <= 6 ? d.padStart(4, "0") : "";
        }, { whitelist: "0123456789 ", targetWidth: 850 });

        for (const key of Object.keys(patch)) {
          if (!patch[key]) delete patch[key];
        }

        for (const [key, next] of Object.entries(patch)) {
          const label = FIELD_LABELS[key];
          if (label) setReactInputValue(fieldInput(label), next);
        }

        if (Object.keys(patch).length) {
          window.__vehicleCertificateTargetedV14Patch = patch;
          for (let i = 0; i < 3; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await new Promise(resolve => setTimeout(resolve, 120));
          }
        }

        completed = true;
        const elapsed = Math.round(performance.now() - started);
        lines.splice(2, 0, `セルOCR回数: ${ocrCalls}pass`, `所要: ${elapsed}ms`, `採用: ${Object.keys(patch).join(" / ") || "なし"}`);
        showDebug(lines);
        window.dispatchEvent(new CustomEvent("vehicle-certificate-v14-done", { detail: { ocrCalls, elapsed, patch } }));
      } catch (error) {
        showDebug(["状態: 固定セル軽量OCR v14 エラー", String(error?.message || error), "全ページOCRには戻しません"]);
        window.dispatchEvent(new CustomEvent("vehicle-certificate-v14-done", { detail: { error: String(error?.message || error) } }));
      } finally {
        running = false;
        if (worker) await worker.terminate().catch(() => {});
        if (session) releaseSession(session);
      }
    };

    timer = window.setInterval(() => { void run(); }, 180);
    void run();

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
