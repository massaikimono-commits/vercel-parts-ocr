"use client";

import { useEffect } from "react";

const norm = (v = "") => String(v).normalize("NFKC").replace(/[‐‑‒–—―ー]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const compact = (v = "") => norm(v).replace(/\s+/g, "");
const numish = (v = "") => norm(v).replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss§]/g, "5").replace(/[Bb]/g, "8");

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) => s.querySelector("h2")?.textContent?.includes(title)) || null;
}

function input(title, label) {
  const s = section(title);
  if (!s) return null;
  for (const l of Array.from(s.querySelectorAll("label"))) {
    const t = (l.querySelector("span")?.textContent || l.childNodes[0]?.textContent || "").trim();
    if (compact(t) === compact(label)) return l.querySelector("input");
  }
  return null;
}

function setInput(el, value, allowEmpty = false) {
  if (!el || value == null || (!allowEmpty && !value) || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function getDebug() {
  return Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").find((x) => x.includes("【車検証 全体OCR】")) || "";
}

function globalText(debug) {
  const marker = "【車検証 全体OCR】";
  const i = debug.indexOf(marker);
  return i >= 0 ? debug.slice(i + marker.length) : debug;
}

function currentModel() {
  return input("車検証読み取り情報", "型式")?.value || input("基本情報", "型式")?.value || "";
}

function modelStem(model) {
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  const core = t.includes("-") ? t.split("-").pop() || "" : t;
  return core.match(/^([A-Z]{2,5}\d{1,4})/)?.[1] || "";
}

function regionFromContext(address = "") {
  const user = input("車検証読み取り情報", "使用者の氏名又は名称")?.value || "";
  for (const s0 of [address, user, globalText(getDebug())]) {
    const s = norm(s0);
    const branch = s.match(/([一-龠]{2,5})(?:支店|営業所|事業所)/)?.[1];
    if (branch) return branch;
    const city = s.match(/([一-龠]{2,5})市/)?.[1];
    if (city) return city;
  }
  return "";
}

function kanaFrom(text) {
  const a = norm(text).match(/[ぁ-ん]/g) || [];
  return a.find((x) => !/[あいうえお]/.test(x)) || a[0] || "";
}

function digitGroups(text) {
  return numish(text).match(/\d+/g) || [];
}

function parseRegistration(rowTexts, classTexts, kanaTexts, serialTexts, address = "") {
  const region = regionFromContext(address);
  const all = rowTexts.join(" ");
  const rowNums = digitGroups(all);
  const clsCandidates = [...classTexts.flatMap(digitGroups), ...rowNums].filter((x) => x.length >= 2 && x.length <= 3 && Number(x) >= 10 && Number(x) <= 999);
  const serialCandidates = [...serialTexts.flatMap(digitGroups), ...rowNums].filter((x) => x.length >= 3 && x.length <= 4);
  const cls = clsCandidates.find((x) => x.length === 3) || clsCandidates[0] || "";
  const serial = [...serialCandidates].reverse().find((x) => x.length === 4) || serialCandidates.at(-1) || "";
  const kana = kanaFrom([...kanaTexts, ...rowTexts].join(" "));
  if (!region || !cls || !kana || !serial) return "";
  return `${region} ${cls} ${kana} ${serial.padStart(4, "0")}`;
}

function parseChassis(texts, model) {
  const stem = modelStem(model);
  if (!stem) return "";
  const t = texts.map((x) => norm(x).toUpperCase().replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/\s+/g, "")).join(" ");
  const afterDash = Array.from(t.matchAll(/-([0-9]{5,10})/g)).map((m) => m[1]);
  const anyLong = digitGroups(t).filter((x) => x.length >= 6 && x.length <= 10);
  const serial = [...afterDash, ...anyLong].sort((a, b) => Math.abs(a.length - 7) - Math.abs(b.length - 7) || b.length - a.length)[0] || "";
  return serial ? `${stem}-${serial}` : "";
}

function era(text, fallback = "") {
  const t = norm(text).replace(/作\s*和|今\s*和|三\s*和|信\s*和|合\s*和|令\s*[禾ロ]/g, "令和").replace(/平\s*[或戊成陰]/g, "平成");
  if (/令和/.test(t)) return "令和";
  if (/平成/.test(t)) return "平成";
  if (/昭和/.test(t)) return "昭和";
  return fallback;
}

function dateValue(texts, { monthOnly = false, fallbackEra = "" } = {}) {
  const text = texts.join(" ");
  const e = era(text, fallbackEra);
  const nums = digitGroups(text).flatMap((s) => s.length <= 2 ? [Number(s)] : s.length === 3 ? [Number(s), Number(s.slice(0, 2)), Number(s.slice(1))] : []).filter(Number.isFinite);
  for (let i = 0; i < nums.length; i++) {
    const y = nums[i];
    if (y < 1 || y > 64) continue;
    for (let j = i + 1; j < Math.min(nums.length, i + 4); j++) {
      const m = nums[j];
      if (m < 1 || m > 12) continue;
      if (monthOnly) return e ? `${e}${y}年${m}月` : "";
      for (let k = j + 1; k < Math.min(nums.length, j + 4); k++) {
        const d = nums[k];
        if (d >= 1 && d <= 31 && e) return `${e}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

function cleanAddress(text) {
  const candidates = norm(text).split(/\n+/).map((s) => s.replace(/使用者の住所/g, "").replace(/[［【\[(（].*$/g, "").replace(/([0-9])一([0-9])/g, "$1-$2").replace(/\s*-\s*/g, "-").replace(/\s+/g, "").replace(/[A-Za-z<>{}|_^~]{3,}/g, "").trim()).filter(Boolean);
  for (const s of candidates) {
    if (s.length >= 8 && s.length <= 60 && /[都道府県]/.test(s) && /[市区町村]/.test(s) && /\d/.test(s)) return s;
  }
  const joined = candidates.join("");
  if (joined.length >= 8 && joined.length <= 60 && /[都道府県]/.test(joined) && /[市区町村]/.test(joined) && /\d/.test(joined)) return joined;
  return "";
}

function parseBody(text) {
  const t = compact(text);
  for (const x of ["キャブオーバ", "ステーションワゴン", "ピックアップ", "ボンネット", "トラック", "ダンプ", "セダン", "箱型", "幌型", "バス", "バン"]) if (t.includes(x)) return x;
  if (/[バパハ]ン/.test(t)) return "バン";
  return "";
}

function baseLocation(debug) {
  const g = norm(globalText(debug));
  const i = g.indexOf("使用の本拠の位置");
  const around = i >= 0 ? g.slice(i, i + 180) : g;
  return /(?:[*＊※kK]\s*){2,}/.test(around) ? "***" : "";
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height, data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const paperish = (x, y) => { const p = (y * w + x) * 4, r = data[p], g = data[p + 1], b = data[p + 2], br = (r + g + b) / 3; return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90; };
  const ys = [];
  for (let y = 0; y < h; y += step) { let hit = 0, n = 0; for (let x = 0; x < w; x += step) { if (paperish(x, y)) hit++; n++; } if (hit / Math.max(1, n) > 0.25) ys.push(y); }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2), bottom = Math.min(h - 1, ys.at(-1) + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) { let hit = 0, n = 0; for (let y = top; y <= bottom; y += step) { if (paperish(x, y)) hit++; n++; } if (hit / Math.max(1, n) > 0.25) xs.push(x); }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2), right = Math.min(w - 1, xs.at(-1) + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

async function sourceFromImage(img) {
  if (!img.complete) await new Promise((resolve, reject) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", reject, { once: true }); });
  const c = document.createElement("canvas"), max = 4600, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.min(1, max / Math.max(iw, ih));
  c.width = Math.max(1, Math.round(iw * s)); c.height = Math.max(1, Math.round(ih * s));
  const x = c.getContext("2d", { willReadFrequently: true }); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); return c;
}

function crop(source, paper, box, binary = false, target = 2600) {
  const [x0, x1, y0, y1] = box, sx = Math.max(0, Math.round(paper.x + paper.w * x0)), sy = Math.max(0, Math.round(paper.y + paper.h * y0)), sw = Math.max(1, Math.round(paper.w * (x1 - x0))), sh = Math.max(1, Math.round(paper.h * (y1 - y0))), scale = Math.max(1, Math.min(8, target / sw)), pad = 24;
  const c = document.createElement("canvas"); c.width = Math.round(sw * scale) + pad * 2; c.height = Math.round(sh * scale) + pad * 2;
  const x = c.getContext("2d", { willReadFrequently: true }); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  const im = x.getImageData(0, 0, c.width, c.height); let min = 255, max = 0; const gray = new Uint8Array(c.width * c.height);
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) { const v = Math.round(im.data[p] * 0.22 + im.data[p + 1] * 0.70 + im.data[p + 2] * 0.08); gray[i] = v; min = Math.min(min, v); max = Math.max(max, v); }
  const span = Math.max(35, max - min);
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) { let v = Math.max(0, Math.min(255, Math.round(((gray[i] - min) * 255) / span))); if (binary) v = v > 165 ? 255 : 0; im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255; }
  x.putImageData(im, 0, 0); return c;
}

async function read(worker, source, paper, box, { psm = "7", whitelist = "" } = {}) {
  const out = [];
  for (const binary of [false, true]) {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: "1", tessedit_char_whitelist: whitelist });
    const r = await worker.recognize(crop(source, paper, box, binary)); out.push(norm(r?.data?.text || ""));
  }
  return out;
}

function ensureDebug(lines) {
  let d = Array.from(document.querySelectorAll("details")).find((x) => x.querySelector("summary")?.textContent?.includes("最終校正OCR"));
  if (!d) {
    const host = section("車検証から読み取る") || document.querySelector("main") || document.body;
    d = document.createElement("details"); d.style.marginTop = "12px"; d.style.padding = "14px"; d.style.border = "1px solid #d8e0ec"; d.style.borderRadius = "14px"; d.style.background = "white";
    const s = document.createElement("summary"); s.textContent = "▶ 最終校正OCR（確認用）"; s.style.fontWeight = "700";
    const pre = document.createElement("pre"); pre.style.whiteSpace = "pre-wrap"; pre.style.fontSize = "12px"; pre.style.marginTop = "12px";
    d.append(s, pre); host.appendChild(d);
  }
  const pre = d.querySelector("pre"); if (pre) pre.textContent = lines.join("\n");
}

async function extract(img, debug) {
  const source = await sourceFromImage(img), paper = detectPaper(source), t = await import("tesseract.js"), worker = await t.createWorker("jpn+eng", 1);
  const log = [`最終紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
  const R = async (name, box, opts = {}) => { const v = await read(worker, source, paper, box, opts); log.push(`【${name} 灰】 ${v[0] || "(空)"}`, `【${name} 白黒】 ${v[1] || "(空)"}`); return v; };
  try {
    const regRow = await R("登録番号行", [0.28, 0.58, 0.145, 0.180]);
    const regClass = await R("登録分類番号", [0.35, 0.43, 0.145, 0.180], { whitelist: "0123456789" });
    const regKana = await R("登録かな", [0.42, 0.48, 0.145, 0.180], { psm: "10" });
    const regSerial = await R("登録4桁", [0.46, 0.56, 0.145, 0.180], { whitelist: "0123456789" });
    const chassis = await R("車台番号行", [0.15, 0.52, 0.175, 0.205], { whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-" });
    const regDate = await R("登録年月日", [0.26, 0.45, 0.202, 0.232]);
    const firstDate = await R("初度登録", [0.47, 0.64, 0.202, 0.232]);
    const expiry = await R("有効期限", [0.68, 0.91, 0.202, 0.232]);
    const addressRaw = await R("使用者住所", [0.27, 0.76, 0.272, 0.307]);
    const bodyRaw = await R("車体形状", [0.14, 0.35, 0.422, 0.452]);

    const address = cleanAddress(addressRaw.join("\n"));
    const registrationNumber = parseRegistration(regRow, regClass, regKana, regSerial, address);
    const chassisNumber = parseChassis(chassis, currentModel());
    const registrationDate = dateValue(regDate, { fallbackEra: "令和" });
    const firstRegistration = dateValue(firstDate, { monthOnly: true, fallbackEra: "平成" });
    const record = input("車検証読み取り情報", "記録年月日")?.value || "";
    const inspectionExpiry = dateValue(expiry, { fallbackEra: era(record, "令和") });
    const bodyShape = parseBody(bodyRaw.join(" "));
    const base = baseLocation(debug);

    log.push(`【最終採用 登録番号】 ${registrationNumber || "未読"}`, `【最終採用 車台番号】 ${chassisNumber || "未読"}`, `【最終採用 登録年月日】 ${registrationDate || "未読"}`, `【最終採用 初度登録】 ${firstRegistration || "未読"}`, `【最終採用 有効期限】 ${inspectionExpiry || "未読"}`, `【最終採用 住所】 ${address || "未読"}`, `【最終採用 本拠地】 ${base || "未読"}`, `【最終採用 車体形状】 ${bodyShape || "未読"}`);
    ensureDebug(log);
    return { registrationNumber, chassisNumber, registrationDate, firstRegistration, inspectionExpiry, address, base, bodyShape };
  } finally { await worker.terminate().catch(() => {}); }
}

function apply(v) {
  const d = (label) => input("車検証読み取り情報", label), b = (label) => input("基本情報", label);
  setInput(d("自動車登録番号又は車両番号"), v.registrationNumber);
  setInput(d("車台番号"), v.chassisNumber);
  setInput(d("登録年月日／交付年月日"), v.registrationDate);
  setInput(d("初度登録年月"), v.firstRegistration);
  setInput(d("有効期間の満了する日"), v.inspectionExpiry);
  setInput(d("使用者の住所"), v.address);
  setInput(d("使用の本拠の位置"), v.base);
  setInput(d("車体の形状"), v.bodyShape);
  if (v.registrationNumber) { setInput(b("登録番号"), v.registrationNumber); const m = v.registrationNumber.match(/(\d{4})(?!.*\d)/); if (m) setInput(b("ナンバー下4桁"), m[1]); }
  setInput(b("車台番号"), v.chassisNumber); setInput(b("初度登録（和暦）"), v.firstRegistration);
}

export default function CertificateFinalCalibration() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let dead = false, running = false, lastKey = "";
    const run = async () => {
      if (dead || running) return;
      const debug = getDebug(), img = document.querySelector("img.preview");
      if (!debug || !img?.src) return;
      const key = `${img.src}|${debug.length}`; if (key === lastKey) return; lastKey = key; running = true;
      try { const v = await extract(img, debug); if (dead) return; apply(v); [700, 1800, 3500, 6500].forEach((ms) => setTimeout(() => { if (!dead) apply(v); }, ms)); }
      catch (e) { console.warn("certificate final calibration skipped", e); }
      finally { running = false; }
    };
    const obs = new MutationObserver(() => void run()); obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const id = setInterval(() => void run(), 1000); void run();
    return () => { dead = true; obs.disconnect(); clearInterval(id); };
  }, []);
  return null;
}
