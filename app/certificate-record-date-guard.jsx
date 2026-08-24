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

function repair(value = "") {
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

function eraYear(era, year) {
  const n = year === "元" ? 1 : Number(year);
  return era === "令和" ? 2018 + n : era === "平成" ? 1988 + n : era === "昭和" ? 1925 + n : 0;
}

function parseDate(value = "") {
  const text = repair(value);
  const m = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function ordinal(value = "") {
  const m = norm(value).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const y = eraYear(m[1], m[2]);
  const mo = Number(m[3]);
  const d = Number(m[4]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;
}

function monthOrdinal(value = "") {
  const m = norm(value).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月/);
  if (!m) return null;
  const y = eraYear(m[1], m[2]);
  const mo = Number(m[3]);
  return y && mo >= 1 && mo <= 12 ? y * 12 + mo : null;
}

function plausible(value) {
  const date = ordinal(value);
  if (!date) return false;
  const qr = window.__vehicleCertificateQrPriority || {};
  const first = monthOrdinal(qr.firstRegistration || "");
  const expiry = ordinal(qr.inspectionExpiry || "");
  if (first) {
    const y = Math.floor(date / 10000);
    const mo = Math.floor((date % 10000) / 100);
    if (y * 12 + mo < first) return false;
  }
  if (expiry && date > expiry) return false;
  const now = new Date();
  return date <= (now.getFullYear() + 1) * 10000 + 1231;
}

function detailInput(labelText) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    if (norm(label.querySelector(":scope > span")?.textContent || "") !== norm(labelText)) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function setReactValue(input, value) {
  if (!(input instanceof HTMLInputElement) || !value || input.value === value) return;
  const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
  const props = key ? input[key] : null;
  if (typeof props?.onChange === "function") {
    props.onChange({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} });
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const previous = input.value;
  if (setter) setter.call(input, value); else input.value = value;
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function existingRaw() {
  const debug = [...document.querySelectorAll("details pre")]
    .map((node) => node.textContent || "")
    .find((text) => text.includes("【記録年月日 生OCR】")) || "";
  return debug.match(/【記録年月日 生OCR】\s*([^\n]*)/)?.[1]?.trim() || "";
}

function crop(source, box, mode = "normal", targetWidth = 2600) {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(8, targetWidth / sw));
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

  if (mode !== "normal") {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < image.data.length; p += 4) {
      const gray = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      const v = mode === "binary" ? (gray < 184 ? 0 : 255) : Math.max(0, Math.min(255, Math.round((gray - 128) * 2.0 + 150)));
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function targetedRead(file) {
  const prepared = await prepareDocumentImage(file, { maxSide: 3600, cropPaper: true, minPaperConfidence: 0.40 });
  const source = prepared.normalized;
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);
  const raws = [];
  const plans = [
    { name: "広域", box: [0.52, 0.035, 0.46, 0.125], psm: String(t.PSM?.SINGLE_BLOCK ?? "6") },
    { name: "中域", box: [0.58, 0.060, 0.40, 0.080], psm: String(t.PSM?.SINGLE_BLOCK ?? "6") },
    { name: "値欄", box: [0.62, 0.082, 0.34, 0.052], psm: String(t.PSM?.SINGLE_LINE ?? "7") },
  ];
  try {
    for (const plan of plans) {
      for (const mode of ["normal", "contrast", "binary"]) {
        const canvas = crop(source, plan.box, mode);
        try {
          await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: plan.psm, user_defined_dpi: "300" });
          const raw = norm((await worker.recognize(canvas)).data.text || "");
          if (raw) raws.push(`${plan.name}/${mode}: ${raw}`);
          const value = parseDate(raw);
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
    source.width = 1;
    source.height = 1;
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
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      startedAt = Date.now();
      sawProgress = false;
      running = false;
      token += 1;
    };

    const timer = window.setInterval(async () => {
      if (!pending || running) return;
      if (document.querySelector(".progress")) {
        sawProgress = true;
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (sawProgress && elapsed < 2500) return;
      if (!sawProgress && elapsed < 12000) return;

      const input = detailInput("記録年月日");
      const current = input?.value || "";
      const currentValue = parseDate(current);
      if (currentValue && plausible(currentValue)) {
        pending = null;
        showDebug("既存値", current, currentValue);
        return;
      }

      const qrValue = parseDate(window.__vehicleCertificateQrPriority?.recordDate || "");
      if (qrValue && plausible(qrValue)) {
        if (input) setReactValue(input, qrValue);
        pending = null;
        showDebug("QR", current, qrValue);
        return;
      }

      const raw = existingRaw();
      const parsed = parseDate(raw);
      if (parsed && plausible(parsed)) {
        if (input) setReactValue(input, parsed);
        pending = null;
        showDebug("既存OCR再解析", current, parsed, [raw]);
        return;
      }

      const file = pending;
      const myToken = token;
      pending = null;
      running = true;
      try {
        const result = await targetedRead(file);
        if (myToken !== token) return;
        const latest = detailInput("記録年月日");
        const before = latest?.value || current;
        if (result.value && latest) setReactValue(latest, result.value);
        showDebug("右上欄のみ再読取", before, result.value || "", result.raws);
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
