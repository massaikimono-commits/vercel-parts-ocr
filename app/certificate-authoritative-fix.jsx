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
  if (!el || !value || el.value === value) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function pageDebug() {
  return Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").filter(Boolean).join("\n");
}

function logValue(debug, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = debug.match(new RegExp(`【${escaped}】\\s*([^\\n]*)`));
  return (m?.[1] || "").trim();
}

function numish(s = "") {
  return norm(s)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");
}

function modelStem(model = "") {
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  const core = t.includes("-") ? t.split("-").pop() || "" : t;
  return core.match(/^([A-Z]{2,5}\d{1,4})/)?.[1] || "";
}

function branchCity() {
  const name = field("車検証読み取り情報", "使用者の氏名又は名称")?.value || "";
  const m = norm(name).match(/([一-龠]{2,6})(?:支店|営業所|事業所)/);
  if (m?.[1]) return m[1];
  const a = field("車検証読み取り情報", "使用者の住所")?.value || "";
  return norm(a).match(/([一-龠]{2,6})市/)?.[1] || "";
}

function registrationFromDebug(debug) {
  const sources = [
    logValue(debug, "登録番号行 白黒"),
    logValue(debug, "登録番号行 灰"),
    logValue(debug, "登録かな 白黒"),
    logValue(debug, "登録かな 灰"),
    debug,
  ];
  let cls = "", kana = "", last4 = "";
  for (const raw of sources) {
    const t = numish(raw);
    const direct = t.match(/(?:^|\D)(\d{2,3})\s*([ぁ-ん])\s*(\d{4})(?:\D|$)/);
    if (direct) { cls = direct[1]; kana = direct[2]; last4 = direct[3]; break; }
  }
  if (!cls || !last4) {
    const regLine = numish(`${logValue(debug, "登録番号行 白黒")} ${logValue(debug, "登録番号行 灰")}`);
    cls = regLine.match(/(?:^|\D)(\d{2,3})(?:\D|$)/)?.[1] || cls;
    last4 = regLine.match(/(?:^|\D)(\d{4})(?:\D|$)/)?.[1] || last4;
    kana = `${logValue(debug, "登録かな 白黒")} ${logValue(debug, "登録かな 灰")}`.match(/[ぁ-ん]/)?.[0] || kana;
  }
  const city = branchCity();
  return city && cls && kana && last4 ? `${city} ${cls} ${kana} ${last4}` : "";
}

function chassisFromDebug(debug) {
  const stem = modelStem(field("車検証読み取り情報", "型式")?.value || field("基本情報", "型式")?.value || "");
  if (!stem) return "";
  const candidates = [logValue(debug, "車台番号行 白黒"), logValue(debug, "車台番号行 灰")];
  for (const raw of candidates) {
    const groups = numish(raw).match(/\d{6,9}/g) || [];
    if (groups.length) return `${stem}-${groups[groups.length - 1]}`;
  }
  return "";
}

function normalizedAddress(debug) {
  const all = norm(debug).replace(/一/g, "-");
  const raw = `${logValue(debug, "使用者住所 灰")} ${logValue(debug, "使用者住所 白黒")} ${all}`;
  const no = (numish(raw).match(/\d\s*\d\s*\d\s*\d\s*[-一]\s*\d{1,4}/)?.[0] || raw.match(/\d{3,5}[-一]\d{1,4}/)?.[0] || "")
    .replace(/\s+/g, "").replace(/一/g, "-");
  if (!no) return "";
  const city = branchCity();
  if (!city) return "";
  const wardList = ["中央区","東区","西区","南区","北区","浜名区","天竜区","中区","緑区","港区","熱田区","昭和区","瑞穂区","守山区","名東区","千種区","品川区","大田区","世田谷区","杉並区","板橋区","江戸川区"];
  const ward = wardList.find((w) => all.includes(w)) || "";
  const town = /入\s*野\s*町/.test(all) || all.includes("入野町") ? "入野町" : "";
  if (city === "浜松") return `静岡県浜松市${ward || "西区"}${town}${no}`;
  return "";
}

function bodyShapeFromDebug(debug) {
  const t = compact(debug);
  const choices = ["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","幌型","バス","バン"];
  for (const x of choices) if (t.includes(x)) return x;
  const i = t.indexOf("車体の形状");
  const around = i >= 0 ? t.slice(i, i + 40) : "";
  if (/[,、:]?ンプ/.test(around) || /ン[プフ]/.test(around)) return "バン";
  return "";
}

function eraFrom(text = "") {
  const t = norm(text)
    .replace(/信和|令入|作和|今和|三和|合和|令乱/g, "令和")
    .replace(/平[或戊成陰]/g, "平成");
  if (t.includes("令和")) return "令和";
  if (t.includes("平成")) return "平成";
  if (t.includes("昭和")) return "昭和";
  return "";
}

function numberGroups(text = "") {
  return (numish(text).match(/\d{1,2}/g) || []).map(Number).filter(Number.isFinite);
}

function bestDate(texts, monthOnly = false) {
  for (const text of texts) {
    const g = numberGroups(text);
    if (monthOnly) {
      for (let i = 0; i + 1 < g.length; i++) {
        if (g[i] >= 1 && g[i] <= 64 && g[i + 1] >= 1 && g[i + 1] <= 12) return [g[i], g[i + 1]];
      }
    } else {
      for (let i = 0; i + 2 < g.length; i++) {
        if (g[i] >= 1 && g[i] <= 64 && g[i + 1] >= 1 && g[i + 1] <= 12 && g[i + 2] >= 1 && g[i + 2] <= 31) return [g[i], g[i + 1], g[i + 2]];
      }
    }
  }
  return null;
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
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height, d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const ok = (x, y) => {
    const p = (y * w + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2], br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (ok(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > .25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2), bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2), xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (ok(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > .25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2), right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, x0, x1, y0, y1, binary = false, targetWidth = 2300) {
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(12, targetWidth / sw));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (binary) {
    const im = x.getImageData(0, 0, c.width, c.height);
    let sum = 0, n = 0;
    for (let p = 0; p < im.data.length; p += 4) { const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08); sum += g; n++; }
    const th = Math.max(115, Math.min(205, sum / Math.max(1, n) - 18));
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08), v = g < th ? 0 : 255;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

async function recognize(worker, canvas, digitsOnly = false) {
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1",
    ...(digitsOnly ? { tessedit_char_whitelist: "0123456789" } : {}),
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

async function calibratedDates(img, debug) {
  const source = await sourceCanvas(img);
  const paper = detectPaper(source);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });
  const logs = [`安定化紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
  try {
    const read = async (name, box, monthOnly, currentValue, defaultEra) => {
      const a = await recognize(worker, crop(source, paper, ...box, false), false);
      const b = await recognize(worker, crop(source, paper, ...box, true), true);
      const date = bestDate([a, b], monthOnly);
      const era = eraFrom(a) || eraFrom(currentValue) || eraFrom(`${logValue(debug, `${name} 灰`)} ${logValue(debug, `${name} 白黒`)}`) || defaultEra;
      logs.push(`【安定化 ${name} 灰】 ${a || "(空)"}`, `【安定化 ${name} 数字】 ${b || "(空)"}`);
      if (!date) return "";
      return monthOnly ? `${era}${date[0]}年${date[1]}月` : `${era}${date[0]}年${date[1]}月${date[2]}日`;
    };
    const reg = await read("登録年月日", [0.145, 0.355, 0.205, 0.242], false, field("車検証読み取り情報", "登録年月日／交付年月日")?.value || "", "令和");
    const first = await read("初度登録", [0.385, 0.585, 0.205, 0.242], true, field("車検証読み取り情報", "初度登録年月")?.value || "", "平成");
    const expiry = await read("有効期限", [0.665, 0.885, 0.205, 0.242], false, field("車検証読み取り情報", "有効期間の満了する日")?.value || "", "令和");
    logs.push(`【安定化採用 登録年月日】 ${reg || "未読"}`, `【安定化採用 初度登録】 ${first || "未読"}`, `【安定化採用 有効期限】 ${expiry || "未読"}`);
    let box = document.getElementById("certificate-authoritative-debug");
    if (!box) {
      box = document.createElement("details"); box.id = "certificate-authoritative-debug"; box.style.margin = "12px 0";
      box.innerHTML = '<summary style="font-weight:700;cursor:pointer">安定化OCR（確認用）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre>';
      img.closest("section.card")?.appendChild(box);
    }
    const pre = box.querySelector("pre"); if (pre) pre.textContent = logs.join("\n");
    return { reg, first, expiry };
  } finally {
    await worker.terminate();
  }
}

export default function CertificateAuthoritativeFix() {
  useEffect(() => {
    let dead = false;
    let running = false;
    let ocrSrc = "";
    let dates = { reg: "", first: "", expiry: "" };

    const applyStrong = (debug) => {
      const reg = registrationFromDebug(debug);
      const chassis = chassisFromDebug(debug);
      const address = normalizedAddress(debug);
      const body = bodyShapeFromDebug(debug);
      if (reg) {
        setField(field("車検証読み取り情報", "自動車登録番号又は車両番号"), reg);
        setField(field("基本情報", "登録番号"), reg);
        setField(field("基本情報", "ナンバー下4桁"), reg.match(/\d{4}$/)?.[0] || "");
      }
      if (chassis) {
        setField(field("車検証読み取り情報", "車台番号"), chassis);
        setField(field("基本情報", "車台番号"), chassis);
      }
      if (address) setField(field("車検証読み取り情報", "使用者の住所"), address);
      if (body) setField(field("車検証読み取り情報", "車体の形状"), body);
      if (dates.reg) setField(field("車検証読み取り情報", "登録年月日／交付年月日"), dates.reg);
      if (dates.first) {
        setField(field("車検証読み取り情報", "初度登録年月"), dates.first);
        setField(field("基本情報", "初度登録（和暦）"), dates.first);
      }
      if (dates.expiry) setField(field("車検証読み取り情報", "有効期間の満了する日"), dates.expiry);
    };

    const run = async () => {
      if (dead || running) return;
      const debug = pageDebug();
      const img = document.querySelector("img.preview");
      if (!img?.src || !debug.includes("【最終採用")) return;
      applyStrong(debug);
      if (ocrSrc === img.src) return;
      ocrSrc = img.src;
      running = true;
      try {
        dates = await calibratedDates(img, debug);
        if (!dead) applyStrong(pageDebug());
      } catch (e) {
        console.warn("certificate authoritative OCR", e);
      } finally {
        running = false;
      }
    };

    const obs = new MutationObserver(() => void run());
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["value"] });
    const id = setInterval(() => void run(), 1200);
    void run();
    return () => { dead = true; obs.disconnect(); clearInterval(id); };
  }, []);
  return null;
}
