"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-kei-height-guard-v2-debug";

const norm = (value = "") => String(value).normalize("NFKC").replace(/[\t\u3000]+/g, " ").replace(/ {2,}/g, " ").trim();

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
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, next);
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
    box.style.border = "1px solid #69a985";
    box.style.borderRadius = "12px";
    box.style.background = "#f0fdf4";
    box.innerHTML = '<summary style="font-weight:800">軽自動車 高さガード v2（確認用）</summary><div data-height-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-height-status]");
  if (node) node.textContent = text;
}

function crop(source, region, targetWidth = 1400) {
  const [x, y, w, h] = region;
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(4, targetWidth / Math.max(1, sw)));
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

function isKei() {
  const value = norm(fieldInput("自動車の種別")?.value || window.__vehicleCertificateQrPriority?.vehicleClass || "");
  return value === "軽自動車";
}

function readHeight() {
  const n = Number(norm(fieldInput("高さ cm")?.value || ""));
  return Number.isFinite(n) ? n : 0;
}

export default function CertificateKeiHeightGuardV2() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pendingFile = null;
    let startedAt = 0;
    let generation = 0;
    let running = false;
    let stopped = false;
    let lockedHeight = "";

    const enforce = () => {
      if (!isKei()) return;
      const input = fieldInput("高さ cm");
      if (!input) return;
      const now = Number(norm(input.value || ""));
      if (lockedHeight) {
        if (input.value !== lockedHeight) setReactInputValue(input, lockedHeight);
        return;
      }
      if (Number.isFinite(now) && now > 200) {
        setReactInputValue(input, "");
        showStatus(`高さ ${now}cm は軽自動車として不正 → 採用せず再読取待ち`);
      }
    };

    const onAuthoritative = () => window.setTimeout(enforce, 0);

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pendingFile = file;
      startedAt = Date.now();
      generation += 1;
      running = false;
      lockedHeight = "";
      showStatus("v16完了後、軽自動車の高さだけ安全確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pendingFile) return;
      enforce();
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      const elapsed = Date.now() - startedAt;
      if (!debugText.includes("v16 完了") && elapsed < 16000) return;
      if (!isKei()) {
        showStatus("軽自動車以外なので高さガードは省略");
        pendingFile = null;
        return;
      }

      const currentHeight = readHeight();
      if (currentHeight >= 100 && currentHeight <= 200) {
        lockedHeight = String(currentHeight);
        showStatus(`高さ ${currentHeight}cm は有効範囲 → ロック`);
        pendingFile = null;
        return;
      }

      running = true;
      const file = pendingFile;
      const mine = generation;
      showStatus(`高さ ${currentHeight || "空欄"}cm → 高さ列だけ1pass再読取中…`);
      let session = null;
      let canvas = null;
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2050, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker;
        const t = shared.tesseract;

        // v16の数値帯より縦を狭くし、幅147・高さ178の行だけを見る。後軸340の行は入れない。
        canvas = crop(source, [0.70, 0.482, 0.28, 0.048], 1500);
        await worker.setParameters({
          tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11),
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
          tessedit_char_whitelist: "0123456789 cmCM",
        });
        const result = await worker.recognize(canvas);
        const text = norm(result?.data?.text || "");
        const confidence = Number(result?.data?.confidence || 0);
        const values = (text.match(/\d{3}/g) || []).map(Number);
        const width = Number(norm(fieldInput("幅 cm")?.value || ""));
        const candidates = values.filter((n) => n >= 120 && n <= 200 && n !== width);
        const height = candidates.length ? candidates[candidates.length - 1] : 0;

        if (!height) {
          setReactInputValue(fieldInput("高さ cm"), "");
          showStatus(`高さ未確定 / conf=${confidence.toFixed(1)} / OCR=${text || "空"} → 誤値は残さず空欄`);
          pendingFile = null;
          return;
        }

        lockedHeight = String(height);
        setReactInputValue(fieldInput("高さ cm"), lockedHeight);
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { heightCm: lockedHeight } }));
        window.setTimeout(enforce, 0);
        showStatus(`高さ ${height}cm 採用・ロック ✓ / conf=${confidence.toFixed(1)} / 追加1passのみ`);
        pendingFile = null;
      } catch (error) {
        if (!stopped && mine === generation) {
          enforce();
          showStatus(`高さガードエラー: ${error?.message || error}`);
        }
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        releaseSession(session);
        running = false;
      }
    }, 350);

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
