"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-critical-cells-v5-debug";
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
      const y = m[2] === "元" ? 1 : Number(repairDigits(m[2]).replace(/\D/g, ""));
      const mo = Number(repairDigits(m[3]).replace(/\D/g, ""));
      const d = Number(repairDigits(m[4]).replace(/\D/g, ""));
      if (y >= 1 && y <= 99 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push({ era: m[1], year: y, month: mo, day: d });
    }
  }
  return dedupeParts(out);
}
function dedupeParts(items) {
  const seen = new Set();
  return items.filter((x) => {
    const k = `${x.era || ""}/${x.year}/${x.month}/${x.day}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
function numericDateParts(raw = "") {
  const fixed = repairDigits(raw);
  const out = [];
  const tokens = (fixed.match(/\d+/g) || []).map((s) => s.replace(/^0+(?=\d)/, ""));

  for (let i = 0; i + 2 < tokens.length; i += 1) {
    const y = Number(tokens[i]), m = Number(tokens[i + 1]), d = Number(tokens[i + 2]);
    if (y >= 1 && y <= 99 && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ year: y, month: m, day: d });
  }

  const compactCandidates = new Set(tokens.filter((s) => s.length >= 3 && s.length <= 6));
  const allCompact = fixed.replace(/\D/g, "");
  if (allCompact.length >= 3 && allCompact.length <= 8) compactCandidates.add(allCompact);
  for (const digits of compactCandidates) {
    for (let yl = 1; yl <= 2; yl += 1) {
      for (let ml = 1; ml <= 2; ml += 1) {
        const dl = digits.length - yl - ml;
        if (dl < 1 || dl > 2) continue;
        const y = Number(digits.slice(0, yl));
        const m = Number(digits.slice(yl, yl + ml));
        const d = Number(digits.slice(yl + ml));
        if (y >= 1 && y <= 99 && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ year: y, month: m, day: d });
      }
    }
  }

  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.year}/${x.month}/${x.day}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
function eraYearToGregorian(era, year) {
  if (era === "令和") return 2018 + year;
  if (era === "平成") return 1988 + year;
  if (era === "昭和") return 1925 + year;
  return 0;
}
function gregorianKey(era, year, month, day) {
  const y = eraYearToGregorian(era, year);
  if (!y) return 0;
  return y * 10000 + month * 100 + day;
}
function parseMonthReference(raw = "") {
  const text = repairDateText(raw);
  const m = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  if (!m) return null;
  const year = m[2] === "元" ? 1 : Number(m[2]);
  const month = Number(m[3]);
  if (!(year >= 1 && year <= 99 && month >= 1 && month <= 12)) return null;
  return { era: m[1], year, month, day: 1 };
}
function parseFullReference(raw = "") {
  return fullDates(raw)[0] || null;
}
function inferEra(parts, textRaw = "") {
  const repaired = repairDateText(textRaw);
  const explicitEra = ["令和", "平成", "昭和"].find((era) => repaired.includes(era));
  if (explicitEra) return explicitEra;

  const first = parseMonthReference(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const expiry = parseFullReference(window.__vehicleCertificateQrPriority?.expiryDate || fieldInput("有効期間の満了する日")?.value || "");
  const lower = first ? gregorianKey(first.era, first.year, first.month, 1) : 0;
  const upper = expiry ? gregorianKey(expiry.era, expiry.year, expiry.month, expiry.day) : 99999999;
  const eras = ["令和", "平成", "昭和"];
  const plausible = eras.filter((era) => {
    const key = gregorianKey(era, parts.year, parts.month, parts.day);
    if (!key || key < lower || key > upper) return false;
    if (upper < 99999999 && upper - key > 200000) return false;
    return true;
  });
  return plausible.length === 1 ? plausible[0] : "";
}
function formatDate(parts, era) {
  if (!parts || !era) return "";
  return `${era}${parts.year === 1 ? "元" : parts.year}年${parts.month}月${parts.day}日`;
}
function dateCandidate(textRaw = "", digitRaw = "") {
  const direct = fullDates(textRaw);
  if (direct.length === 1) return formatDate(direct[0], direct[0].era);
  const parts = numericDateParts(digitRaw || textRaw);
  const candidates = [];
  for (const p of parts) {
    const era = inferEra(p, textRaw);
    if (era) candidates.push(formatDate(p, era));
  }
  return [...new Set(candidates)].length === 1 ? [...new Set(candidates)][0] : "";
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
function crop(source, [x, y, w, h], targetWidth = 2400) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(14, targetWidth / Math.max(1, sw)));
  const pad = 30;
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
  const gap = 24;
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
    box.innerHTML = '<summary style="font-weight:800">残り3セル分離 v5（確認用）</summary><div data-status style="margin-top:8px;font-weight:700"></div>';
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

export default function CertificateCriticalCellsV5() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, startedAt = 0, generation = 0, running = false, stopped = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; startedAt = Date.now(); generation += 1; running = false;
      showStatus("v16完了後、未取得の日付セルと高さセルだけを個別確認します");
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
      let session = null; const made = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 3200, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const v = session.prepared.variants;
        const source = v.original || session.prepared.normalized;
        const contrast = v.contrast || source;
        const binary = v.adaptiveBinary || contrast;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;
        const patch = {};
        const notes = [];

        async function readDate(kind, boxes) {
          const [textBox, digitBox] = boxes;
          const textCanvas = crop(contrast, textBox, 2500); made.push(textCanvas);
          await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SINGLE_LINE ?? 7), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "" });
          const textResult = await worker.recognize(textCanvas);
          const textRaw = norm(textResult?.data?.text || "");
          let value = dateCandidate(textRaw, "");
          let digitRaw = "";
          if (!value) {
            const digitCanvas = crop(binary, digitBox, 2700); made.push(digitCanvas);
            await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SINGLE_LINE ?? 7), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "0123456789 " });
            const digitResult = await worker.recognize(digitCanvas);
            digitRaw = norm(digitResult?.data?.text || "");
            value = dateCandidate(textRaw, digitRaw);
          }
          notes.push(`${kind}=${value || "保留"} text:${textRaw || "空"} num:${digitRaw || "-"}`);
          return value;
        }

        if (needReg) {
          patch.registrationDate = await readDate("交付", [
            [0.185, 0.102, 0.285, 0.055],
            [0.205, 0.108, 0.245, 0.045],
          ]);
        }
        if (needRecord) {
          patch.recordDate = await readDate("記録", [
            [0.625, 0.006, 0.320, 0.052],
            [0.655, 0.012, 0.275, 0.040],
          ]);
        }
        if (needHeight) {
          const a = crop(contrast, [0.52, 0.472, 0.47, 0.105], 3000);
          const b = crop(binary, [0.58, 0.480, 0.41, 0.090], 3000);
          const c = crop(source, [0.62, 0.485, 0.37, 0.080], 3000);
          made.push(a, b, c);
          const combo = stack([a, b, c]); made.push(combo);
          await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "0123456789 " });
          const result = await worker.recognize(combo);
          const raw = norm(result?.data?.text || "");
          patch.heightCm = heightFromDigits(raw);
          notes.push(`高さ=${patch.heightCm || "保留"} OCR:${raw || "空"}`);
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
        showStatus(`完了 / ${Math.round(performance.now() - begun)}ms / ${notes.join(" / ")}`);
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`v5読取エラー: ${error?.message || error}`);
      } finally {
        for (const c of made) { try { c.width = 1; c.height = 1; } catch {} }
        releaseSession(session);
        running = false;
      }
    }, 260);

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
