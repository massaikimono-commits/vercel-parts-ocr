"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";
import { normalizeJapanesePlateRegion } from "./lib/japanese-plate-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-targeted-band-recovery-v15-debug";

const LABELS = {
  recordDate: "記録年月日",
  documentNumber: "記録事項番号",
  registrationNumber: "自動車登録番号又は車両番号",
  chassisNumber: "車台番号",
  registrationDate: "登録年月日／交付年月日",
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
  return [...document.querySelectorAll("section.card")].find((node) =>
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

function current(key) {
  return norm(fieldInput(LABELS[key])?.value || "");
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
    box.innerHTML = '<summary style="font-weight:800">帯域軽量OCR v15（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

function crop(source, region, targetWidth = 1500) {
  const [x, y, w, h] = region;
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(3, targetWidth / Math.max(1, sw)));
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
  const canvas = crop(source, region, options.targetWidth || 1500);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(options.psm ?? tesseract.PSM?.SPARSE_TEXT ?? 11),
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

function parsePlate(raw = "") {
  const text = norm(raw);
  const match = text.match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9OQDGIL|SZB]{3})\s*([ぁ-ん])\s*([0-9OQDGIL|SZB]{1,4})/);
  if (!match) return "";
  const region = normalizeJapanesePlateRegion(match[1]);
  const klass = digits(match[2]);
  const serial = digits(match[4]);
  if (!region || klass.length !== 3 || !serial) return "";
  return `${region} ${klass} ${match[3]} ${serial}`;
}

function modelCore() {
  const raw = current("model") || window.__vehicleCertificateQrPriority?.model || "";
  const value = norm(raw).toUpperCase().replace(/\s+/g, "");
  return value.includes("-") ? value.split("-").pop() : value;
}

function parseChassis(raw = "") {
  const text = norm(raw).toUpperCase().replace(/\s+/g, "");
  const core = modelCore();
  for (const match of text.matchAll(/([A-Z0-9]{3,10})-([0-9OQDIL|!SZBG]{4,10})/g)) {
    const suffix = digits(match[2]);
    if (suffix.length < 4) continue;
    if (core && !match[1].endsWith(core) && !core.endsWith(match[1])) continue;
    return `${core || match[1]}-${suffix}`;
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
    const y = Number(digits(m[2]));
    const mo = Number(digits(m[3]));
    const d = Number(digits(m[4]));
    if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${m[1]}${y}年${mo}月${d}日`);
  }
  return [...new Set(out)];
}

function parseDocNumber(raw = "") {
  const candidates = (norm(raw).match(/[0-9OQDGIL|SZB ]{10,20}/g) || [])
    .map(digits)
    .filter((value) => value.length >= 10 && value.length <= 14);
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function pick(raw, values) {
  const text = norm(raw).replace(/\s+/g, "");
  return values.find((value) => text.includes(value.replace(/\s+/g, ""))) || "";
}

function engineCode(raw = "") {
  const text = norm(raw).toUpperCase().replace(/\s+/g, "");
  const model = norm(current("model") || window.__vehicleCertificateQrPriority?.model || "").toUpperCase().replace(/\s+/g, "");
  const matches = text.match(/[A-Z0-9]{2,8}(?:-[A-Z0-9]{2,10})?/g) || [];
  return matches.find((value) => value !== model && /[A-Z]/.test(value) && /\d/.test(value) && !/^DAA-/.test(value) && !/^\d{5,}$/.test(value)) || "";
}

function contextNumber(raw, labels, min, max) {
  const text = norm(raw);
  for (const label of labels) {
    const i = text.indexOf(label);
    if (i < 0) continue;
    const tail = text.slice(i + label.length, i + label.length + 45);
    for (const token of tail.match(/[0-9OQDGIL|SZB]{1,6}/g) || []) {
      const n = Number(digits(token));
      if (n >= min && n <= max) return String(n);
    }
  }
  return "";
}

function parseNumericBand(raw = "") {
  const text = norm(raw).replace(/,/g, "");
  const tokens = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  const ints = tokens.filter((v) => !v.includes(".")).map(Number);
  const patch = {};

  // The first row is weight / gross / length / width / height.
  for (let i = 0; i + 4 < ints.length; i += 1) {
    const [w, g, l, wd, h] = ints.slice(i, i + 5);
    if (w >= 100 && w <= 50000 && g >= w && g <= 80000 && l >= 200 && l <= 3000 && wd >= 100 && wd <= 300 && h >= 100 && h <= 600) {
      patch.vehicleWeightKg = String(w);
      patch.grossVehicleWeightKg = String(g);
      patch.lengthCm = String(l);
      patch.widthCm = String(wd);
      patch.heightCm = String(h);
      break;
    }
  }

  const decimal = tokens.find((value) => /^\d+\.\d+$/.test(value) && Number(value) > 0 && Number(value) < 20);
  if (decimal) patch.displacementOrRatedOutput = decimal;

  const designation = ints.find((value) => value >= 10000 && value <= 99999);
  if (designation) patch.modelDesignationNumber = String(designation);
  const designationIndex = designation ? ints.indexOf(designation) : -1;
  if (designationIndex >= 0) {
    const classification = ints.slice(designationIndex + 1).find((value) => value >= 0 && value <= 9999);
    if (classification != null) patch.classificationNumber = String(classification).padStart(4, "0");
  }

  if (patch.vehicleWeightKg) {
    const start = ints.indexOf(Number(patch.heightCm));
    const after = start >= 0 ? ints.slice(start + 1) : [];
    const axle = after.filter((value) => value >= 50 && value <= 30000).slice(0, 4);
    if (axle[0] != null) patch.frontFrontAxleWeightKg = String(axle[0]);
    if (axle.length >= 2) patch.rearRearAxleWeightKg = String(axle[axle.length - 1]);
  }
  return patch;
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

export default function CertificateTargetedBandRecoveryV15() {
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
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        if (stopped || mine !== generation) return;
        showDebug(["状態: 帯域軽量OCR v15 実行中", "方式: QR確定後、最大4passのみ"]);

        session = await createDocumentRecognitionSession(file, {
          maxSide: 1750,
          cropPaper: true,
          minPaperConfidence: 0.38,
        });
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const patch = {};
        const lines = [];

        const top = await recognize(worker, t, source, [0.04, 0.06, 0.92, 0.34], {
          psm: t.PSM?.SPARSE_TEXT ?? 11,
          targetWidth: 1550,
        });
        passCount += 1;
        const topText = top.text;
        if (!current("documentNumber")) patch.documentNumber = parseDocNumber(topText);
        if (!current("registrationNumber")) patch.registrationNumber = parsePlate(topText);
        if (!current("baseLocation") && /使用者(?:の)?住所に同じ/.test(topText.replace(/\s+/g, ""))) patch.baseLocation = "使用者住所に同じ";
        const dates = eraDates(topText);
        if (!current("recordDate") && dates[0]) patch.recordDate = dates[0];
        if (!current("registrationDate") && dates.length >= 2) patch.registrationDate = dates[1];
        lines.push(`上段まとめ: conf=${top.confidence.toFixed(1)} / dates=${dates.join(",") || "なし"}`);

        const detail = await recognize(worker, t, source, [0.04, 0.39, 0.92, 0.20], {
          psm: t.PSM?.SPARSE_TEXT ?? 11,
          targetWidth: 1550,
        });
        passCount += 1;
        const detailText = detail.text;
        if (!current("vehicleName")) patch.vehicleName = pick(detailText, ["トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "いすゞ", "日野"]);
        if (!current("engineModel")) patch.engineModel = engineCode(detailText);
        if (!current("vehicleClass")) patch.vehicleClass = pick(detailText, ["軽自動車", "小型自動車", "普通自動車", "大型特殊自動車"]);
        if (!current("purpose")) patch.purpose = pick(detailText, ["乗用", "貨物", "乗合", "特種"]);
        if (!current("privateBusiness")) patch.privateBusiness = pick(detailText, ["自家用", "事業用"]);
        if (!current("bodyShape")) patch.bodyShape = pick(detailText, ["箱型", "バン", "ステーションワゴン", "セダン", "トラック", "ダンプ", "バス"]);
        if (!current("seatingCapacity")) patch.seatingCapacity = contextNumber(detailText, ["乗車定員"], 1, 99);
        if (!current("maxPayloadKg") && /最大積載量[^\n]{0,25}[-－ー―]{1,}/.test(detailText)) patch.maxPayloadKg = "-";
        lines.push(`詳細まとめ: conf=${detail.confidence.toFixed(1)}`);

        const numeric = await recognize(worker, t, source, [0.07, 0.50, 0.84, 0.10], {
          psm: t.PSM?.SPARSE_TEXT ?? 11,
          whitelist: "0123456789.- kgKGLlWwcmCM",
          targetWidth: 1550,
        });
        passCount += 1;
        const numericPatch = parseNumericBand(numeric.text);
        for (const [key, value] of Object.entries(numericPatch)) if (!current(key) && value) patch[key] = value;
        lines.push(`数値2段まとめ: conf=${numeric.confidence.toFixed(1)} / ${numeric.text || "空"}`);

        const qr = window.__vehicleCertificateQrPriority || {};
        if (!current("chassisNumber") && !qr.chassisNumber) {
          const chassis = await recognize(worker, t, source, [0.08, 0.195, 0.52, 0.065], {
            psm: t.PSM?.SINGLE_LINE ?? 7,
            whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ",
            targetWidth: 1250,
          });
          passCount += 1;
          patch.chassisNumber = parseChassis(chassis.text);
          lines.push(`車台番号専用: conf=${chassis.confidence.toFixed(1)} / ${chassis.text || "空"}`);
        }

        for (const key of Object.keys(patch)) if (!patch[key]) delete patch[key];
        for (const [key, value] of Object.entries(patch)) setReactInputValue(fieldInput(LABELS[key]), value);
        if (Object.keys(patch).length) {
          window.__vehicleCertificateTargetedV15Patch = patch;
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
          await new Promise((resolve) => window.setTimeout(resolve, 180));
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
        }

        const elapsed = Math.round(performance.now() - started);
        showDebug([
          "状態: 帯域軽量OCR v15 完了",
          `OCR回数: ${passCount}pass（最大4pass）`,
          `所要: ${elapsed}ms`,
          `採用: ${Object.keys(patch).join(" / ") || "なし"}`,
          ...lines,
          "方針: これ以上の全ページOCR・27セル総当たりは実行しません。",
        ]);
      } catch (error) {
        showDebug(["状態: 帯域軽量OCR v15 エラー", String(error?.message || error), "重い全ページOCRには戻しません"]);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        if (session) releaseSession(session);
      }
    };

    const startForPending = () => {
      const file = pendingFile;
      if (!file) return;
      pendingFile = null;
      window.clearTimeout(fallbackTimer);
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
      showDebug(["状態: QR先行完了待ち", "次段: 帯域OCRは最大4pass"]);
      fallbackTimer = window.setTimeout(startForPending, 6500);
    };

    document.addEventListener("change", onChange, true);
    window.addEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    return () => {
      stopped = true;
      generation += 1;
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    };
  }, []);

  return null;
}
