"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-missing-dates-v5-debug";
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
  return Boolean(node.closest("section.card")?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
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
    box.innerHTML = '<summary style="font-weight:800">日付セル直読 v5（確認用）</summary><div data-date-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-date-status]");
  if (node) node.textContent = text;
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
function monthKey(v = "") {
  const m = norm(v).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月/);
  return m ? `${m[1]}:${m[2]}:${Number(m[3])}` : "";
}
function eraYear(era, y) {
  const n = y === "元" ? 1 : Number(y);
  return era === "令和" ? 2018 + n : era === "平成" ? 1988 + n : era === "昭和" ? 1925 + n : 0;
}
function ordinal(v = "") {
  const m = norm(v).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  return m ? eraYear(m[1], m[2]) * 10000 + Number(m[3]) * 100 + Number(m[4]) : 0;
}
function chooseRegistration(values) {
  const expiry = norm(window.__vehicleCertificateQrPriority?.inspectionExpiry || fieldInput("有効期間の満了する日")?.value || "");
  const firstMonth = monthKey(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const valid = [...new Set(values)].filter((v) => v !== expiry && ordinal(v) > 0);
  return valid.find((v) => firstMonth && monthKey(v) === firstMonth) || valid[0] || "";
}
function chooseRecord(values, registration) {
  const expiry = norm(window.__vehicleCertificateQrPriority?.inspectionExpiry || fieldInput("有効期間の満了する日")?.value || "");
  const valid = [...new Set(values)].filter((v) => v !== expiry && ordinal(v) > 0);
  const distinct = valid.filter((v) => v !== registration);
  return (distinct.length ? distinct : valid).sort((a, b) => ordinal(b) - ordinal(a))[0] || "";
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
    const v = Math.max(0, Math.min(255, Math.round((g - 128) * 1.8 + Math.min(178, avg))));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
function crop(source, [x, y, w, h], mode = "raw", targetWidth = 1200) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * h)));
  const scale = Math.max(1, Math.min(10, targetWidth / Math.max(1, sw)));
  const pad = 24;
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
  const gap = 34, header = 72;
  const width = Math.max(...groups.flatMap((g) => g.canvases.map((c) => c.width)), 1200);
  const total = groups.reduce((sum, g) => sum + header + g.canvases.reduce((s, c) => s + c.height + gap, 0), 0);
  const out = document.createElement("canvas");
  out.width = width; out.height = total;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, total);
  ctx.fillStyle = "#000"; ctx.font = "bold 46px sans-serif";
  let y = 0;
  for (const group of groups) {
    ctx.fillText(group.label, 18, y + 52); y += header;
    for (const c of group.canvases) { ctx.drawImage(c, 0, y); y += c.height + gap; }
  }
  return out;
}
function splitGroup(raw, label, nextLabel) {
  const upper = String(raw || "").toUpperCase();
  const start = upper.indexOf(label);
  if (start < 0) return "";
  const end = nextLabel ? upper.indexOf(nextLabel, start + label.length) : -1;
  return raw.slice(start + label.length, end >= 0 ? end : undefined);
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

export default function CertificateMissingDatesV5() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null, generation = 0, running = false, stopped = false, startedAt = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file; generation += 1; running = false; startedAt = Date.now();
      showStatus("v16完了後、校正済みの日付セルだけを1passで再確認します");
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      const elapsed = Date.now() - startedAt;
      const debugText = document.querySelector("#certificate-targeted-band-recovery-v16-debug pre")?.textContent || "";
      if (!debugText.includes("v16 完了") && elapsed < 14000) return;
      const recordInput = fieldInput("記録年月日");
      const regInput = fieldInput("登録年月日／交付年月日");
      const needRecord = !allDates(recordInput?.value || "").length;
      const needReg = !allDates(regInput?.value || "").length;
      if (!needRecord && !needReg) { pending = null; showStatus("日付2項目とも取得済み → OCR省略"); return; }

      running = true;
      const file = pending, mine = generation, begun = performance.now();
      let session = null, combo = null;
      const recCanvases = [], regCanvases = [];
      try {
        session = await createDocumentRecognitionSession(file, { maxSide: 2450, cropPaper: true, minPaperConfidence: 0.38 });
        if (stopped || mine !== generation) return;
        const source = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        const worker = shared.worker, t = shared.tesseract;

        // 登録/交付年月日は、過去に同じ帳票で正しく拾えていた校正済み位置を利用。
        if (needReg) {
          regCanvases.push(crop(source, [0.155, 0.214, 0.250, 0.032], "raw"));
          regCanvases.push(crop(source, [0.235, 0.194, 0.240, 0.045], "contrast"));
          regCanvases.push(crop(source, [0.160, 0.238, 0.260, 0.045], "raw"));
        }
        // 記録年月日は右上の小セル。広め/狭めの2窓を同じ1passへまとめる。
        if (needRecord) {
          recCanvases.push(crop(source, [0.58, 0.045, 0.38, 0.085], "raw"));
          recCanvases.push(crop(source, [0.735, 0.006, 0.205, 0.036], "contrast"));
        }

        const groups = [];
        if (needReg) groups.push({ label: "REGDATE", canvases: regCanvases });
        if (needRecord) groups.push({ label: "RECDATE", canvases: recCanvases });
        combo = labelledComposite(groups);
        await worker.setParameters({ tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? 11), preserve_interword_spaces: "1", user_defined_dpi: "300" });
        const result = await worker.recognize(combo);
        const raw = norm(result?.data?.text || "");
        const regRaw = needReg ? splitGroup(raw, "REGDATE", needRecord ? "RECDATE" : "") : "";
        const recRaw = needRecord ? splitGroup(raw, "RECDATE", "") : "";
        const fallbackDates = allDates(raw);
        const registration = needReg ? chooseRegistration(allDates(regRaw).length ? allDates(regRaw) : fallbackDates) : norm(regInput?.value || "");
        const record = needRecord ? chooseRecord(allDates(recRaw).length ? allDates(recRaw) : fallbackDates, registration) : norm(recordInput?.value || "");
        const patch = {};
        if (needReg && registration) patch.registrationDate = registration;
        if (needRecord && record) patch.recordDate = record;
        if (patch.registrationDate) setReactInputValue(regInput, patch.registrationDate);
        if (patch.recordDate) setReactInputValue(recordInput, patch.recordDate);
        if (Object.keys(patch).length) window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
        pending = null;
        showStatus(`1pass / ${Math.round(performance.now() - begun)}ms / 記録=${patch.recordDate || "保留"} / 交付=${patch.registrationDate || "保留"} / OCR=${raw || "空"}`);
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`日付セル直読エラー: ${error?.message || error}`);
      } finally {
        for (const c of [...regCanvases, ...recCanvases]) { c.width = 1; c.height = 1; }
        if (combo) { combo.width = 1; combo.height = 1; }
        releaseSession(session); running = false;
      }
    }, 260);

    document.addEventListener("change", onChange, true);
    return () => { stopped = true; generation += 1; window.clearInterval(timer); document.removeEventListener("change", onChange, true); };
  }, []);
  return null;
}
