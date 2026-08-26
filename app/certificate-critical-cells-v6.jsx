"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-critical-cells-v6-debug";
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
function parseMonthReference(raw = "") {
  const m = norm(raw).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  if (!m) return null;
  const year = m[2] === "元" ? 1 : Number(m[2]);
  const month = Number(m[3]);
  return year >= 1 && month >= 1 && month <= 12 ? { era: m[1], year, month } : null;
}
function parseFullReference(raw = "") {
  const m = norm(raw).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  const year = m[2] === "元" ? 1 : Number(m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { era: m[1], year, month, day } : null;
}
function eraToGregorian(era, year) {
  if (era === "令和") return 2018 + year;
  if (era === "平成") return 1988 + year;
  if (era === "昭和") return 1925 + year;
  return 0;
}
function keyOf(p) {
  const y = eraToGregorian(p?.era, p?.year);
  return y ? y * 10000 + p.month * 100 + p.day : 0;
}
function formatDate(era, year, month, day) {
  if (!era || !(year >= 1) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return "";
  return `${era}${year === 1 ? "元" : year}年${month}月${day}日`;
}
function triplesFromLine(line = "") {
  const fixed = repairDigits(line).replace(/[^0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!fixed) return [];
  const tokens = fixed.split(" ").filter(Boolean);
  const out = [];
  const add = (year, month, day, strength = 1) => {
    if (year >= 1 && year <= 99 && month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ year, month, day, strength });
  };
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    if (tokens[i].length > 2 || tokens[i + 1].length > 2 || tokens[i + 2].length > 2) continue;
    add(Number(tokens[i]), Number(tokens[i + 1]), Number(tokens[i + 2]), 4);
  }
  for (const token of tokens) {
    if (token.length < 3 || token.length > 6) continue;
    for (let yl = 1; yl <= 2; yl += 1) {
      for (let ml = 1; ml <= 2; ml += 1) {
        const dl = token.length - yl - ml;
        if (dl < 1 || dl > 2) continue;
        add(Number(token.slice(0, yl)), Number(token.slice(yl, yl + ml)), Number(token.slice(yl + ml)), 2);
      }
    }
  }
  return out;
}
function collectTriples(raw = "") {
  const lines = String(raw).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const map = new Map();
  lines.forEach((line, lineIndex) => {
    for (const p of triplesFromLine(line)) {
      const k = `${p.year}/${p.month}/${p.day}`;
      const old = map.get(k) || { ...p, count: 0, bestStrength: 0, firstLine: lineIndex, sample: line };
      old.count += 1;
      old.bestStrength = Math.max(old.bestStrength, p.strength);
      old.firstLine = Math.min(old.firstLine, lineIndex);
      if (!old.sample) old.sample = line;
      map.set(k, old);
    }
  });
  return [...map.values()];
}
function chooseRegistrationDate(raw = "") {
  const first = parseMonthReference(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  if (!first) return "";
  const candidates = collectTriples(raw).filter((p) => p.year === first.year && p.month === first.month);
  if (!candidates.length) return "";
  candidates.sort((a, b) => (b.count * 10 + b.bestStrength) - (a.count * 10 + a.bestStrength));
  const top = candidates[0];
  const runner = candidates[1];
  if (runner && top.count === runner.count && top.bestStrength === runner.bestStrength && top.day !== runner.day) return "";
  return formatDate(first.era, top.year, top.month, top.day);
}
function chooseRecordDate(raw = "", registrationDate = "") {
  const expiry = parseFullReference(window.__vehicleCertificateQrPriority?.expiryDate || fieldInput("有効期間の満了する日")?.value || "");
  if (!expiry) return "";
  const reg = parseFullReference(registrationDate || fieldInput("登録年月日／交付年月日")?.value || "");
  const lower = reg ? keyOf(reg) : 0;
  const upper = keyOf(expiry);
  const scored = [];
  for (const p of collectTriples(raw)) {
    for (const era of ["令和", "平成", "昭和"]) {
      const candidate = { era, year: p.year, month: p.month, day: p.day };
      const key = keyOf(candidate);
      if (!key || key > upper || (lower && key <= lower)) continue;
      const gregYear = eraToGregorian(era, p.year);
      const expYear = eraToGregorian(expiry.era, expiry.year);
      const yearGap = expYear - gregYear;
      if (yearGap < 0 || yearGap > 6) continue;
      let score = p.count * 12 + p.bestStrength * 2;
      if (era === expiry.era) score += 20;
      score += Math.max(0, 12 - yearGap * 2);
      if (p.month === expiry.month) score += 8;
      if (Math.abs(p.day - expiry.day) <= 2) score += 5;
      score -= p.firstLine * 0.2;
      scored.push({ ...candidate, score, count: p.count });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return "";
  const top = scored[0];
  const runner = scored[1];
  if (runner && runner.score >= top.score - 2 && `${runner.era}/${runner.year}/${runner.month}/${runner.day}` !== `${top.era}/${top.year}/${top.month}/${top.day}`) return "";
  return formatDate(top.era, top.year, top.month, top.day);
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
function crop(source, [x, y, w, h], targetWidth = 2800) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(14, targetWidth / Math.max(1, sw)));
  const pad = 28;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  return c;
}
function stack(canvases) {
  const gap = 30;
  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((s, c) => s + c.height, 0) + gap * Math.max(0, canvases.length - 1);
  const out = document.createElement("canvas"); out.width = width; out.height = height;
  const ctx = out.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height + gap; }
  return out;
}
function showStatus(text) {
  const host = section("車検証から読み取る"); if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details"); box.id = DEBUG_ID; box.open = true;
    box.style.marginTop = "10px"; box.style.padding = "10px"; box.style.border = "1px solid #6aa0d8"; box.style.borderRadius = "12px"; box.style.background = "#eff6ff";
    box.innerHTML = '<summary style="font-weight:800">残り3セル上段スイープ v6（確認用）</summary><div data-status style="margin-top:8px;font-weight:700"></div>';
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

export default function CertificateCriticalCellsV6() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, startedAt = 0, generation = 0, running = false, stopped = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; startedAt = Date.now(); generation += 1; running = false;
      showStatus("v16完了後、上段を広めに読み日付候補を既取得値と照合します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debug = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debug.includes("v16 完了") && elapsed < 16000) return;

      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const heightInput = fieldInput("高さ cm");
      const needRecord = !parseFullReference(recordInput?.value || "");
      const needReg = !parseFullReference(regInput?.value || "");
      const currentHeight = Number(norm(heightInput?.value || ""));
      const needHeight = isKei() && !(currentHeight >= 100 && currentHeight <= 220);
      if (needHeight && heightInput?.value) setReact(heightInput, "", true);
      if (!needRecord && !needReg && !needHeight) { pending = null; showStatus("3項目取得済み → 追加OCR省略"); return; }

      running = true;
      const file = pending, mine = generation, begun = performance.now();
      let session = null; const made = [], combos = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 3200, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const v = session.prepared.variants;
        const contrast = v.contrast || session.prepared.normalized;
        const adaptive = v.adaptiveBinary || session.prepared.normalized;
        const original = v.original || session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;
        const patch = {};
        const notes = [];

        async function numericSweep(kind, specs) {
          const cs = specs.map(({ source, box, width }) => crop(source, box, width || 3000));
          made.push(...cs);
          const combo = stack(cs); combos.push(combo);
          await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "0123456789 " });
          const result = await worker.recognize(combo);
          const raw = String(result?.data?.text || "");
          notes.push(`${kind}OCR=${norm(raw).slice(0, 180) || "空"}`);
          return raw;
        }

        if (needReg) {
          const raw = await numericSweep("交付", [
            { source: contrast, box: [0.01, 0.055, 0.72, 0.235] },
            { source: adaptive, box: [0.01, 0.070, 0.72, 0.215] },
            { source: original, box: [0.03, 0.085, 0.68, 0.190] },
          ]);
          patch.registrationDate = chooseRegistrationDate(raw);
          notes.push(`交付=${patch.registrationDate || "保留"}`);
        }

        if (needRecord) {
          const raw = await numericSweep("記録", [
            { source: contrast, box: [0.34, 0.000, 0.66, 0.145] },
            { source: adaptive, box: [0.42, 0.000, 0.58, 0.145] },
            { source: original, box: [0.50, 0.000, 0.50, 0.155] },
          ]);
          patch.recordDate = chooseRecordDate(raw, patch.registrationDate || regInput?.value || "");
          notes.push(`記録=${patch.recordDate || "保留"}`);
        }

        if (needHeight) {
          const a = crop(contrast, [0.52, 0.472, 0.47, 0.105], 3000);
          const b = crop(adaptive, [0.58, 0.480, 0.41, 0.090], 3000);
          const c = crop(original, [0.62, 0.485, 0.37, 0.080], 3000);
          made.push(a, b, c);
          const combo = stack([a, b, c]); combos.push(combo);
          await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "0123456789 " });
          const result = await worker.recognize(combo);
          const raw = norm(result?.data?.text || "");
          patch.heightCm = heightFromDigits(raw);
          notes.push(`高さ=${patch.heightCm || "保留"} OCR=${raw.slice(0, 140) || "空"}`);
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
        const ms = Math.round(performance.now() - begun);
        showStatus(`完了 / ${ms}ms / ${notes.join(" / ")}`);
        pending = null;
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`v6読取エラー: ${error?.message || error}`);
      } finally {
        for (const c of made) { c.width = 1; c.height = 1; }
        for (const c of combos) { c.width = 1; c.height = 1; }
        releaseSession(session);
        running = false;
      }
    }, 260);

    document.addEventListener("change", onChange, true);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("change", onChange, true); };
  }, []);
  return null;
}
