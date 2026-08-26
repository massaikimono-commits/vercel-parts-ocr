"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-critical-cells-v3-debug";
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
function repair(raw = "") {
  return norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入|命和|合和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss§]/g, "5").replace(/[Bb]/g, "8");
}
function dates(raw = "") {
  const text = repair(raw);
  const out = [];
  for (const m of text.matchAll(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*[日H]?/g)) {
    const mo = Number(m[3]), d = Number(m[4]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月${d}日`);
  }
  return [...new Set(out)];
}
function firstRegParts() {
  const raw = norm(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const m = raw.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  return m ? { era: m[1], year: m[2], month: Number(m[3]) } : null;
}
function registrationDateCandidate(raw = "") {
  const all = dates(raw);
  const first = firstRegParts();
  if (first) {
    const prefix = `${first.era}${first.year}年${first.month}月`;
    const same = all.find((d) => d.startsWith(prefix));
    if (same) return same;
  }
  return all.length === 1 ? all[0] : "";
}
function recordDateCandidate(raw = "", registrationDate = "") {
  const all = dates(raw).filter((d) => d !== registrationDate);
  return all.length === 1 ? all[0] : "";
}
function repairDigits(raw = "") {
  return String(raw).toUpperCase().replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/G/g, "6").replace(/B/g, "8");
}
function heightCandidate(raw = "") {
  const width = Number(norm(fieldInput("幅 cm")?.value || ""));
  const length = Number(norm(fieldInput("長さ cm")?.value || ""));
  const front = Number(norm(fieldInput("前前軸重 kg")?.value || ""));
  const rear = Number(norm(fieldInput("後後軸重 kg")?.value || ""));
  const text = repairDigits(raw);
  const seq = [...text.matchAll(/\d{3,4}/g)].flatMap((m) => {
    const s = m[0];
    return s.length === 4 && s.endsWith("0") ? [Number(s.slice(0, 3))] : [Number(s)];
  });

  // 幅の直後に高さが並ぶ軽自動車検査証の寸法行を最優先。
  if (width >= 100 && width <= 300) {
    for (let i = 0; i < seq.length - 1; i++) {
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
function crop(source, [x, y, w, h], targetWidth = 1700) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(12, targetWidth / Math.max(1, sw)));
  const pad = 24;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  return c;
}
function composite(groups) {
  const gap = 24, head = 64;
  const width = Math.max(1200, ...groups.flatMap((g) => g.canvases.map((c) => c.width)));
  const height = groups.reduce((s, g) => s + head + g.canvases.reduce((a, c) => a + c.height + gap, 0), 0);
  const out = document.createElement("canvas"); out.width = width; out.height = height;
  const ctx = out.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000"; ctx.font = "bold 42px sans-serif";
  let y = 0;
  for (const g of groups) {
    ctx.fillText(g.label, 18, y + 46); y += head;
    for (const c of g.canvases) { ctx.drawImage(c, 0, y); y += c.height + gap; }
  }
  return out;
}
function split(raw, label, next) {
  const upper = raw.toUpperCase();
  const s = upper.indexOf(label);
  if (s < 0) return "";
  const e = next ? upper.indexOf(next, s + label.length) : -1;
  return raw.slice(s + label.length, e >= 0 ? e : undefined);
}
function showStatus(text) {
  const host = section("車検証から読み取る"); if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details"); box.id = DEBUG_ID; box.open = true;
    box.style.marginTop = "10px"; box.style.padding = "10px"; box.style.border = "1px solid #6aa0d8"; box.style.borderRadius = "12px"; box.style.background = "#eff6ff";
    box.innerHTML = '<summary style="font-weight:800">残り3セル統合 v3（確認用）</summary><div data-status style="margin-top:8px;font-weight:700"></div>';
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

export default function CertificateCriticalCellsV3() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, startedAt = 0, generation = 0, running = false, stopped = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; startedAt = Date.now(); generation += 1; running = false;
      showStatus("v16完了後、交付日・記録日・寸法行を1passで再校正します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debug = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debug.includes("v16 完了") && elapsed < 14000) return;

      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const heightInput = fieldInput("高さ cm");
      const needRecord = !dates(recordInput?.value || "").length;
      const needReg = !dates(regInput?.value || "").length;
      const h = Number(norm(heightInput?.value || ""));
      const needHeight = isKei() && !(h >= 100 && h <= 220);
      if (needHeight && heightInput?.value) setReact(heightInput, "", true);
      if (!needRecord && !needReg && !needHeight) { pending = null; showStatus("3セル取得済み → 追加OCR省略"); return; }

      running = true;
      const file = pending, mine = generation, begun = performance.now();
      let session = null, combo = null; const made = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 3000, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const v = session.prepared.variants;
        const groups = [];

        if (needReg) {
          const cs = [
            crop(v.original || session.prepared.normalized, [0.135, 0.112, 0.355, 0.065], 1850),
            crop(v.contrast || session.prepared.normalized, [0.150, 0.118, 0.325, 0.052], 1850),
            crop(v.adaptiveBinary || session.prepared.normalized, [0.175, 0.123, 0.290, 0.042], 1800),
          ];
          made.push(...cs); groups.push({ label: "REGDATE", canvases: cs });
        }
        if (needRecord) {
          const cs = [
            crop(v.original || session.prepared.normalized, [0.600, 0.000, 0.385, 0.090], 1950),
            crop(v.contrast || session.prepared.normalized, [0.620, 0.000, 0.360, 0.078], 1950),
            crop(v.adaptiveBinary || session.prepared.normalized, [0.640, 0.005, 0.335, 0.068], 1900),
          ];
          made.push(...cs); groups.push({ label: "RECDATE", canvases: cs });
        }
        if (needHeight) {
          const cs = [
            crop(v.original || session.prepared.normalized, [0.700, 0.482, 0.295, 0.038], 1900),
            crop(v.contrast || session.prepared.normalized, [0.735, 0.485, 0.260, 0.034], 1900),
            crop(v.adaptiveBinary || session.prepared.normalized, [0.790, 0.487, 0.205, 0.030], 1850),
          ];
          made.push(...cs); groups.push({ label: "HEIGHT", canvases: cs });
        }

        combo = composite(groups);
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;
        await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        const result = await worker.recognize(combo);
        const raw = norm(result?.data?.text || "");
        const order = groups.map((g) => g.label);
        const nextOf = (label) => { const i = order.indexOf(label); return i >= 0 && i + 1 < order.length ? order[i + 1] : ""; };
        const regRaw = needReg ? split(raw, "REGDATE", nextOf("REGDATE")) : "";
        const recRaw = needRecord ? split(raw, "RECDATE", nextOf("RECDATE")) : "";
        const heightRaw = needHeight ? split(raw, "HEIGHT", nextOf("HEIGHT")) : "";
        const patch = {};
        if (needReg) patch.registrationDate = registrationDateCandidate(regRaw);
        if (needRecord) patch.recordDate = recordDateCandidate(recRaw, patch.registrationDate || regInput?.value || "");
        if (needHeight) patch.heightCm = heightCandidate(heightRaw);
        for (const [k, value] of Object.entries(patch)) if (!value) delete patch[k];

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
        if (!stopped && mine === generation) showStatus(`v3読取エラー: ${error?.message || error}`);
      } finally {
        for (const c of made) { c.width = 1; c.height = 1; }
        if (combo) { combo.width = 1; combo.height = 1; }
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
