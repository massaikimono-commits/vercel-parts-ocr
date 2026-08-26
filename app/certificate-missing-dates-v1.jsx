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
    box.innerHTML = '<summary style="font-weight:800">空欄日付だけ補完 v2（確認用）</summary><div data-date-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-date-status]");
  if (node) node.textContent = text;
}
function preprocess(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      gray[y * width + x] = g;
      sum += g;
    }
  }
  const rowDark = new Uint16Array(height);
  const colDark = new Uint16Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (gray[y * width + x] < 150) { rowDark[y] += 1; colDark[x] += 1; }
    }
  }
  const threshold = Math.max(120, Math.min(205, sum / Math.max(1, width * height) - 20));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const onGrid = rowDark[y] > width * .62 || colDark[x] > height * .72;
      const v = onGrid ? 255 : (gray[y * width + x] < threshold ? 0 : 255);
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
function crop(source, [x, y, w, h], targetWidth = 1800) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(8, targetWidth / Math.max(1, sw)));
  const pad = 26;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  preprocess(ctx, c.width, c.height);
  return c;
}
function composite(canvases) {
  const width = Math.max(...canvases.map((c) => c.width));
  const gap = 42;
  const height = canvases.reduce((sum, c) => sum + c.height, 0) + gap * Math.max(0, canvases.length - 1);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height + gap; }
  return out;
}
function repair(raw = "") {
  return norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和|合和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss§]/g, "5").replace(/[Bb]/g, "8");
}
function allDates(raw = "") {
  const text = repair(raw);
  const out = [];
  for (const m of text.matchAll(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*[日H]?/g)) {
    const mo = Number(m[3]), d = Number(m[4]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    out.push(`${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月${d}日`);
  }
  return [...new Set(out)];
}
function eraYear(era, y) {
  const n = y === "元" ? 1 : Number(y);
  return era === "令和" ? 2018 + n : era === "平成" ? 1988 + n : era === "昭和" ? 1925 + n : 0;
}
function ordinal(v = "") {
  const m = norm(v).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  return m ? eraYear(m[1], m[2]) * 10000 + Number(m[3]) * 100 + Number(m[4]) : 0;
}
function monthKey(v = "") {
  const m = norm(v).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月/);
  return m ? `${m[1]}:${m[2]}:${Number(m[3])}` : "";
}
function plausible(v) {
  const n = ordinal(v);
  if (!n) return false;
  const expiry = ordinal(window.__vehicleCertificateQrPriority?.inspectionExpiry || fieldInput("有効期間の満了する日")?.value || "");
  return !expiry || n <= expiry;
}
function chooseRegistration(values) {
  const expiry = norm(window.__vehicleCertificateQrPriority?.inspectionExpiry || fieldInput("有効期間の満了する日")?.value || "");
  const firstMonth = monthKey(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const filtered = values.filter((v) => plausible(v) && norm(v) !== expiry);
  return filtered.find((v) => firstMonth && monthKey(v) === firstMonth) || filtered[0] || "";
}
function chooseRecord(values) {
  const expiry = norm(window.__vehicleCertificateQrPriority?.inspectionExpiry || fieldInput("有効期間の満了する日")?.value || "");
  return values.filter((v) => plausible(v) && norm(v) !== expiry).sort((a, b) => ordinal(b) - ordinal(a))[0] || "";
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
      showStatus("v16完了後、空欄の日付セルだけ最大2passで確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debugText.includes("v16 完了") && elapsed < 18000) return;

      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const needRecord = !allDates(recordInput?.value || "").length;
      const needReg = !allDates(regInput?.value || "").length;
      if (!needRecord && !needReg) { showStatus("日付2項目とも取得済み → 追加OCRなし"); pending = null; return; }

      running = true;
      const file = pending;
      const mine = generation;
      let session = null;
      let passCount = 0;
      const patch = {};
      const notes = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2550, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker;
        const t = shared.tesseract;

        const readComposite = async (regions, label, chooser) => {
          const parts = regions.map((r) => crop(source, r));
          const combo = composite(parts);
          try {
            await worker.setParameters({
              tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11),
              preserve_interword_spaces: "1",
              user_defined_dpi: "300",
            });
            const result = await worker.recognize(combo);
            passCount += 1;
            const raw = norm(result?.data?.text || "");
            const values = allDates(raw);
            const value = chooser(values);
            notes.push(`${label}: ${raw || "空"} => ${value || "保留"}`);
            return value;
          } finally {
            for (const c of parts) { c.width = 1; c.height = 1; }
            combo.width = 1; combo.height = 1;
          }
        };

        if (needRecord) {
          const value = await readComposite([[0.60, 0.074, 0.36, 0.058], [0.62, 0.085, 0.32, 0.042]], "記録", chooseRecord);
          if (value) patch.recordDate = value;
        }
        if (needReg) {
          const value = await readComposite([[0.135, 0.198, 0.33, 0.060], [0.155, 0.212, 0.27, 0.040]], "交付", chooseRegistration);
          if (value) patch.registrationDate = value;
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
    }, 320);

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
