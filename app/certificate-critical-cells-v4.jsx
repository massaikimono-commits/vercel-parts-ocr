"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-critical-cells-v4-debug";
const norm = (v = "") => String(v).normalize("NFKC").replace(/[‐‑‒–—―ー−]/g, "-").replace(/[\t\u3000]+/g, " ").replace(/ {2,}/g, " ").trim();

function section(title) {
  return [...document.querySelectorAll("section.card")].find((n) => n.querySelector("h2")?.textContent?.includes(title)) || null;
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
function setReact(input, value, allowEmpty = false) {
  if (!(input instanceof HTMLInputElement)) return;
  if (!allowEmpty && !value) return;
  if (input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const old = input.value;
  setter?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(old);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function isCertificateFileInput(node) {
  return node instanceof HTMLInputElement && node.type === "file" && Boolean(node.closest("section.card")?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}
function isKei() {
  return norm(fieldInput("自動車の種別")?.value || window.__vehicleCertificateQrPriority?.vehicleClass || "") === "軽自動車";
}
function repairDigits(raw = "") {
  return String(raw).toUpperCase().replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/G/g, "6").replace(/B/g, "8");
}
function repairDateText(raw = "") {
  return norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和|合和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和");
}
function fullDates(raw = "") {
  const text = repairDateText(raw);
  const out = [];
  const patterns = [
    /(令和|平成|昭和)\s*(元|[0-9OQDIL|SZBG]{1,2})\s*年?\s*([0-9OQDIL|SZBG]{1,2})\s*月?\s*([0-9OQDIL|SZBG]{1,2})\s*[日H]?/g,
    /(令和|平成|昭和)[^0-9元]{0,5}(元|[0-9OQDIL|SZBG]{1,2})[^0-9]{0,4}([0-9OQDIL|SZBG]{1,2})[^0-9]{0,4}([0-9OQDIL|SZBG]{1,2})/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const y = m[2] === "元" ? "元" : String(Number(repairDigits(m[2]).replace(/\D/g, "")));
      const mo = Number(repairDigits(m[3]).replace(/\D/g, ""));
      const d = Number(repairDigits(m[4]).replace(/\D/g, ""));
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y) out.push(`${m[1]}${y}年${mo}月${d}日`);
    }
  }
  return [...new Set(out)];
}
function firstRegistrationParts() {
  const raw = norm(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const m = raw.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  return m ? { era: m[1], year: m[2], month: Number(m[3]) } : null;
}
function registrationDateFromDigits(raw = "") {
  const first = firstRegistrationParts();
  if (!first) return "";
  const targetYear = first.year === "元" ? 1 : Number(first.year);
  const nums = (repairDigits(raw).match(/\d{1,2}/g) || []).map(Number);
  for (let i = 0; i + 2 < nums.length; i += 1) {
    const [y, mo, d] = [nums[i], nums[i + 1], nums[i + 2]];
    if (y === targetYear && mo === first.month && d >= 1 && d <= 31) return `${first.era}${first.year}年${first.month}月${d}日`;
  }
  const explicit = fullDates(raw).find((d) => d.startsWith(`${first.era}${first.year}年${first.month}月`));
  return explicit || "";
}
function recordDateFromText(raw = "", registrationDate = "") {
  const values = fullDates(raw).filter((d) => d !== registrationDate);
  return values.length === 1 ? values[0] : "";
}
function heightFromDigits(raw = "") {
  const width = Number(norm(fieldInput("幅 cm")?.value || ""));
  const length = Number(norm(fieldInput("長さ cm")?.value || ""));
  const front = Number(norm(fieldInput("前前軸重 kg")?.value || ""));
  const rear = Number(norm(fieldInput("後後軸重 kg")?.value || ""));
  const seq = [];
  for (const m of repairDigits(raw).matchAll(/\d{3,4}/g)) {
    const token = m[0];
    const n = token.length === 4 && token.endsWith("0") ? Number(token.slice(0, 3)) : Number(token);
    if (Number.isFinite(n)) seq.push(n);
  }
  if (width >= 100 && width <= 300) {
    for (let i = 0; i + 1 < seq.length; i += 1) {
      if (seq[i] !== width) continue;
      const n = seq[i + 1];
      if (n >= 100 && n <= 220 && n !== width && n !== length && n !== front && n !== rear) return String(n);
    }
  }
  const counts = new Map();
  for (const n of seq) {
    if (n < 100 || n > 220 || n === width || n === length || n === front || n === rear) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] >= 2 ? String(ranked[0][0]) : "";
}
function crop(source, [x, y, w, h], targetWidth = 2200) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(12, targetWidth / Math.max(1, sw)));
  const pad = 26;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  return c;
}
function composite(items) {
  const gap = 30, header = 72;
  const width = Math.max(1300, ...items.map((i) => i.canvas.width));
  const height = items.reduce((s, i) => s + header + i.canvas.height + gap, 0);
  const out = document.createElement("canvas"); out.width = width; out.height = height;
  const ctx = out.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000"; ctx.font = "bold 46px sans-serif";
  let y = 0;
  for (const item of items) {
    ctx.fillText(item.label, 20, y + 52); y += header;
    ctx.drawImage(item.canvas, 0, y); y += item.canvas.height + gap;
  }
  return out;
}
function split(raw, label, next) {
  const up = raw.toUpperCase();
  const s = up.indexOf(label);
  if (s < 0) return "";
  const e = next ? up.indexOf(next, s + label.length) : -1;
  return raw.slice(s + label.length, e >= 0 ? e : undefined);
}
function showStatus(text) {
  const host = section("車検証から読み取る"); if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details"); box.id = DEBUG_ID; box.open = true;
    box.style.marginTop = "10px"; box.style.padding = "10px"; box.style.border = "1px solid #6aa0d8"; box.style.borderRadius = "12px"; box.style.background = "#eff6ff";
    box.innerHTML = '<summary style="font-weight:800">残り3セル分離 v4（確認用）</summary><div data-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-status]"); if (node) node.textContent = text;
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

export default function CertificateCriticalCellsV4() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, startedAt = 0, generation = 0, running = false, stopped = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; startedAt = Date.now(); generation += 1; running = false;
      showStatus("v16完了後、日付系と高さを別プロファイルで確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debug = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debug.includes("v16 完了") && elapsed < 14000) return;

      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const heightInput = fieldInput("高さ cm");
      const needRecord = !fullDates(recordInput?.value || "").length;
      const needReg = !fullDates(regInput?.value || "").length;
      const currentHeight = Number(norm(heightInput?.value || ""));
      const needHeight = isKei() && !(currentHeight >= 100 && currentHeight <= 220);
      if (needHeight && heightInput?.value) setReact(heightInput, "", true);
      if (!needRecord && !needReg && !needHeight) { pending = null; showStatus("3項目取得済み → 追加OCR省略"); return; }

      running = true;
      const file = pending, mine = generation, begun = performance.now();
      let session = null, dateCombo = null, heightCombo = null; const made = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 3200, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const v = session.prepared.variants;
        const patch = {};
        const notes = [];
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;

        if (needReg || needRecord) {
          const items = [];
          if (needReg) {
            const a = crop(v.contrast || session.prepared.normalized, [0.10, 0.095, 0.43, 0.090], 2700);
            const b = crop(v.adaptiveBinary || session.prepared.normalized, [0.12, 0.105, 0.38, 0.072], 2700);
            made.push(a, b); items.push({ label: "REGDATE_A", canvas: a }, { label: "REGDATE_B", canvas: b });
          }
          if (needRecord) {
            const a = crop(v.contrast || session.prepared.normalized, [0.56, 0.000, 0.43, 0.085], 2800);
            const b = crop(v.adaptiveBinary || session.prepared.normalized, [0.61, 0.000, 0.37, 0.070], 2800);
            made.push(a, b); items.push({ label: "RECDATE_A", canvas: a }, { label: "RECDATE_B", canvas: b });
          }
          dateCombo = composite(items);
          await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "" });
          const result = await worker.recognize(dateCombo);
          const raw = norm(result?.data?.text || "");
          const order = items.map((i) => i.label);
          const nextOf = (label) => { const i = order.indexOf(label); return i >= 0 && i + 1 < order.length ? order[i + 1] : ""; };
          const regRaw = needReg ? `${split(raw, "REGDATE_A", nextOf("REGDATE_A"))} ${split(raw, "REGDATE_B", nextOf("REGDATE_B"))}` : "";
          const recRaw = needRecord ? `${split(raw, "RECDATE_A", nextOf("RECDATE_A"))} ${split(raw, "RECDATE_B", nextOf("RECDATE_B"))}` : "";
          if (needReg) patch.registrationDate = registrationDateFromDigits(regRaw);
          if (needRecord) patch.recordDate = recordDateFromText(recRaw, patch.registrationDate || "");
          notes.push(`日付OCR=${raw || "空"}`);
        }

        if (needHeight) {
          const a = crop(v.contrast || session.prepared.normalized, [0.52, 0.472, 0.47, 0.105], 3000);
          const b = crop(v.adaptiveBinary || session.prepared.normalized, [0.58, 0.480, 0.41, 0.090], 3000);
          const c = crop(v.original || session.prepared.normalized, [0.62, 0.485, 0.37, 0.080], 3000);
          made.push(a, b, c);
          heightCombo = composite([{ label: "DIM_A", canvas: a }, { label: "DIM_B", canvas: b }, { label: "DIM_C", canvas: c }]);
          await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "0123456789 " });
          const result = await worker.recognize(heightCombo);
          const raw = norm(result?.data?.text || "");
          patch.heightCm = heightFromDigits(raw);
          notes.push(`高さOCR=${raw || "空"}`);
        }

        for (const [key, value] of Object.entries(patch)) if (!value) delete patch[key];
        if (patch.registrationDate) setReact(regInput, patch.registrationDate);
        if (patch.recordDate) setReact(recordInput, patch.recordDate);
        if (patch.heightCm) setReact(heightInput, patch.heightCm);
        else if (needHeight) setReact(heightInput, "", true);

        if (Object.keys(patch).length) {
          window.__vehicleCertificateQrPriority = { ...(window.__vehicleCertificateQrPriority || {}), ...patch };
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
        }
        pending = null;
        showStatus(`完了 / ${Math.round(performance.now()-begun)}ms / 記録=${patch.recordDate || "保留"} / 交付=${patch.registrationDate || "保留"} / 高さ=${patch.heightCm || "保留"} / ${notes.join(" / ")}`);
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`v4読取エラー: ${error?.message || error}`);
      } finally {
        for (const c of made) { c.width = 1; c.height = 1; }
        if (dateCombo) { dateCombo.width = 1; dateCombo.height = 1; }
        if (heightCombo) { heightCombo.width = 1; heightCombo.height = 1; }
        releaseSession(session);
        running = false;
      }
    }, 260);

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true; generation += 1; window.clearInterval(timer);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
