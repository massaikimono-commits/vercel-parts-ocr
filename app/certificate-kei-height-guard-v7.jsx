"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-kei-height-guard-v7-debug";
const norm = (v = "") => String(v).normalize("NFKC").replace(/[\t\u3000]+/g, " ").replace(/ {2,}/g, " ").trim();

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
  if (!(input instanceof HTMLInputElement) || input.value === next) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const previous = input.value;
  setter?.call(input, next);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  return Boolean(node.closest("section.card")?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}
function isKei() {
  return norm(fieldInput("自動車の種別")?.value || window.__vehicleCertificateQrPriority?.vehicleClass || "") === "軽自動車";
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
    box.style.border = "1px solid #69a985";
    box.style.borderRadius = "12px";
    box.style.background = "#f0fdf4";
    box.innerHTML = '<summary style="font-weight:800">軽自動車 高さガード v7（確認用）</summary><div data-height-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-height-status]");
  if (node) node.textContent = text;
}
function process(ctx, width, height, mode) {
  if (mode === "raw") return;
  const image = ctx.getImageData(0, 0, width, height);
  let sum = 0;
  for (let p = 0; p < image.data.length; p += 4) {
    const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
    image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    sum += g;
  }
  const avg = sum / Math.max(1, image.data.length / 4);
  for (let p = 0; p < image.data.length; p += 4) {
    const g = image.data[p];
    const v = mode === "binary"
      ? (g < Math.max(120, Math.min(205, avg - 14)) ? 0 : 255)
      : Math.max(0, Math.min(255, Math.round((g - 128) * 1.75 + 155)));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
function crop(source, [x, y, w, h], mode = "raw", targetWidth = 900) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(12, targetWidth / Math.max(1, sw)));
  const pad = 20;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  process(ctx, c.width, c.height, mode);
  return c;
}
function composite(canvases) {
  const width = Math.max(...canvases.map((c) => c.width));
  const gap = 28;
  const height = canvases.reduce((s, c) => s + c.height, 0) + gap * Math.max(0, canvases.length - 1);
  const out = document.createElement("canvas");
  out.width = width; out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height + gap; }
  return out;
}
function candidates(raw = "", widthValue = 0) {
  const out = [];
  for (const token of norm(raw).match(/\d{3,4}/g) || []) {
    const windows = token.length === 3 ? [token] : [token.slice(0, 3), token.slice(-3)];
    for (const s of windows) {
      const n = Number(s);
      if (n >= 100 && n <= 200 && (!widthValue || n !== widthValue)) out.push(n);
    }
  }
  return out;
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

export default function CertificateKeiHeightGuardV7() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, startedAt = 0, generation = 0, running = false, stopped = false, locked = "";

    const enforce = () => {
      if (!isKei()) return;
      const input = fieldInput("高さ cm");
      if (!input) return;
      const n = Number(norm(input.value || ""));
      if (locked) {
        if (input.value !== locked) setReactInputValue(input, locked);
        return;
      }
      if (Number.isFinite(n) && (n < 100 || n > 200)) setReactInputValue(input, "");
    };
    const onAuthoritative = () => window.setTimeout(enforce, 0);
    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; startedAt = Date.now(); generation += 1; running = false; locked = "";
      showStatus("v16完了後、右端の高さ値セルだけを1pass確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      enforce();
      const elapsed = Date.now() - startedAt;
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debugText.includes("v16 完了") && elapsed < 14000) return;
      if (!isKei()) { pending = null; showStatus("軽自動車以外 → 高さ専用ガードを省略"); return; }

      const qrHeight = Number(norm(window.__vehicleCertificateQrPriority?.heightCm || ""));
      if (qrHeight >= 100 && qrHeight <= 200) {
        locked = String(qrHeight);
        setReactInputValue(fieldInput("高さ cm"), locked);
        pending = null;
        showStatus(`QR高さ ${locked}cm を採用 → OCR省略`);
        return;
      }

      running = true;
      const file = pending, mine = generation;
      const begun = performance.now();
      let session = null, combo = null;
      const parts = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2250, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;

        // 右端「高さ」の値欄だけ。少しずつ異なる3窓を1枚に積み、recognizeは1回だけ。
        const boxes = [
          [0.895, 0.462, 0.100, 0.045],
          [0.910, 0.468, 0.085, 0.038],
          [0.922, 0.472, 0.073, 0.032],
        ];
        parts.push(crop(source, boxes[0], "raw"));
        parts.push(crop(source, boxes[1], "contrast"));
        parts.push(crop(source, boxes[2], "binary"));
        combo = composite(parts);

        await worker.setParameters({
          tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11),
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
          tessedit_char_whitelist: "0123456789",
        });
        const result = await worker.recognize(combo);
        const raw = norm(result?.data?.text || "");
        const confidence = Number(result?.data?.confidence || 0);
        const widthValue = Number(norm(fieldInput("幅 cm")?.value || ""));
        const values = candidates(raw, widthValue);
        const counts = new Map();
        for (const n of values) counts.set(n, (counts.get(n) || 0) + 1);
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const height = ranked[0]?.[0] || 0;

        if (!height) {
          setReactInputValue(fieldInput("高さ cm"), "");
          pending = null;
          showStatus(`高さ未確定 / ${Math.round(performance.now() - begun)}ms / 1pass / OCR=${raw || "空"} / conf=${confidence.toFixed(1)} → 空欄維持`);
          return;
        }

        locked = String(height);
        setReactInputValue(fieldInput("高さ cm"), locked);
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { heightCm: locked } }));
        pending = null;
        showStatus(`高さ ${height}cm 採用・ロック ✓ / ${Math.round(performance.now() - begun)}ms / 1pass / 候補=${ranked.map(([n,c]) => `${n}x${c}`).join(",")} / OCR=${raw || "空"}`);
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`高さガードエラー: ${error?.message || error}`);
      } finally {
        for (const c of parts) { c.width = 1; c.height = 1; }
        if (combo) { combo.width = 1; combo.height = 1; }
        releaseSession(session); running = false;
      }
    }, 260);

    document.addEventListener("change", onChange, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    return () => {
      stopped = true; generation += 1; window.clearInterval(timer);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative);
    };
  }, []);
  return null;
}
