"use client";

import { useEffect } from "react";

const norm = (v = "") =>
  String(v)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const compact = (v = "") => norm(v).replace(/\s+/g, "");

const numish = (v = "") =>
  norm(v)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
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
  const m = core.match(/^([A-Z]{2,5}\d{1,4})/);
  return m?.[1] || "";
}

function normalizeChassis(value, model) {
  let t = norm(value)
    .toUpperCase()
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[＿_]/g, "-")
    .replace(/\s+/g, "")
    .replace(/--+/g, "-")
    .replace(/^S(?=N(?:KR|PR|LR|MR|QR|KS|PS|LS|MS|QS))/g, "")
    .replace(/NKRS(?=\d)/g, "NKR");

  const serial = t.match(/-([0-9]{4,12})/)?.[1] || "";
  const stem = modelStem(model);
  if (stem && serial) {
    const before = t.split("-")[0] || "";
    if (
      before === stem ||
      before.endsWith(stem) ||
      stem.endsWith(before) ||
      before.replace(/S/g, "") === stem.replace(/S/g, "")
    ) {
      t = `${stem}-${serial}`;
    }
  }

  const all = t.match(/[A-Z]{1,6}\d{1,5}-\d{4,12}/g) || [];
  return all.sort((a, b) => b.length - a.length)[0] || "";
}

function parseRegistration(text) {
  const t = norm(text)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[一―‐‑‒–—ー]/g, "-");

  const patterns = [
    /([一-龠ぁ-んァ-ヶ]{1,8})\s*([0-9]{2,3})\s*([ぁ-ん])\s*[-・.]?\s*([0-9 ]{1,7})/,
    /([一-龠ぁ-んァ-ヶ]{1,8})([0-9]{2,3})([ぁ-ん])([0-9]{1,4})/,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const serial = m[4].replace(/\D/g, "");
    if (!serial || serial.length > 4) continue;
    return `${m[1]} ${m[2]} ${m[3]} ${serial.padStart(4, "0")}`;
  }
  return "";
}

function eraFromText(text) {
  const t = norm(text)
    .replace(/作\s*和|今\s*和|三\s*和|信\s*和|合\s*和|令\s*[禾ロ]/g, "令和")
    .replace(/平\s*[或戊成]/g, "平成");
  if (/令和/.test(t)) return "令和";
  if (/平成/.test(t)) return "平成";
  if (/昭和/.test(t)) return "昭和";
  return "";
}

function numberTokens(text) {
  const t = numish(text);
  const raw = t.match(/\d{1,4}/g) || [];
  const out = [];
  for (const s of raw) {
    const n = Number(s);
    out.push(n);
    if (s.length === 3 && n > 99) {
      out.push(Number(s.slice(0, 2)));
      out.push(Number(s.slice(1)));
    }
  }
  return out.filter((x) => Number.isFinite(x));
}

function looseDate(text, options = {}) {
  const { monthOnly = false, eraHint = "", model = "" } = options;
  let era = eraFromText(text) || eraHint;
  const a = numberTokens(text);

  for (let i = 0; i < a.length; i++) {
    const y = a[i];
    if (y < 1 || y > 64) continue;
    for (let j = i + 1; j < Math.min(a.length, i + 4); j++) {
      const m = a[j];
      if (m < 1 || m > 12) continue;
      if (monthOnly) {
        if (!era && y > 10 && /^(TKG|QKG|PKG|SKG|LDA|DBA|DAA|3BA|4BA|5BA|5AA|6AA)-/i.test(norm(model))) {
          era = "平成";
        }
        if (!era) continue;
        return `${era}${y}年${m}月`;
      }
      for (let k = j + 1; k < Math.min(a.length, j + 4); k++) {
        const d = a[k];
        if (d < 1 || d > 31) continue;
        if (!era) continue;
        return `${era}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

function company(text) {
  for (const line0 of norm(text).split("\n")) {
    const line = line0.replace(/\s{2,}/g, " ").trim();
    const m = line.match(/(株式会社|有限会社|合同会社).{1,60}/);
    if (m) return m[0].replace(/[|｜]+$/g, "").trim();
  }
  return "";
}

function cleanAddressLine(line0) {
  let line = norm(line0)
    .replace(/使用者の住所/g, "")
    .replace(/使[房用]者.*住所/g, "")
    .replace(/[［【\[(（]\s*[0-9０-９\s._-]{4,}.*$/g, "")
    .replace(/([0-9])一([0-9])/g, "$1-$2")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .trim();

  if (/[都道府県市区町村]/.test(line) && /-\d{6,}$/.test(line)) {
    const m = line.match(/^(.*?-\d{1,4}?)(\d{5,})$/);
    if (m) line = m[1];
  }
  return line;
}

function address(text) {
  for (const line0 of norm(text).split("\n")) {
    const line = cleanAddressLine(line0);
    if (
      line.length >= 8 &&
      line.length <= 70 &&
      /[都道府県市区町村]/.test(line) &&
      /\d/.test(line) &&
      !/記録|事項|型式|車両/.test(line)
    ) {
      return line;
    }
  }
  return "";
}

function baseLocation(text, debug) {
  const raw = `${text}\n${rawField(debug, "使用の本拠の位置")}\n${globalText(debug)}`;
  const around = raw.slice(Math.max(0, raw.indexOf("使用の本拠の位置")), raw.indexOf("使用の本拠の位置") + 240);
  if (/[*＊※kK]{2,}/.test(text) || /[*＊※kK]{2,}/.test(around)) return "***";
  return "";
}

function bodyShape(text) {
  const t = compact(text);
  const choices = [
    "キャブオーバ",
    "ステーションワゴン",
    "ピックアップ",
    "ボンネット",
    "トラック",
    "ダンプ",
    "セダン",
    "箱型",
    "幌型",
    "バス",
    "バン",
  ];
  for (const x of choices) if (t.includes(x)) return x;
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
    for (let x = 0; x < w; x += step) {
      if (paperish(x, y)) hit++;
      n++;
    }
    if (hit / Math.max(1, n) > 0.25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);

  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) {
      if (paperish(x, y)) hit++;
      n++;
    }
    if (hit / Math.max(1, n) > 0.25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

async function buildSource(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
  const c = document.createElement("canvas");
  const max = 4200;
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function cell(source, paper, x0, x1, y0, y1, targetWidth = 2200) {
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(8, targetWidth / sw));

  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);

  const im = ctx.getImageData(0, 0, c.width, c.height);
  const gray = new Uint8Array(c.width * c.height);
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const lum = im.data[p] * 0.22 + im.data[p + 1] * 0.7 + im.data[p + 2] * 0.08;
    const v = Math.max(0, Math.min(255, Math.round((lum - 128) * 1.55 + 128)));
    gray[i] = v;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
    im.data[p + 3] = 255;
  }

  const rowDark = new Uint32Array(c.height);
  const colDark = new Uint32Array(c.width);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (gray[y * c.width + x] < 92) {
        rowDark[y]++;
        colDark[x]++;
      }
    }
  }
  for (let y = 0; y < c.height; y++) {
    if (rowDark[y] / c.width > 0.5) {
      for (let yy = Math.max(0, y - 1); yy <= Math.min(c.height - 1, y + 1); yy++) {
        for (let x = 0; x < c.width; x++) {
          const p = (yy * c.width + x) * 4;
          im.data[p] = im.data[p + 1] = im.data[p + 2] = 255;
        }
      }
    }
  }
  for (let x = 0; x < c.width; x++) {
    if (colDark[x] / c.height > 0.72) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(c.width - 1, x + 1); xx++) {
        for (let y = 0; y < c.height; y++) {
          const p = (y * c.width + xx) * 4;
          im.data[p] = im.data[p + 1] = im.data[p + 2] = 255;
        }
      }
    }
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

async function recognize(worker, canvas, psm = "7") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
  });
  const r = await worker.recognize(canvas);
  return norm(r?.data?.text || "");
}

async function extract(img, debug) {
  const source = await buildSource(img);
  const paper = detectPaper(source);
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);

  try {
    const regText = await recognize(worker, cell(source, paper, 0.28, 0.62, 0.204, 0.234), "7");
    const chassisText = await recognize(worker, cell(source, paper, 0.21, 0.60, 0.228, 0.257), "11");
    const registrationDateText = await recognize(worker, cell(source, paper, 0.29, 0.49, 0.249, 0.281), "7");
    const firstRegistrationText = await recognize(worker, cell(source, paper, 0.50, 0.69, 0.249, 0.281), "7");
    const expiryText = await recognize(worker, cell(source, paper, 0.70, 0.91, 0.249, 0.281), "7");
    const userText = await recognize(worker, cell(source, paper, 0.27, 0.78, 0.283, 0.370), "6");
    const bodyText = await recognize(worker, cell(source, paper, 0.18, 0.38, 0.445, 0.480), "6");

    const model = modelValue();
    const currentRecord = input("車検証読み取り情報", "記録年月日")?.value || "";
    const eraHint = eraFromText(currentRecord) || "令和";

    return {
      documentNumber: documentNumberFromDebug(debug),
      registrationNumber: parseRegistration(regText),
      chassisNumber: normalizeChassis(chassisText, model),
      registrationDate: looseDate(registrationDateText, { eraHint, model }),
      firstRegistration: looseDate(firstRegistrationText, { monthOnly: true, model }),
      inspectionExpiry: looseDate(expiryText, { eraHint, model }),
      userName: company(userText),
      userAddress: address(userText),
      baseLocation: baseLocation(userText, debug),
      bodyShape: bodyShape(bodyText),
    };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

function apply(v) {
  const d = (label) => input("車検証読み取り情報", label);
  const b = (label) => input("基本情報", label);

  setInput(d("記録事項番号"), v.documentNumber);
  setInput(d("自動車登録番号又は車両番号"), v.registrationNumber);
  setInput(d("車台番号"), v.chassisNumber);
  setInput(d("登録年月日／交付年月日"), v.registrationDate);
  setInput(d("初度登録年月"), v.firstRegistration);
  setInput(d("有効期間の満了する日"), v.inspectionExpiry);
  setInput(d("使用者の氏名又は名称"), v.userName);
  setInput(d("使用者の住所"), v.userAddress);
  setInput(d("使用の本拠の位置"), v.baseLocation);
  setInput(d("車体の形状"), v.bodyShape);

  if (v.registrationNumber) {
    setInput(b("登録番号"), v.registrationNumber);
    const last = v.registrationNumber.match(/(\d{4})(?!.*\d)/)?.[1] || "";
    if (last) setInput(b("ナンバー下4桁"), last);
  }
  setInput(b("車台番号"), v.chassisNumber);
  if (v.firstRegistration) setInput(b("初度登録（和暦）"), v.firstRegistration);
  else {
    const el = b("初度登録（和暦）");
    if (el && el.value) setInput(el, "", true);
  }

  const addr = d("使用者の住所");
  if (addr && /ペペ|バケ|TTTT|手細情報|[<>{}]/.test(addr.value)) setInput(addr, "", true);

  const base = d("使用の本拠の位置");
  if (base && /原動機|KG-|ババ|T-\s*e/.test(base.value)) setInput(base, "", true);

  if (addr && base && addr.value && base.value === addr.value && !v.baseLocation) {
    setInput(base, "", true);
  }

  for (const label of ["型式指定番号", "類別区分番号"]) {
    const el = d(label);
    if (el && (/^\d{1,2}$/.test(el.value) || /[^0-9-]/.test(el.value))) {
      setInput(el, "", true);
    }
  }
}

export default function CertificateTopCellsFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;

    let dead = false;
    let running = false;
    let lastKey = "";

    const run = async () => {
      if (dead || running) return;
      const debug =
        Array.from(document.querySelectorAll("details pre"))
          .map((x) => x.textContent || "")
          .find((x) => x.includes("【車検証 全体OCR】")) || "";
      const img = document.querySelector("img.preview");
      if (!debug || !img?.src) return;

      const key = `${img.src}|${debug.length}`;
      if (key === lastKey) return;
      lastKey = key;
      running = true;

      try {
        const values = await extract(img, debug);
        if (dead) return;
        apply(values);
        [600, 1800, 3600, 6500].forEach((ms) =>
          setTimeout(() => {
            if (!dead) apply(values);
          }, ms)
        );
      } catch (e) {
        console.warn("certificate calibrated-cell correction skipped", e);
      } finally {
        running = false;
      }
    };

    const obs = new MutationObserver(() => void run());
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const id = setInterval(() => void run(), 900);
    void run();

    return () => {
      dead = true;
      obs.disconnect();
      clearInterval(id);
    };
  }, []);

  return null;
}
