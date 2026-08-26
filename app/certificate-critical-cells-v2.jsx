"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-critical-cells-v2-debug";
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
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  return Boolean(node.closest("section.card")?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}
function isKei() {
  return norm(fieldInput("自動車の種別")?.value || window.__vehicleCertificateQrPriority?.vehicleClass || "") === "軽自動車";
}
function repair(raw = "") {
  return norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和|合和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss§]/g, "5").replace(/[Bb]/g, "8");
}
function fullDates(raw = "") {
  const out = [];
  const text = repair(raw);
  const patterns = [
    /(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*[日H]?/g,
    /(令和|平成|昭和)[^0-9元]{0,6}(元|\d{1,2})[^0-9]{0,5}(\d{1,2})[^0-9]{0,5}(\d{1,2})/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const mo = Number(m[3]), d = Number(m[4]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月${d}日`);
    }
  }
  return [...new Set(out)];
}
function firstRegistrationParts() {
  const raw = norm(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const m = raw.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  return m ? { era: m[1], year: m[2], month: Number(m[3]) } : null;
}
function recoverRegistrationFromEvidence(raw = "") {
  const first = firstRegistrationParts();
  if (!first) return "";
  const text = repair(raw);
  const direct = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*月\s*(\d{1,2})\s*[日H]?/);
  if (direct && direct[1] === first.era && String(direct[2]) === String(first.year)) {
    const d = Number(direct[3]);
    if (d >= 1 && d <= 31) return `${first.era}${first.year}年${first.month}月${d}日`;
  }

  const yearNum = first.year === "元" ? 1 : Number(first.year);
  const digitRuns = [...text.matchAll(/\d{1,2}/g)].map((m) => Number(m[0]));
  for (let i = 0; i + 2 < digitRuns.length; i++) {
    const y = digitRuns[i], mo = digitRuns[i + 1], d = digitRuns[i + 2];
    if (y === yearNum && mo === first.month && d >= 1 && d <= 31) return `${first.era}${first.year}年${first.month}月${d}日`;
  }
  return "";
}
function splitGroup(raw, label, nextLabel) {
  const upper = String(raw || "").toUpperCase();
  const start = upper.indexOf(label);
  if (start < 0) return "";
  const end = nextLabel ? upper.indexOf(nextLabel, start + label.length) : -1;
  return raw.slice(start + label.length, end >= 0 ? end : undefined);
}
function repairDigits(raw = "") {
  return String(raw).toUpperCase().replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/G/g, "6").replace(/B/g, "8");
}
function heightCandidate(raw = "") {
  const width = Number(norm(fieldInput("幅 cm")?.value || ""));
  const length = Number(norm(fieldInput("長さ cm")?.value || ""));
  const vals = [];
  for (const m of repairDigits(raw).matchAll(/\d{3,4}/g)) {
    const token = m[0];
    const candidates = token.length === 4 && token.endsWith("0") ? [Number(token.slice(0,3))] : [Number(token)];
    for (const n of candidates) if (n >= 100 && n <= 220 && n !== width && n !== length) vals.push(n);
  }
  if (!vals.length) return "";
  const counts = new Map();
  for (const n of vals) counts.set(n, (counts.get(n) || 0) + 1);
  const ranked = [...counts.entries()].sort((a,b) => b[1] - a[1]);
  return String(ranked[0][0]);
}
function process(ctx, width, height, mode = "raw") {
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
      ? (g < Math.max(120, Math.min(205, avg - 8)) ? 0 : 255)
      : Math.max(0, Math.min(255, Math.round((g - 128) * 1.9 + 168)));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
function crop(source, [x, y, w, h], mode = "raw", targetWidth = 1500) {
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
  process(ctx, c.width, c.height, mode);
  return c;
}
function labelledComposite(groups) {
  const gap = 26, header = 66;
  const width = Math.max(...groups.flatMap((g) => g.canvases.map((c) => c.width)), 1200);
  const height = groups.reduce((sum, g) => sum + header + g.canvases.reduce((s, c) => s + c.height + gap, 0), 0);
  const out = document.createElement("canvas"); out.width = width; out.height = height;
  const ctx = out.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000"; ctx.font = "bold 42px sans-serif";
  let y = 0;
  for (const g of groups) {
    ctx.fillText(g.label, 18, y + 46); y += header;
    for (const c of g.canvases) { ctx.drawImage(c, 0, y); y += c.height + gap; }
  }
  return out;
}
function showStatus(text) {
  const host = section("車検証から読み取る"); if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details"); box.id = DEBUG_ID; box.open = true;
    box.style.marginTop = "10px"; box.style.padding = "10px"; box.style.border = "1px solid #6aa0d8"; box.style.borderRadius = "12px"; box.style.background = "#eff6ff";
    box.innerHTML = '<summary style="font-weight:800">残り3セル統合 v2（確認用）</summary><div data-status style="margin-top:8px;font-weight:700"></div>';
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

export default function CertificateCriticalCellsV2() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, startedAt = 0, generation = 0, running = false, stopped = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; startedAt = Date.now(); generation += 1; running = false;
      showStatus("v16完了後、日付2セル＋寸法行を1passで最終確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debugText.includes("v16 完了") && elapsed < 14000) return;

      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const heightInput = fieldInput("高さ cm");
      const needRecord = !fullDates(recordInput?.value || "").length;
      const needReg = !fullDates(regInput?.value || "").length;
      const currentHeight = Number(norm(heightInput?.value || ""));
      const invalidKeiHeight = isKei() && !(currentHeight >= 100 && currentHeight <= 220);
      if (invalidKeiHeight && heightInput?.value) setReact(heightInput, "", true);
      const needHeight = isKei() && invalidKeiHeight;

      if (!needRecord && !needReg && !needHeight) {
        pending = null;
        showStatus("3セルとも取得済み → 追加OCR省略");
        return;
      }

      running = true;
      const file = pending, mine = generation, begun = performance.now();
      let session = null, combo = null;
      const all = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2800, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const groups = [];

        // 軽自動車検査証の上段「交付年月日」実セル。車台番号行を含めない。
        if (needReg) {
          const cs = [
            crop(source, [0.190, 0.118, 0.215, 0.048], "raw", 1750),
            crop(source, [0.190, 0.118, 0.215, 0.048], "contrast", 1750),
            crop(source, [0.205, 0.122, 0.195, 0.040], "binary", 1650),
          ];
          all.push(...cs); groups.push({ label: "REGDATE", canvases: cs });
        }

        // 右上の記録年月日セル全体。ラベルと日付を一緒に残し、3前処理を同一passへまとめる。
        if (needRecord) {
          const cs = [
            crop(source, [0.625, 0.004, 0.355, 0.055], "raw", 1900),
            crop(source, [0.625, 0.004, 0.355, 0.055], "contrast", 1900),
            crop(source, [0.650, 0.008, 0.325, 0.048], "binary", 1800),
          ];
          all.push(...cs); groups.push({ label: "RECDATE", canvases: cs });
        }

        // 寸法行の右半分だけ。次行の後軸340kgを絶対に含めない。
        if (needHeight) {
          const cs = [
            crop(source, [0.700, 0.456, 0.295, 0.044], "raw", 1800),
            crop(source, [0.700, 0.456, 0.295, 0.044], "contrast", 1800),
            crop(source, [0.735, 0.460, 0.255, 0.038], "binary", 1700),
          ];
          all.push(...cs); groups.push({ label: "HEIGHT", canvases: cs });
        }

        combo = labelledComposite(groups);
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;
        await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        const result = await worker.recognize(combo);
        const raw = norm(result?.data?.text || "");

        const order = groups.map((g) => g.label);
        const nextOf = (label) => {
          const i = order.indexOf(label);
          return i >= 0 && i + 1 < order.length ? order[i + 1] : "";
        };
        const regRaw = needReg ? splitGroup(raw, "REGDATE", nextOf("REGDATE")) : "";
        const recRaw = needRecord ? splitGroup(raw, "RECDATE", nextOf("RECDATE")) : "";
        const heightRaw = needHeight ? splitGroup(raw, "HEIGHT", nextOf("HEIGHT")) : "";

        const patch = {};
        if (needReg) patch.registrationDate = fullDates(regRaw)[0] || recoverRegistrationFromEvidence(regRaw);
        if (needRecord) patch.recordDate = fullDates(recRaw)[0] || "";
        if (needHeight) patch.heightCm = heightCandidate(heightRaw);
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
        showStatus(`1pass / ${Math.round(performance.now()-begun)}ms / 記録=${patch.recordDate || "保留"} / 交付=${patch.registrationDate || "保留"} / 高さ=${patch.heightCm || "保留"} / OCR=${raw || "空"}`);
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`統合セル読取エラー: ${error?.message || error}`);
      } finally {
        for (const c of all) { c.width = 1; c.height = 1; }
        if (combo) { combo.width = 1; combo.height = 1; }
        releaseSession(session);
        running = false;
      }
    }, 260);

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true; generation += 1;
      window.clearInterval(timer);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
