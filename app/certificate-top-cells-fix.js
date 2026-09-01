"use client";

import { useEffect } from "react";

const norm = (v = "") =>
  String(v)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const compact = (v = "") => norm(v).replace(/\s+/g, "");
const numish = (v = "") =>
  norm(v)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");

function section(title) {
  return (
    Array.from(document.querySelectorAll("section.card")).find((s) =>
      s.querySelector("h2")?.textContent?.includes(title)
    ) || null
  );
}

function input(title, label) {
  const s = section(title);
  if (!s) return null;
  for (const l of Array.from(s.querySelectorAll("label"))) {
    const t = (
      l.querySelector("span")?.textContent ||
      l.childNodes[0]?.textContent ||
      ""
    ).trim();
    if (compact(t) === compact(label)) return l.querySelector("input");
  }
  return null;
}

function setInput(el, value, allowEmpty = false) {
  if (!el || value == null || (!allowEmpty && !value) || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function globalText(debug) {
  const marker = "【車検証 全体OCR】";
  const i = debug.indexOf(marker);
  return i >= 0 ? debug.slice(i + marker.length) : debug;
}

function rawField(debug, label) {
  const a = `【${label} 生OCR】`;
  const b = `【${label} 採用】`;
  const i = debug.indexOf(a);
  if (i < 0) return "";
  const j = debug.indexOf(b, i + a.length);
  return debug.slice(i + a.length, j >= 0 ? j : undefined).trim();
}

function documentNumberFromDebug(debug) {
  const text = numish(globalText(debug));
  const exact = text.match(/(?<!\d)\d{12}(?!\d)/);
  if (exact) return exact[0];
  for (const raw of text.match(/(?:\d[\s\n]*){11,13}/g) || []) {
    const d = raw.replace(/\D/g, "");
    if (d.length === 12 && new Set(d).size >= 4) return d;
  }
  return "";
}

function modelValue() {
  return (
    input("車検証読み取り情報", "型式")?.value ||
    input("基本情報", "型式")?.value ||
    ""
  );
}

function modelStem(model) {
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  const core = t.includes("-") ? t.split("-").pop() || "" : t;
  return core.match(/^([A-Z]{2,5}\d{1,4})/)?.[1] || "";
}

function currentUserName() {
  return input("車検証読み取り情報", "使用者の氏名又は名称")?.value || "";
}

function regionFromContext(address = "") {
  const texts = [address, currentUserName(), globalTextFromPage()];
  for (const s0 of texts) {
    const s = norm(s0);
    const city = s.match(/([一-龠]{2,5})(?:市|区|町|村)/)?.[1] || "";
    if (city) return city;
    const branch = s.match(/([一-龠]{2,5})(?:支店|営業所|事業所)/)?.[1] || "";
    if (branch) return branch;
  }
  return "";
}

function globalTextFromPage() {
  return (
    Array.from(document.querySelectorAll("details pre"))
      .map((x) => x.textContent || "")
      .find((x) => x.includes("【車検証 全体OCR】")) || ""
  );
}

function kanaValue(text) {
  const a = norm(text).match(/[ぁ-ん]/g) || [];
  return a.find((x) => !/[あいうえお]/.test(x)) || a[0] || "";
}

function digitsOnly(text) {
  return numish(text).replace(/\D/g, "");
}

function chooseDigits(texts, minLen, maxLen, preferred = 0) {
  const out = [];
  for (const text of texts) {
    const direct = numish(text).match(/\d+/g) || [];
    for (const x of direct) {
      if (x.length >= minLen && x.length <= maxLen) out.push(x);
    }
    const d = digitsOnly(text);
    if (d.length >= minLen && d.length <= maxLen) out.push(d);
  }
  if (!out.length) return "";
  out.sort((a, b) => {
    const ap = preferred ? Math.abs(a.length - preferred) : 0;
    const bp = preferred ? Math.abs(b.length - preferred) : 0;
    return ap - bp || b.length - a.length;
  });
  return out[0];
}

function registrationValue(region, cls, kana, serial) {
  const c = chooseDigits([cls], 2, 3, 3);
  const s = chooseDigits([serial], 1, 4, 4);
  const k = kanaValue(kana);
  if (!region || !c || !k || !s) return "";
  return `${region} ${c} ${k} ${s.padStart(4, "0")}`;
}

function chassisValue(serialTexts, model) {
  const stem = modelStem(model);
  if (!stem) return "";
  let serial = chooseDigits(serialTexts, 6, 9, 7);
  if (!serial) return "";
  return `${stem}-${serial}`;
}

function eraFromText(text) {
  const t = norm(text)
    .replace(/作\s*和|今\s*和|三\s*和|信\s*和|合\s*和|令\s*[禾ロ]/g, "令和")
    .replace(/平\s*[或戊成陰]/g, "平成");
  if (/令和/.test(t)) return "令和";
  if (/平成/.test(t)) return "平成";
  if (/昭和/.test(t)) return "昭和";
  return "";
}

function numberTokens(text) {
  const raw = numish(text).match(/\d{1,4}/g) || [];
  const out = [];
  for (const s of raw) {
    out.push(Number(s));
    if (s.length === 3) {
      out.push(Number(s.slice(0, 2)));
      out.push(Number(s.slice(1)));
    }
  }
  return out.filter(Number.isFinite);
}

function looseDate(text, { monthOnly = false, eraHint = "", model = "" } = {}) {
  let era = eraFromText(text) || eraHint;
  const a = numberTokens(text);
  for (let i = 0; i < a.length; i++) {
    const y = a[i];
    if (y < 1 || y > 64) continue;
    for (let j = i + 1; j < Math.min(a.length, i + 4); j++) {
      const m = a[j];
      if (m < 1 || m > 12) continue;
      if (monthOnly) {
        if (!era) {
          if (y >= 10 && /^(TKG|QKG|PKG|SKG|LDA|DBA|DAA|CBA|ABA)-/i.test(norm(model))) era = "平成";
          else if (y <= 15) era = "令和";
        }
        if (era) return `${era}${y}年${m}月`;
        continue;
      }
      for (let k = j + 1; k < Math.min(a.length, j + 4); k++) {
        const d = a[k];
        if (d >= 1 && d <= 31 && era) return `${era}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

function dateFromDigitText(text, { monthOnly = false, era = "令和", model = "" } = {}) {
  const nums = (numish(text).match(/\d{1,2}/g) || []).map(Number).filter(Number.isFinite);
  if (monthOnly) {
    for (let i = 0; i + 1 < nums.length; i++) {
      const y = nums[i], m = nums[i + 1];
      if (y >= 1 && y <= 64 && m >= 1 && m <= 12) {
        let e = era;
        if (!e && y >= 10 && /^(TKG|QKG|PKG|SKG|LDA|DBA|DAA|CBA|ABA)-/i.test(norm(model))) e = "平成";
        if (e) return `${e}${y}年${m}月`;
      }
    }
    return "";
  }
  for (let i = 0; i + 2 < nums.length; i++) {
    const y = nums[i], m = nums[i + 1], d = nums[i + 2];
    if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31 && era) {
      return `${era}${y}年${m}月${d}日`;
    }
  }
  return "";
}

function cleanAddressLine(line0) {
  let line = norm(line0)
    .replace(/使用者の住所/g, "")
    .replace(/使[房用]者.*住所/g, "")
    .replace(/[［【\[(（].*$/g, "")
    .replace(/([0-9])一([0-9])/g, "$1-$2")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .replace(/[A-Za-z<>{}|_^~]{3,}/g, "")
    .trim();
  return line;
}

function address(text) {
  const lines = norm(text).split("\n");
  for (const line0 of lines) {
    const line = cleanAddressLine(line0);
    if (line.length >= 8 && line.length <= 70 && /[都道府県]/.test(line) && /[市区町村]/.test(line) && /\d/.test(line)) return line;
  }
  const joined = cleanAddressLine(lines.join(""));
  if (joined.length >= 8 && joined.length <= 70 && /[都道府県]/.test(joined) && /[市区町村]/.test(joined) && /\d/.test(joined)) return joined;
  return "";
}

function baseLocation(debug) {
  const g = norm(globalText(debug));
  const i = g.indexOf("使用の本拠の位置");
  const around = i >= 0 ? g.slice(i, i + 240) : g;
  if (/(?:[*＊※kK]\s*){2,}/.test(around)) return "***";
  const raw = rawField(debug, "使用の本拠の位置");
  if (/(?:[*＊※kK]\s*){2,}/.test(raw)) return "***";
  return "";
}

function bodyShape(text) {
  const t = compact(text);
  const choices = ["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","幌型","バス","バン"];
  for (const x of choices) if (t.includes(x)) return x;
  if (/[バパハ]ン/.test(t)) return "バン";
  return "";
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (paperish(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > 0.25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2), bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (paperish(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > 0.25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2), right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

async function buildSource(img) {
  if (!img.complete) await new Promise((resolve, reject) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", reject, { once: true }); });
  const c = document.createElement("canvas");
  const max = 4600;
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function makeCell(source, paper, x0, x1, y0, y1, { targetWidth = 2600, binary = false } = {}) {
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(10, targetWidth / sw));
  const pad = 34;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale)) + pad * 2;
  c.height = Math.max(1, Math.round(sh * scale)) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const gray = new Uint8Array(c.width * c.height);
  let min = 255, max = 0;
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const v = Math.round(im.data[p] * 0.22 + im.data[p + 1] * 0.70 + im.data[p + 2] * 0.08);
    gray[i] = v; if (v < min) min = v; if (v > max) max = v;
  }
  const span = Math.max(30, max - min);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, Math.round(((gray[i] - min) * 255) / span)));

  const rowDark = new Uint32Array(c.height), colDark = new Uint32Array(c.width);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (gray[y * c.width + x] < 105) { rowDark[y]++; colDark[x]++; }
  }
  for (let y = 0; y < c.height; y++) if (rowDark[y] / c.width > 0.56) {
    for (let yy = Math.max(0, y - 2); yy <= Math.min(c.height - 1, y + 2); yy++) for (let x = 0; x < c.width; x++) gray[yy * c.width + x] = 255;
  }
  for (let x = 0; x < c.width; x++) if (colDark[x] / c.height > 0.82) {
    for (let xx = Math.max(0, x - 2); xx <= Math.min(c.width - 1, x + 2); xx++) for (let y = 0; y < c.height; y++) gray[y * c.width + xx] = 255;
  }

  let threshold = 165;
  if (binary) {
    const hist = new Uint32Array(256); for (const v of gray) hist[v]++;
    const total = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = -1;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF;
      const score = wB * wF * (mB - mF) * (mB - mF); if (score > best) { best = score; threshold = i; }
    }
    threshold = Math.max(105, Math.min(205, threshold + 8));
  }
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const v = binary ? (gray[i] > threshold ? 255 : 0) : gray[i];
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); return c;
}

async function recognize(worker, canvas, psm = "7", whitelist = null) {
  const params = { tessedit_pageseg_mode: String(psm), preserve_interword_spaces: "1" };
  if (whitelist) params.tessedit_char_whitelist = whitelist;
  await worker.setParameters(params);
  const r = await worker.recognize(canvas);
  return norm(r?.data?.text || "");
}

function ensureDebug(values) {
  const card = section("車検証から読み取る");
  if (!card) return;
  let box = card.querySelector("details[data-precision-ocr]");
  if (!box) {
    box = document.createElement("details"); box.dataset.precisionOcr = "1";
    box.style.marginTop = "12px"; box.style.border = "1px solid #cfd8e6"; box.style.borderRadius = "12px"; box.style.padding = "12px";
    const summary = document.createElement("summary"); summary.textContent = "精密OCR詳細（残り項目）"; summary.style.fontWeight = "800";
    const pre = document.createElement("pre"); pre.style.whiteSpace = "pre-wrap"; pre.style.fontSize = "12px"; pre.style.overflowWrap = "anywhere";
    box.append(summary, pre); card.appendChild(box);
  }
  const pre = box.querySelector("pre"); if (pre) pre.textContent = values.join("\n");
}

async function extract(img, debug) {
  const source = await buildSource(img), paper = detectPaper(source), t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1);
  const logs = [`精密紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
  try {
    const general = async (name, box, psm = "7") => {
      const a = await recognize(worker, makeCell(source, paper, ...box, { targetWidth: 2800, binary: false }), psm);
      const b = await recognize(worker, makeCell(source, paper, box[0], box[1], box[2] + 0.004, box[3] + 0.004, { targetWidth: 2800, binary: true }), psm);
      logs.push(`【${name} 灰】 ${a || "(空)"}`, `【${name} 白黒】 ${b || "(空)"}`);
      return [a, b];
    };

    const regWhole = await general("登録番号行", [0.23, 0.55, 0.214, 0.239]);
    const regKana = await general("登録番号かな", [0.36, 0.43, 0.214, 0.239], "10");
    const regDateGeneral = await general("登録年月日", [0.245, 0.40, 0.260, 0.284]);
    const firstGeneral = await general("初度登録", [0.455, 0.59, 0.260, 0.284]);
    const expiryGeneral = await general("有効期限", [0.675, 0.835, 0.260, 0.284]);
    const addressGeneral = await general("住所", [0.215, 0.76, 0.330, 0.358], "6");
    const bodyGeneral = await general("車体形状", [0.16, 0.33, 0.454, 0.480]);

    const digit = async (name, box, psm = "7") => {
      const a = await recognize(worker, makeCell(source, paper, ...box, { targetWidth: 2600, binary: false }), psm, "0123456789");
      const b = await recognize(worker, makeCell(source, paper, box[0], box[1], box[2] + 0.004, box[3] + 0.004, { targetWidth: 2600, binary: true }), psm, "0123456789");
      logs.push(`【${name} 数字1】 ${a || "(空)"}`, `【${name} 数字2】 ${b || "(空)"}`);
      return [a, b];
    };

    const regClass = await digit("分類番号", [0.295, 0.365, 0.214, 0.239]);
    const regSerial = await digit("登録4桁", [0.405, 0.53, 0.214, 0.239]);
    const chassisSerial = await digit("車台末尾", [0.295, 0.47, 0.238, 0.262]);
    const regDateDigits = await digit("登録年月日数字", [0.245, 0.40, 0.260, 0.284]);
    const firstDigits = await digit("初度登録数字", [0.455, 0.59, 0.260, 0.284]);
    const expiryDigits = await digit("有効期限数字", [0.675, 0.835, 0.260, 0.284]);

    const model = modelValue();
    const record = input("車検証読み取り情報", "記録年月日")?.value || "";
    const recordEra = eraFromText(record) || "令和";
    const addr = address(addressGeneral.join("\n"));
    const region = regionFromContext(addr);
    const registrationNumber = registrationValue(region, regClass.join(" "), regKana.concat(regWhole).join(" "), regSerial.join(" "));
    const chassisNumber = chassisValue(chassisSerial, model);
    const registrationDate = looseDate(regDateGeneral.join(" "), { eraHint: "令和", model }) || dateFromDigitText(regDateDigits.join(" "), { era: "令和", model });
    const firstRegistration = looseDate(firstGeneral.join(" "), { monthOnly: true, model }) || dateFromDigitText(firstDigits.join(" "), { monthOnly: true, era: "平成", model });
    const inspectionExpiry = looseDate(expiryGeneral.join(" "), { eraHint: recordEra, model }) || dateFromDigitText(expiryDigits.join(" "), { era: "令和", model });
    const shape = bodyShape(bodyGeneral.join(" "));

    logs.push(
      `【精密採用 登録番号】 ${registrationNumber || "未読"}`,
      `【精密採用 車台番号】 ${chassisNumber || "未読"}`,
      `【精密採用 登録年月日】 ${registrationDate || "未読"}`,
      `【精密採用 初度登録】 ${firstRegistration || "未読"}`,
      `【精密採用 有効期限】 ${inspectionExpiry || "未読"}`,
      `【精密採用 住所】 ${addr || "未読"}`,
      `【精密採用 車体形状】 ${shape || "未読"}`
    );
    ensureDebug(logs);

    return { documentNumber: documentNumberFromDebug(debug), registrationNumber, chassisNumber, registrationDate, firstRegistration, inspectionExpiry, userAddress: addr, baseLocation: baseLocation(debug), bodyShape: shape };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

function apply(v) {
  const d = (label) => input("車検証読み取り情報", label), b = (label) => input("基本情報", label);
  setInput(d("記録事項番号"), v.documentNumber);
  setInput(d("自動車登録番号又は車両番号"), v.registrationNumber);
  setInput(d("車台番号"), v.chassisNumber);
  setInput(d("登録年月日／交付年月日"), v.registrationDate);
  setInput(d("初度登録年月"), v.firstRegistration);
  setInput(d("有効期間の満了する日"), v.inspectionExpiry);
  setInput(d("使用者の住所"), v.userAddress);
  setInput(d("使用の本拠の位置"), v.baseLocation);
  setInput(d("車体の形状"), v.bodyShape);
  if (v.registrationNumber) {
    setInput(b("登録番号"), v.registrationNumber);
    const last = v.registrationNumber.match(/(\d{4})(?!.*\d)/)?.[1] || "";
    if (last) setInput(b("ナンバー下4桁"), last);
  }
  setInput(b("車台番号"), v.chassisNumber);
  setInput(b("初度登録（和暦）"), v.firstRegistration);
  const addr = d("使用者の住所");
  if (addr && !v.userAddress && (/\[[A-Za-z0-9]/.test(addr.value) || /[A-Z]{3,}/.test(addr.value) || /ペペ|バケ|TTTT|手細情報/.test(addr.value))) setInput(addr, "", true);
  const base = d("使用の本拠の位置");
  if (base && !v.baseLocation && /原動機|KG-|ババ|T-\s*e/.test(base.value)) setInput(base, "", true);
  for (const label of ["型式指定番号", "類別区分番号"]) {
    const el = d(label); if (el && (/^\d{1,2}$/.test(el.value) || /[^0-9-]/.test(el.value))) setInput(el, "", true);
  }
}

export default function CertificateTopCellsFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let dead = false, running = false, lastKey = "";
    const run = async () => {
      if (dead || running) return;
      const debug = globalTextFromPage();
      const img = document.querySelector("img.preview");
      if (!debug || !img?.src) return;
      const key = `${img.src}|${debug.length}`;
      if (key === lastKey) return;
      lastKey = key; running = true;
      try {
        const values = await extract(img, debug);
        if (dead) return;
        apply(values);
        [600, 1800, 3600, 6500].forEach((ms) => setTimeout(() => { if (!dead) apply(values); }, ms));
      } catch (e) {
        console.warn("certificate tiny-cell correction skipped", e);
        ensureDebug([`精密OCRエラー: ${e?.message || e}`]);
      } finally { running = false; }
    };
    const obs = new MutationObserver(() => void run());
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const id = setInterval(() => void run(), 900); void run();
    return () => { dead = true; obs.disconnect(); clearInterval(id); };
  }, []);
  return null;
}
