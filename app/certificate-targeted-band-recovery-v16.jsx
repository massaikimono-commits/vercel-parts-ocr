"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";
import { normalizeJapanesePlateRegion } from "./lib/japanese-plate-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-targeted-band-recovery-v16-debug";

const LABELS = {
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

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\t\u3000]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

function section(title) {
  return [...document.querySelectorAll("section.card")].find((node) => node.querySelector("h2")?.textContent?.includes(title)) || null;
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

function current(key) { return norm(fieldInput(LABELS[key])?.value || ""); }

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
    box.innerHTML = '<summary style="font-weight:800">帯域軽量OCR v16（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

function crop(source, region, targetWidth = 1700) {
  const [x, y, w, h] = region;
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(3.4, targetWidth / Math.max(1, sw)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function recognize(worker, tesseract, source, region, options = {}) {
  const canvas = crop(source, region, options.targetWidth || 1700);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(options.psm ?? tesseract.PSM?.SPARSE_TEXT ?? 11),
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: options.whitelist || "",
    });
    const result = await worker.recognize(canvas);
    return { text: norm(result?.data?.text || ""), confidence: Number(result?.data?.confidence || 0) };
  } finally { canvas.width = 1; canvas.height = 1; }
}

function digits(value = "") {
  return String(value).toUpperCase()
    .replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/Z/g, "2")
    .replace(/S/g, "5").replace(/G/g, "6").replace(/B/g, "8").replace(/\D/g, "");
}

function parsePlate(raw = "") {
  const text = norm(raw).replace(/\n+/g, " ");
  const candidates = [...text.matchAll(/([ぁ-んァ-ヶ一-龠]{1,10})\s*([0-9OQDGIL|SZB](?:\s*[0-9OQDGIL|SZB]){2})\s*([ぁ-ん])\s*([0-9OQDGIL|SZB](?:\s*[0-9OQDGIL|SZB]){0,3})/g)];
  for (const m of candidates) {
    const region = normalizeJapanesePlateRegion(m[1]);
    const klass = digits(m[2]);
    const serial = digits(m[4]);
    if (region && klass.length === 3 && serial.length >= 1 && serial.length <= 4) return `${region} ${klass} ${m[3]} ${serial}`;
  }
  return "";
}

function modelCore() {
  const raw = current("model") || window.__vehicleCertificateQrPriority?.model || "";
  const value = norm(raw).toUpperCase().replace(/\s+/g, "");
  return value.includes("-") ? value.split("-").pop() : value;
}

function parseChassis(raw = "") {
  const text = norm(raw).toUpperCase().replace(/[‐‑‒–—―ー−]/g, "-").replace(/\s+/g, "");
  const core = modelCore();
  for (const m of text.matchAll(/([A-Z0-9]{3,10})-([0-9OQDIL|!SZBG]{4,10})/g)) {
    const suffix = digits(m[2]);
    if (suffix.length < 4 || suffix.length > 10) continue;
    const prefix = m[1];
    if (core && prefix !== core && !prefix.endsWith(core) && !core.endsWith(prefix)) continue;
    return `${core || prefix}-${suffix}`;
  }
  return "";
}

function eraDates(raw = "") {
  const text = norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/\s+/g, "");
  const out = [];
  for (const m of text.matchAll(/(令和|平成|昭和)([0-9OQDGIL|SZB]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?([0-9OQDGIL|SZB]{1,2})[日HＢB]?/g)) {
    const y = Number(digits(m[2])), mo = Number(digits(m[3])), d = Number(digits(m[4]));
    if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${m[1]}${y}年${mo}月${d}日`);
  }
  return [...new Set(out)];
}

function dateNearLabel(raw, labels) {
  const text = norm(raw);
  for (const label of labels) {
    const i = text.indexOf(label);
    if (i < 0) continue;
    const dates = eraDates(text.slice(Math.max(0, i - 15), i + label.length + 80));
    if (dates[0]) return dates[0];
  }
  return "";
}

function parseDocNumber(raw = "") {
  const candidates = (norm(raw).match(/[0-9OQDGIL|SZB ]{10,20}/g) || []).map(digits).filter((v) => v.length >= 12 && v.length <= 14);
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function pick(raw, values) {
  const text = norm(raw).replace(/\s+/g, "");
  return values.find((value) => text.includes(value.replace(/\s+/g, ""))) || "";
}

function engineCode(raw = "") {
  const text = norm(raw).toUpperCase().replace(/[‐‑‒–—―ー−]/g, "-").replace(/\s+/g, "");
  const model = norm(current("model") || window.__vehicleCertificateQrPriority?.model || "").toUpperCase().replace(/\s+/g, "");
  const around = (() => {
    const i = text.indexOf("原動機の型式");
    return i >= 0 ? text.slice(i, i + 70) : text;
  })();
  const matches = around.match(/[A-Z0-9]{3,8}(?:-[A-Z0-9]{2,10})?/g) || [];
  for (const value of matches) {
    if (value === model || /^DAA-/.test(value) || /^\d{5,}$/.test(value)) continue;
    const digitCount = (value.match(/\d/g) || []).length;
    if (!value.includes("-") && digitCount < 2) continue; // AEЕ3のような弱い誤読を捨てる
    if (!/[A-Z]/.test(value) || !/\d/.test(value)) continue;
    if (/^[A-Z]\d{2}[A-Z]/.test(value) || value.includes("-")) return value;
  }
  return "";
}

function safeSeat(raw = "") {
  const text = norm(raw).replace(/\s+/g, " ");
  const m = text.match(/乗車定員[^\n0-9]{0,12}([1-9][0-9]?)\s*(?:人|名)?/);
  if (!m) return "";
  const n = Number(m[1]);
  return n >= 2 && n <= 99 ? String(n) : ""; // 1は周辺見出し番号との誤読が多いので自動採用しない
}

function parseAddress(raw = "") {
  const text = norm(raw).replace(/\n+/g, " ");
  const m = text.match(/((?:東京都|北海道|(?:大阪|京都)府|.{2,3}県)[^|]{5,55}?\d+(?:丁目)?\s*\d*[-ー－]?\s*\d*)/);
  return m ? norm(m[1]).replace(/\s*([0-9])\s*/g, "$1") : "";
}

function nextMatching(ints, start, min, max, predicate = null) {
  for (let i = start; i < ints.length; i += 1) {
    const n = ints[i].value;
    if (n < min || n > max) continue;
    if (predicate && !predicate(n)) continue;
    return { index: i, value: n };
  }
  return null;
}

function parseNumericBand(raw = "") {
  const text = norm(raw).replace(/,/g, "");
  const nums = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => ({ text: m[0], value: Number(m[0]), index: m.index || 0 }));
  const ints = nums.filter((x) => Number.isInteger(x.value));
  const patch = {};

  // ノイズを最大2個ずつ飛ばしながら重量→総重量→長→幅→高の順序を探す。
  for (let s = 0; s < ints.length; s += 1) {
    const w = ints[s];
    if (w.value < 100 || w.value > 5000) continue;
    const g = nextMatching(ints, s + 1, w.value, 10000);
    if (!g || g.index - s > 3) continue;
    const l = nextMatching(ints, g.index + 1, 200, 1200);
    if (!l || l.index - g.index > 3) continue;
    const wd = nextMatching(ints, l.index + 1, 100, 300);
    if (!wd || wd.index - l.index > 3) continue;
    const h = nextMatching(ints, wd.index + 1, 100, 500);
    if (!h || h.index - wd.index > 3) continue;
    patch.vehicleWeightKg = String(w.value);
    patch.grossVehicleWeightKg = String(g.value);
    patch.lengthCm = String(l.value);
    patch.widthCm = String(wd.value);
    patch.heightCm = String(h.value);

    const after = ints.slice(h.index + 1, h.index + 7).filter((x) => x.value >= 50 && x.value <= 5000);
    if (after[0]) patch.frontFrontAxleWeightKg = String(after[0].value);
    if (after.length >= 2) patch.rearRearAxleWeightKg = String(after[after.length - 1].value);
    break;
  }

  const decimal = nums.find((x) => !Number.isInteger(x.value) && x.value > 0 && x.value < 20);
  if (decimal) patch.displacementOrRatedOutput = String(decimal.text);

  const designation = ints.find((x) => x.value >= 10000 && x.value <= 99999);
  if (designation) {
    patch.modelDesignationNumber = String(designation.value);
    const after = ints.slice(ints.indexOf(designation) + 1).find((x) => x.value >= 0 && x.value <= 9999);
    if (after) patch.classificationNumber = String(after.value).padStart(4, "0");
  }
  return patch;
}

function releaseSession(session) {
  try {
    const seen = new Set();
    const all = [session?.prepared?.source, session?.prepared?.normalized, ...Object.values(session?.prepared?.variants || {})];
    for (const canvas of all) {
      if (!canvas || seen.has(canvas)) continue;
      seen.add(canvas); canvas.width = 1; canvas.height = 1;
    }
  } catch {}
}

function hasAnyMissing(keys) { return keys.some((key) => !current(key) && !window.__vehicleCertificateQrPriority?.[key]); }

export default function CertificateTargetedBandRecoveryV16() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let stopped = false;
    let generation = 0;
    let pendingFile = null;
    let fallbackTimer = 0;

    const run = async (file, mine) => {
      if (!file || stopped || mine !== generation) return;
      const started = performance.now();
      let worker = null;
      let session = null;
      let passCount = 0;
      try {
        // QR state反映イベントがDOMへ届く時間だけ待つ。
        await new Promise((resolve) => setTimeout(resolve, 180));
        if (stopped || mine !== generation) return;
        showDebug(["状態: 帯域軽量OCR v16 実行中", "方式: QR確定項目は触らず、不足帯域だけ最大4pass"]);

        session = await createDocumentRecognitionSession(file, { maxSide: 1900, cropPaper: true, minPaperConfidence: 0.38 });
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const patch = {};
        const lines = [];

        const identityKeys = ["recordDate", "documentNumber", "registrationNumber", "chassisNumber", "registrationDate"];
        if (hasAnyMissing(identityKeys)) {
          const top = await recognize(worker, t, source, [0.04, 0.055, 0.92, 0.245], { psm: t.PSM?.SPARSE_TEXT ?? 11, targetWidth: 1750 });
          passCount += 1;
          const text = top.text;
          if (!current("documentNumber")) patch.documentNumber = parseDocNumber(text);
          if (!current("registrationNumber")) patch.registrationNumber = parsePlate(text);
          if (!current("chassisNumber")) patch.chassisNumber = parseChassis(text);
          // 日付を出現順で記録年月日に入れない。交付年月日のみラベル優先で採る。
          if (!current("registrationDate")) {
            patch.registrationDate = dateNearLabel(text, ["交付年月日", "登録年月日"]);
            if (!patch.registrationDate) {
              const ds = eraDates(text);
              const h = ds.find((d) => d.startsWith("平成"));
              if (h) patch.registrationDate = h;
            }
          }
          // recordDateはラベル近傍で確定できた時だけ。曖昧なら空欄維持。
          if (!current("recordDate")) patch.recordDate = dateNearLabel(text, ["記録年月日"]);
          lines.push(`上段: conf=${top.confidence.toFixed(1)} / plate=${patch.registrationNumber || "保留"} / chassis=${patch.chassisNumber || "保留"} / 交付=${patch.registrationDate || "保留"}`);
        } else lines.push("上段: QR/既存値で充足 → OCR省略");

        const detailKeys = ["userAddress", "baseLocation", "vehicleName", "engineModel", "vehicleClass", "purpose", "privateBusiness", "bodyShape", "seatingCapacity", "fuel"];
        if (hasAnyMissing(detailKeys)) {
          const detail = await recognize(worker, t, source, [0.04, 0.275, 0.92, 0.225], { psm: t.PSM?.SPARSE_TEXT ?? 11, targetWidth: 1750 });
          passCount += 1;
          const text = detail.text;
          if (!current("userAddress") && !window.__vehicleCertificateQrPriority?.userAddress) patch.userAddress = parseAddress(text);
          if (!current("baseLocation")) patch.baseLocation = pick(text, ["使用者住所に同じ"]);
          if (!current("vehicleName")) patch.vehicleName = pick(text, ["トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "いすゞ", "日野"]);
          if (!current("engineModel")) patch.engineModel = engineCode(text);
          if (!current("vehicleClass")) patch.vehicleClass = pick(text, ["軽自動車", "小型自動車", "普通自動車", "大型特殊自動車"]);
          if (!current("purpose")) patch.purpose = pick(text, ["乗用", "貨物", "乗合", "特種"]);
          if (!current("privateBusiness")) patch.privateBusiness = pick(text, ["自家用", "事業用"]);
          if (!current("bodyShape")) patch.bodyShape = pick(text, ["箱型", "バン", "ステーションワゴン", "セダン", "トラック", "ダンプ", "バス"]);
          if (!current("seatingCapacity")) patch.seatingCapacity = safeSeat(text);
          if (!current("fuel")) patch.fuel = pick(text, ["ガソリン", "軽油", "電気", "LPG"]);
          lines.push(`詳細: conf=${detail.confidence.toFixed(1)} / engine=${patch.engineModel || "保留"} / seat=${patch.seatingCapacity || "保留"}`);
        } else lines.push("詳細: QR/既存値で充足 → OCR省略");

        const numericKeys = ["vehicleWeightKg", "grossVehicleWeightKg", "lengthCm", "widthCm", "heightCm", "frontFrontAxleWeightKg", "rearRearAxleWeightKg", "displacementOrRatedOutput", "modelDesignationNumber", "classificationNumber"];
        if (hasAnyMissing(numericKeys)) {
          const numeric = await recognize(worker, t, source, [0.06, 0.49, 0.88, 0.105], {
            psm: t.PSM?.SPARSE_TEXT ?? 11,
            whitelist: "0123456789.- kgKGLlWwcmCM",
            targetWidth: 1700,
          });
          passCount += 1;
          const nPatch = parseNumericBand(numeric.text);
          for (const [key, value] of Object.entries(nPatch)) if (!current(key) && !window.__vehicleCertificateQrPriority?.[key] && value) patch[key] = value;
          lines.push(`数値: conf=${numeric.confidence.toFixed(1)} / ${["vehicleWeightKg","grossVehicleWeightKg","lengthCm","widthCm","heightCm"].map((k) => `${k}=${patch[k] || current(k) || "-"}`).join(" / ")}`);
        } else lines.push("数値: QR/既存値で充足 → OCR省略");

        // 登録番号・車台番号がまだ両方とも弱い時だけ、上2行を1passで再確認。
        if ((!current("registrationNumber") && !patch.registrationNumber) || (!current("chassisNumber") && !patch.chassisNumber)) {
          const identity = await recognize(worker, t, source, [0.06, 0.145, 0.62, 0.105], { psm: t.PSM?.SPARSE_TEXT ?? 11, targetWidth: 1850 });
          passCount += 1;
          if (!current("registrationNumber") && !patch.registrationNumber) patch.registrationNumber = parsePlate(identity.text);
          if (!current("chassisNumber") && !patch.chassisNumber) patch.chassisNumber = parseChassis(identity.text);
          lines.push(`身元専用: conf=${identity.confidence.toFixed(1)} / plate=${patch.registrationNumber || "保留"} / chassis=${patch.chassisNumber || "保留"}`);
        }

        for (const key of Object.keys(patch)) if (!patch[key]) delete patch[key];
        for (const [key, value] of Object.entries(patch)) {
          // QR値が後から来ている場合はQRを優先。
          if (window.__vehicleCertificateQrPriority?.[key]) continue;
          setReactInputValue(fieldInput(LABELS[key]), value);
        }
        if (Object.keys(patch).length) window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));

        showDebug([
          "状態: 帯域軽量OCR v16 完了",
          `OCR回数: ${passCount}pass (最大4pass)`,
          `所要: ${Math.round(performance.now() - started)}ms`,
          `採用: ${Object.keys(patch).join(" / ") || "なし（QR/既存値を維持）"}`,
          ...lines,
        ]);
      } catch (error) {
        showDebug(["状態: 帯域軽量OCR v16 エラー", String(error?.message || error)]);
      } finally {
        releaseSession(session);
      }
    };

    const startForPending = () => {
      const file = pendingFile;
      if (!file) return;
      pendingFile = null;
      clearTimeout(fallbackTimer);
      void run(file, generation);
    };
    const onLowerDone = () => startForPending();
    const onChange = (event) => {
      if (event.__certificatePipelineReplay || event.__certificateV13Replay) return;
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const card = input.closest("section.card");
      if (!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る")) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      generation += 1;
      pendingFile = file;
      showDebug(["状態: 高速QR v2完了待ち", "次段: QRで埋まらない帯域だけ最大4pass"]);
      fallbackTimer = window.setTimeout(startForPending, 7000);
    };

    document.addEventListener("change", onChange, true);
    window.addEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    return () => {
      stopped = true;
      generation += 1;
      clearTimeout(fallbackTimer);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    };
  }, []);
  return null;
}
