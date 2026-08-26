"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-missing-dates-v1-debug";
const norm = (v = "") => String(v).normalize("NFKC").replace(/[‐‑‒–—―ー−]/g, "-").replace(/[\t\u3000]+/g, " ").replace(/ {2,}/g, " ").trim();

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
function setReactInputValue(input, next) {
  if (!(input instanceof HTMLInputElement) || !next || input.value === next) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const previous = input.value;
  setter?.call(input, next);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}
function showStatus(text) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details");
    box.id = DEBUG_ID;
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.border = "1px solid #d9b45b";
    box.style.borderRadius = "12px";
    box.style.background = "#fffaf0";
    box.innerHTML = '<summary style="font-weight:800">空欄日付だけ補完 v1（確認用）</summary><div data-date-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-date-status]");
  if (node) node.textContent = text;
}
function crop(source, [x, y, w, h], targetWidth = 1900, binary = false) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(7, targetWidth / Math.max(1, sw)));
  const pad = 24;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  if (binary) {
    const im = ctx.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
      im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
      sum += g;
    }
    const th = Math.max(115, Math.min(215, sum / Math.max(1, im.data.length / 4) - 16));
    for (let p = 0; p < im.data.length; p += 4) {
      const v = im.data[p] < th ? 0 : 255;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }
  return c;
}
function parseDate(raw = "") {
  const text = norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss§]/g, "5").replace(/[Bb]/g, "8");
  const m = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const mo = Number(m[3]), d = Number(m[4]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月${d}日`;
}
function eraYear(era, y) {
  const n = y === "元" ? 1 : Number(y);
  return era === "令和" ? 2018 + n : era === "平成" ? 1988 + n : era === "昭和" ? 1925 + n : 0;
}
function dateOrdinal(v = "") {
  const m = norm(v).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return 0;
  return eraYear(m[1], m[2]) * 10000 + Number(m[3]) * 100 + Number(m[4]);
}
function plausibleRegistrationDate(v) {
  const n = dateOrdinal(v);
  if (!n) return false;
  const expiry = dateOrdinal(window.__vehicleCertificateQrPriority?.inspectionExpiry || fieldInput("有効期間の満了する日")?.value || "");
  if (expiry && n > expiry) return false;
  return true;
}
function releaseSession(session) {
  try {
    const seen = new Set();
    for (const c of [session?.prepared?.source, session?.prepared?.normalized, ...Object.values(session?.prepared?.variants || {})]) {
      if (!c || seen.has(c)) continue;
      seen.add(c); c.width = 1; c.height = 1;
    }
  } catch {}
}

export default function CertificateMissingDatesV1() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null;
    let generation = 0;
    let running = false;
    let stopped = false;
    let startedAt = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      generation += 1;
      running = false;
      startedAt = Date.now();
      showStatus("v16完了後、空欄の日付セルだけ確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debugText.includes("v16 完了") && elapsed < 18000) return;

      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const needRecord = !parseDate(recordInput?.value || "");
      const needReg = !parseDate(regInput?.value || "");
      if (!needRecord && !needReg) {
        showStatus("日付2項目とも取得済み → OCR省略");
        pending = null;
        return;
      }

      running = true;
      const file = pending;
      const mine = generation;
      let session = null;
      let passCount = 0;
      const patch = {};
      const notes = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2300, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker;
        const t = shared.tesseract;

        const readOne = async (regions, label) => {
          for (let i = 0; i < regions.length; i += 1) {
            const c = crop(source, regions[i], 1900, i === 1);
            try {
              await worker.setParameters({
                tessedit_pageseg_mode: String(t.PSM?.SINGLE_LINE ?? 7),
                preserve_interword_spaces: "1",
                user_defined_dpi: "300",
              });
              const r = await worker.recognize(c);
              passCount += 1;
              const raw = norm(r?.data?.text || "");
              const value = parseDate(raw);
              notes.push(`${label}${i + 1}: ${raw || "空"} => ${value || "保留"}`);
              if (value) return value;
            } finally { c.width = 1; c.height = 1; }
          }
          return "";
        };

        if (needRecord) {
          const value = await readOne([[0.60, 0.070, 0.34, 0.055], [0.57, 0.060, 0.39, 0.070]], "記録");
          if (value) patch.recordDate = value;
        }
        if (needReg) {
          const value = await readOne([[0.10, 0.205, 0.42, 0.060], [0.08, 0.190, 0.46, 0.080]], "交付");
          if (value && plausibleRegistrationDate(value)) patch.registrationDate = value;
        }

        if (patch.recordDate) setReactInputValue(recordInput, patch.recordDate);
        if (patch.registrationDate) setReactInputValue(regInput, patch.registrationDate);
        if (Object.keys(patch).length) window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
        showStatus(`日付補完完了 / ${passCount}pass / 記録=${patch.recordDate || "保留"} / 交付=${patch.registrationDate || "保留"} / ${notes.join(" | ")}`);
        pending = null;
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`日付補完エラー: ${error?.message || error}`);
      } finally {
        releaseSession(session);
        running = false;
      }
    }, 350);

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      generation += 1;
      window.clearInterval(timer);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
