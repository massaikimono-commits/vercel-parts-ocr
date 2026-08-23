"use client";

import { useEffect } from "react";

const norm = (v = "") => String(v).normalize("NFKC").replace(/[‐‑‒–—―ー]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const compact = (v = "") => norm(v).replace(/\s+/g, "");

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) => s.querySelector("h2")?.textContent?.includes(title)) || null;
}

function field(title, label) {
  const s = section(title);
  if (!s) return null;
  for (const l of Array.from(s.querySelectorAll("label"))) {
    const t = (l.querySelector("span")?.textContent || l.childNodes[0]?.textContent || "").trim();
    if (compact(t) === compact(label)) return l.querySelector("input");
  }
  return null;
}

function setField(el, value) {
  if (!el || !value || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function eraOf(v = "") {
  const t = norm(v);
  if (/令和|信和|令入|作和|今和|三和|合和|令乱|命和/.test(t)) return "令和";
  if (/平成|平[或戊陰咸]/.test(t)) return "平成";
  if (/昭和|昭[禾口]/.test(t)) return "昭和";
  return "";
}

function toGregorian(v = "") {
  const m = v.match(/(令和|平成|昭和)(\d+)年(\d+)月(?:([0-9]+)日)?/);
  if (!m) return NaN;
  const n = Number(m[2]);
  const y = m[1] === "令和" ? 2018 + n : m[1] === "平成" ? 1988 + n : 1925 + n;
  return y * 10000 + Number(m[3]) * 100 + Number(m[4] || 1);
}

async function sourceCanvas(img) {
  if (!img.complete) await new Promise((res, rej) => {
    img.addEventListener("load", res, { once: true });
    img.addEventListener("error", rej, { once: true });
  });
  const c = document.createElement("canvas");
  const max = 4600;
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const ok = (x, y) => {
    const p = (y * w + x) * 4;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (ok(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > .25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (ok(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > .25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, box, mode = "gray", targetWidth = 1000, offset = -12) {
  const [x0, x1, y0, y1] = box;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(18, targetWidth / sw));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);

  if (mode !== "color") {
    const im = x.getImageData(0, 0, c.width, c.height);
    let sum = 0, n = 0;
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
      sum += g; n++;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
    }
    if (mode === "binary") {
      const th = Math.max(110, Math.min(225, sum / Math.max(1, n) + offset));
      for (let p = 0; p < im.data.length; p += 4) {
        const v = im.data[p] < th ? 0 : 255;
        im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      }
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

async function recognize(worker, canvas, psm = "10", digits = true) {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
    ...(digits ? { tessedit_char_whitelist: "0123456789" } : {}),
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

function variants(s = "", maxDigits = 2) {
  const d = String(s).replace(/\D/g, "");
  if (!d) return [];
  const out = [];
  if (d.length <= maxDigits) out.push({ n: Number(d), score: 5 });
  if (d.length > maxDigits) {
    if (d.endsWith("0") && d.slice(0, maxDigits).length === maxDigits) out.push({ n: Number(d.slice(0, maxDigits)), score: 5 });
    for (let len = maxDigits; len >= 1; len--) {
      for (let i = 0; i + len <= d.length; i++) out.push({ n: Number(d.slice(i, i + len)), score: len === maxDigits ? 2 : 1 });
    }
  }
  return out.filter((x) => Number.isFinite(x.n));
}

function pick(texts, min, max, maxDigits = 2) {
  const scores = new Map();
  for (const t of texts) {
    for (const c of variants(t, maxDigits)) {
      if (c.n < min || c.n > max) continue;
      scores.set(c.n, (scores.get(c.n) || 0) + c.score);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || String(b[0]).length - String(a[0]).length)[0]?.[0] || 0;
}

async function readNumberCell(worker, source, paper, name, box, min, max, maxDigits, logs) {
  const attempts = [];
  attempts.push(await recognize(worker, crop(source, paper, box, "gray", 1200), maxDigits === 1 ? "10" : "7", true));
  attempts.push(await recognize(worker, crop(source, paper, box, "binary", 1200, -22), maxDigits === 1 ? "10" : "7", true));
  attempts.push(await recognize(worker, crop(source, paper, box, "binary", 1200, -6), maxDigits === 1 ? "10" : "7", true));
  logs.push(`【v3 ${name}】 ${attempts.map((x) => x || "(空)").join(" / ")}`);
  return pick(attempts, min, max, maxDigits);
}

function parseBody(texts) {
  const choices = ["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","幌型","バス","バン"];
  for (const raw of texts) {
    const t = compact(raw);
    for (const x of choices) if (t.includes(x)) return x;
    if (/バ[ンソ]|[ハパ]ン/.test(t)) return "バン";
  }
  return "";
}

function ensureDebug(lines) {
  let box = document.getElementById("certificate-critical-v3-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-critical-v3-debug";
    box.style.margin = "12px 0";
    box.innerHTML = '<summary style="font-weight:700;cursor:pointer">日付・車体形状OCR v3（確認用）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre>';
    document.querySelector("img.preview")?.closest("section.card")?.appendChild(box);
  }
  const pre = box?.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

async function readCritical(img) {
  const source = await sourceCanvas(img);
  const paper = detectPaper(source);
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);
  const logs = [`v3紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
  try {
    // 元画像の罫線に合わせ、年・月・日だけを個別に読む。
    const regY = await readNumberCell(worker, source, paper, "登録年", [0.270, 0.307, 0.222, 0.247], 1, 64, 2, logs);
    const regM = await readNumberCell(worker, source, paper, "登録月", [0.307, 0.348, 0.222, 0.247], 1, 12, 2, logs);
    const regD = await readNumberCell(worker, source, paper, "登録日", [0.347, 0.392, 0.222, 0.247], 1, 31, 2, logs);

    const firstY = await readNumberCell(worker, source, paper, "初度年", [0.522, 0.578, 0.222, 0.247], 1, 64, 2, logs);
    const firstM = await readNumberCell(worker, source, paper, "初度月", [0.575, 0.625, 0.222, 0.247], 1, 12, 2, logs);

    const expY = await readNumberCell(worker, source, paper, "満了年", [0.800, 0.842, 0.222, 0.247], 1, 64, 2, logs);
    const expM = await readNumberCell(worker, source, paper, "満了月", [0.838, 0.878, 0.222, 0.247], 1, 12, 2, logs);
    const expD = await readNumberCell(worker, source, paper, "満了日", [0.872, 0.920, 0.222, 0.247], 1, 31, 2, logs);

    const currentReg = field("車検証読み取り情報", "登録年月日／交付年月日")?.value || "";
    const currentFirst = field("車検証読み取り情報", "初度登録年月")?.value || "";
    const currentExp = field("車検証読み取り情報", "有効期間の満了する日")?.value || "";
    const regEra = eraOf(currentReg) || "令和";
    const firstEra = eraOf(currentFirst) || "平成";
    const expEra = eraOf(currentExp) || "令和";

    let registrationDate = regY && regM && regD ? `${regEra}${regY}年${regM}月${regD}日` : "";
    let firstRegistration = firstY && firstM ? `${firstEra}${firstY}年${firstM}月` : "";
    let inspectionExpiry = expY && expM && expD ? `${expEra}${expY}年${expM}月${expD}日` : "";

    if (registrationDate && firstRegistration && inspectionExpiry) {
      const a = toGregorian(firstRegistration), b = toGregorian(registrationDate), c = toGregorian(inspectionExpiry);
      if (!(a <= b && b <= c)) {
        logs.push(`【v3 日付順序】 NG ${firstRegistration} → ${registrationDate} → ${inspectionExpiry}`);
        registrationDate = "";
        firstRegistration = "";
        inspectionExpiry = "";
      }
    }

    const bodyBox = [0.120, 0.220, 0.456, 0.486];
    const bodyGray = await recognize(worker, crop(source, paper, bodyBox, "gray", 1800), "7", false);
    const bodyBw = await recognize(worker, crop(source, paper, bodyBox, "binary", 1800, -15), "7", false);
    const bodyShape = parseBody([bodyGray, bodyBw]);
    logs.push(`【v3 車体形状 灰】 ${bodyGray || "(空)"}`, `【v3 車体形状 白黒】 ${bodyBw || "(空)"}`);

    logs.push(
      `【v3採用 登録年月日】 ${registrationDate || "未読"}`,
      `【v3採用 初度登録】 ${firstRegistration || "未読"}`,
      `【v3採用 有効期限】 ${inspectionExpiry || "未読"}`,
      `【v3採用 車体形状】 ${bodyShape || "未読"}`,
    );
    ensureDebug(logs);
    return { registrationDate, firstRegistration, inspectionExpiry, bodyShape };
  } finally {
    await worker.terminate();
  }
}

function applyResult(r) {
  if (!r) return;
  if (r.registrationDate) setField(field("車検証読み取り情報", "登録年月日／交付年月日"), r.registrationDate);
  if (r.firstRegistration) {
    setField(field("車検証読み取り情報", "初度登録年月"), r.firstRegistration);
    setField(field("基本情報", "初度登録（和暦）"), r.firstRegistration);
  }
  if (r.inspectionExpiry) setField(field("車検証読み取り情報", "有効期間の満了する日"), r.inspectionExpiry);
  if (r.bodyShape) setField(field("車検証読み取り情報", "車体の形状"), r.bodyShape);
}

export default function CertificateCriticalV3() {
  useEffect(() => {
    let dead = false;
    let running = false;
    let lastSrc = "";
    let result = null;

    const run = async () => {
      if (dead || running) return;
      const img = document.querySelector("img.preview");
      if (!img?.src) return;
      if (result && img.src === lastSrc) { applyResult(result); return; }
      const debug = Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").join("\n");
      if (!debug.includes("車検証 全体OCR") && !debug.includes("v2紙範囲") && !debug.includes("安定化紙範囲")) return;
      running = true;
      lastSrc = img.src;
      try {
        result = await readCritical(img);
        if (!dead) applyResult(result);
      } catch (e) {
        ensureDebug([`日付・車体形状OCR v3 エラー: ${e?.message || e}`]);
      } finally {
        running = false;
      }
    };

    const obs = new MutationObserver(() => {
      if (result) applyResult(result);
      void run();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const id = setInterval(() => {
      if (result) applyResult(result);
      void run();
    }, 300);
    void run();
    return () => { dead = true; obs.disconnect(); clearInterval(id); };
  }, []);
  return null;
}
