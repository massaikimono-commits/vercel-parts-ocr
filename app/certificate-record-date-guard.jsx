"use client";

import { useEffect } from "react";
import { prepareDocumentImage } from "./lib/document-image-pipeline";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function repairDateText(value = "") {
  return norm(value)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");
}

function numberVariants(token = "") {
  const out = [];
  const n = Number(token);
  if (Number.isFinite(n) && n <= 99) out.push(n);
  if (token.length === 3) {
    out.push(Number(token.slice(0, 2)), Number(token.slice(1)), Number(token[0]), Number(token[2]));
  }
  return [...new Set(out.filter(Number.isFinite))];
}

function parseJpDate(value = "") {
  const text = repairDateText(value);
  const era = text.match(/令和|平成|昭和/)?.[0] || "";
  if (!era) return "";

  const direct = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (direct) {
    const month = Number(direct[3]);
    const day = Number(direct[4]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${direct[1]}${direct[2] === "元" ? "元" : Number(direct[2])}年${month}月${day}日`;
    }
  }

  const tail = text.slice(text.indexOf(era) + era.length);
  const tokens = tail.match(/\d{1,3}/g) || [];
  const maxYear = era === "令和" ? 40 : era === "平成" ? 31 : 64;
  for (let i = 0; i < tokens.length; i += 1) {
    for (const year of numberVariants(tokens[i])) {
      if (year < 1 || year > maxYear) continue;
      for (let j = i + 1; j < Math.min(tokens.length, i + 4); j += 1) {
        for (const month of numberVariants(tokens[j])) {
          if (month < 1 || month > 12) continue;
          for (let k = j + 1; k < Math.min(tokens.length, j + 4); k += 1) {
            for (const day of numberVariants(tokens[k])) {
              if (day >= 1 && day <= 31) return `${era}${year}年${month}月${day}日`;
            }
          }
        }
      }
    }
  }
  return "";
}

function eraYear(era, year) {
  const n = year === "元" ? 1 : Number(year);
  return era === "令和" ? 2018 + n : era === "平成" ? 1988 + n : era === "昭和" ? 1925 + n : 0;
}

function dateOrdinal(value = "") {
  const m = norm(value).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const year = eraYear(m[1], m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year * 10000 + month * 100 + day;
}

function monthOrdinal(value = "") {
  const m = norm(value).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月/);
  if (!m) return null;
  const year = eraYear(m[1], m[2]);
  const month = Number(m[3]);
  return year && month >= 1 && month <= 12 ? year * 12 + month : null;
}

function plausible(value) {
  const date = dateOrdinal(value);
  if (!date) return false;
  const qr = window.__vehicleCertificateQrPriority || {};
  const first = monthOrdinal(qr.firstRegistration || "");
  const expiry = dateOrdinal(qr.inspectionExpiry || "");
  if (first) {
    const year = Math.floor(date / 10000);
    const month = Math.floor((date % 10000) / 100);
    if (year * 12 + month < first) return false;
  }
  if (expiry && date > expiry) return false;
  const now = new Date();
  const futureLimit = (now.getFullYear() + 1) * 10000 + 1231;
  return date <= futureLimit;
}

function detailInput(labelText) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || "");
    if (title !== norm(labelText)) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function applyReact(input, value) {
  if (!(input instanceof HTMLInputElement) || !value) return false;
  if (input.value === value) return true;
  const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
  const props = key ? input[key] : null;
  if (typeof props?.onChange === "function") {
    props.onChange({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} });
    return true;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const previous = input.value;
  if (setter) setter.call(input, value); else input.value = value;
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function rawFromExistingDebug() {
  const debug = [...document.querySelectorAll("details pre")]
    .map((node) => node.textContent || "")
    .find((text) => text.includes("【記録年月日 生OCR】")) || "";
  if (!debug) return "";
  const m = debug.match(/【記録年月日 生OCR】\s*([^\n]*)/);
  if (m?.[1]) return m[1].trim();
  const i = debug.indexOf("記録年月日");
  return i >= 0 ? debug.slice(i, i + 120) : "";
}

function crop(source, box, contrast = false) {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(6, 2200 / sw));
  const pad = 40;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  if (contrast) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < image.data.length; p += 4) {
      const gray = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      const v = gray < 178 ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function targetedRead(file) {
  const prepared = await prepareDocumentImage(file, { maxSide: 3200, cropPaper: true, minPaperConfidence: 0.46 });
  const source = prepared.normalized;
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);
  const raws = [];
  const plans = [
    { box: [0.58, 0.045, 0.38, 0.085], psm: String(t.PSM?.SINGLE_BLOCK ?? "6") },
    { box: [0.62, 0.072, 0.32, 0.055], psm: String(t.PSM?.SINGLE_LINE ?? "7") },
  ];
  try {
    for (const plan of plans) {
      for (const contrast of [false, true]) {
        const canvas = crop(source, plan.box, contrast);
        try {
          await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: plan.psm, user_defined_dpi: "300" });
          const raw = norm((await worker.recognize(canvas)).data.text || "");
          if (raw) raws.push(`${contrast ? "白黒" : "通常"}: ${raw}`);
          const value = parseJpDate(raw);
          if (value && plausible(value)) return { value, raws };
        } finally {
          canvas.width = 1;
          canvas.height = 1;
        }
      }
    }
    return { value: "", raws };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

function showDebug(source, before, after, detail = []) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  );
  if (!card) return;
  let box = document.getElementById("certificate-record-date-guard-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-record-date-guard-debug";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">記録年月日補正（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    card.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = `取得元: ${source}\n補正前: ${before || "(空)"}\n補正後: ${after || "(保留)"}${detail.length ? `\n\n${detail.join("\n---\n")}` : ""}`;
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificateRecordDateGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null;
    let startedAt = 0;
    let sawProgress = false;
    let running = false;
    let scanId = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      startedAt = Date.now();
      sawProgress = false;
      running = false;
      scanId += 1;
    };

    const timer = window.setInterval(async () => {
      if (!pending || running) return;
      if (document.querySelector(".progress")) {
        sawProgress = true;
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (sawProgress && elapsed < 1800) return;
      if (!sawProgress && elapsed < 12000) return;

      const input = detailInput("記録年月日");
      const current = input?.value || "";
      const currentParsed = parseJpDate(current);
      if (currentParsed && plausible(currentParsed)) {
        pending = null;
        showDebug("既存値", current, currentParsed);
        return;
      }

      const qrRaw = window.__vehicleCertificateQrPriority?.recordDate || "";
      const qrValue = parseJpDate(qrRaw);
      if (qrValue && plausible(qrValue)) {
        if (input) applyReact(input, qrValue);
        pending = null;
        showDebug("QR", current, qrValue);
        return;
      }

      const existingRaw = rawFromExistingDebug();
      const existingValue = parseJpDate(existingRaw);
      if (existingValue && plausible(existingValue)) {
        if (input) applyReact(input, existingValue);
        pending = null;
        showDebug("既存OCR再解析", current, existingValue, [existingRaw]);
        return;
      }

      const file = pending;
      const id = scanId;
      pending = null;
      running = true;
      showDebug("右上欄のみ再読取", current, "", [existingRaw || "既存OCR候補なし"]);
      try {
        const result = await targetedRead(file);
        if (id !== scanId) return;
        const latest = detailInput("記録年月日");
        const before = latest?.value || current;
        const beforeParsed = parseJpDate(before);
        if (result.value && (!beforeParsed || !plausible(beforeParsed))) {
          if (latest) applyReact(latest, result.value);
          showDebug("右上欄のみ再読取", before, result.value, result.raws);
        } else if (result.value && beforeParsed !== result.value) {
          showDebug("右上欄のみ再読取", before, beforeParsed, [...result.raws, `候補 ${result.value} と既存値が競合したため既存値を保持`]);
        } else {
          showDebug("右上欄のみ再読取", before, result.value || "", result.raws);
        }
      } catch (error) {
        showDebug("右上欄のみ再読取", current, "", [String(error?.message || error)]);
      } finally {
        running = false;
      }
    }, 700);

    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
