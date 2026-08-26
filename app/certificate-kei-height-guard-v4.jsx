"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-kei-height-guard-v4-debug";
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
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}
function isKei() {
  return norm(fieldInput("自動車の種別")?.value || window.__vehicleCertificateQrPriority?.vehicleClass || "") === "軽自動車";
}
function currentHeight() {
  const n = Number(norm(fieldInput("高さ cm")?.value || ""));
  return Number.isFinite(n) ? n : 0;
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
    box.innerHTML = '<summary style="font-weight:800">軽自動車 高さガード v5（確認用）</summary><div data-height-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-height-status]");
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
      if (gray[y * width + x] < 145) { rowDark[y] += 1; colDark[x] += 1; }
    }
  }
  const threshold = Math.max(118, Math.min(205, sum / Math.max(1, width * height) - 18));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const grid = rowDark[y] > width * .68 || colDark[x] > height * .78;
      const v = grid ? 255 : (gray[y * width + x] < threshold ? 0 : 255);
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
function crop(source, [x, y, w, h], targetWidth = 1350) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(9, targetWidth / Math.max(1, sw)));
  const pad = 28;
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
  const gap = 34;
  const height = canvases.reduce((s, c) => s + c.height, 0) + gap * Math.max(0, canvases.length - 1);
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
function releaseSession(session) {
  try {
    const seen = new Set();
    for (const c of [session?.prepared?.source, session?.prepared?.normalized, ...Object.values(session?.prepared?.variants || {})]) {
      if (!c || seen.has(c)) continue;
      seen.add(c); c.width = 1; c.height = 1;
    }
  } catch {}
}

export default function CertificateKeiHeightGuardV4() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null;
    let startedAt = 0;
    let generation = 0;
    let running = false;
    let stopped = false;
    let locked = "";

    const enforce = () => {
      if (!isKei()) return;
      const input = fieldInput("高さ cm");
      if (!input) return;
      const n = Number(norm(input.value || ""));
      if (locked) {
        if (input.value !== locked) setReactInputValue(input, locked);
        return;
      }
      if (Number.isFinite(n) && n > 200) setReactInputValue(input, "");
    };
    const onAuthoritative = () => window.setTimeout(enforce, 0);
    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      startedAt = Date.now();
      generation += 1;
      running = false;
      locked = "";
      showStatus("v16完了後、右端の高さセルだけ1pass確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      enforce();
      const elapsed = Date.now() - startedAt;
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debugText.includes("v16 完了") && elapsed < 18000) return;
      if (!isKei()) { pending = null; showStatus("軽自動車以外 → 高さ再読取を省略"); return; }

      const h = currentHeight();
      if (h >= 100 && h <= 200) {
        locked = String(h);
        pending = null;
        showStatus(`高さ ${h}cm は有効 → 追加OCRなし`);
        return;
      }

      running = true;
      const file = pending;
      const mine = generation;
      let session = null;
      let combo = null;
      const parts = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2450, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker;
        const t = shared.tesseract;

        // 幅147や後軸340を巻き込まないよう、右端の高さセルだけを縦に少しずらして1枚へ合成。
        const regions = [
          [0.815, 0.482, 0.175, 0.050],
          [0.815, 0.496, 0.175, 0.050],
          [0.815, 0.510, 0.175, 0.050],
        ];
        for (const r of regions) parts.push(crop(source, r));
        combo = composite(parts);

        await worker.setParameters({
          tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11),
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
          tessedit_char_whitelist: "0123456789",
        });
        const result = await worker.recognize(combo);
        const text = norm(result?.data?.text || "");
        const confidence = Number(result?.data?.confidence || 0);
        const width = Number(norm(fieldInput("幅 cm")?.value || ""));
        const values = (text.match(/\d{3}/g) || []).map(Number).filter((n) => n >= 100 && n <= 200 && (!width || n !== width));
        const counts = new Map();
        for (const n of values) counts.set(n, (counts.get(n) || 0) + 1);
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const height = ranked[0]?.[0] || 0;

        if (!height) {
          setReactInputValue(fieldInput("高さ cm"), "");
          pending = null;
          showStatus(`高さ未確定 / 1pass / OCR=${text || "空"} / conf=${confidence.toFixed(1)} → 空欄維持`);
          return;
        }

        locked = String(height);
        setReactInputValue(fieldInput("高さ cm"), locked);
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { heightCm: locked } }));
        pending = null;
        showStatus(`高さ ${height}cm 採用・ロック ✓ / 1pass / OCR=${text || "空"}`);
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`高さガードエラー: ${error?.message || error}`);
      } finally {
        for (const c of parts) { c.width = 1; c.height = 1; }
        if (combo) { combo.width = 1; combo.height = 1; }
        releaseSession(session);
        running = false;
      }
    }, 300);

    document.addEventListener("change", onChange, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    return () => {
      stopped = true;
      generation += 1;
      window.clearInterval(timer);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative);
    };
  }, []);
  return null;
}
