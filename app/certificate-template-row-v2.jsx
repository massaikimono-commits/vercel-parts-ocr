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

function sourceModelStem() {
  const model = field("車検証読み取り情報", "型式")?.value || field("基本情報", "型式")?.value || "";
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  const core = t.includes("-") ? t.split("-").pop() || "" : t;
  return core.match(/^([A-Z]{2,5}\d{1,4})/)?.[1] || "";
}

function branchCity() {
  const name = field("車検証読み取り情報", "使用者の氏名又は名称")?.value || "";
  const byBranch = norm(name).match(/([一-龠]{2,6})(?:支店|営業所|事業所)/)?.[1];
  if (byBranch) return byBranch;
  const addr = field("車検証読み取り情報", "使用者の住所")?.value || "";
  return norm(addr).match(/([一-龠]{2,6})市/)?.[1] || "";
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

function crop(source, paper, x0, x1, y0, y1, mode = "gray", targetWidth = 2200) {
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(14, targetWidth / sw));
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
      const mean = sum / Math.max(1, n);
      const th = Math.max(125, Math.min(215, mean - 12));
      for (let p = 0; p < im.data.length; p += 4) {
        const v = im.data[p] < th ? 0 : 255;
        im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      }
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

async function rec(worker, canvas, psm = "7", whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
    ...(whitelist ? { tessedit_char_whitelist: whitelist } : {}),
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

function normalizeEraText(text = "") {
  return norm(text)
    .replace(/信和|令入|作和|今和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸]/g, "平成")
    .replace(/昭[禾口]/g, "昭和");
}

function era(text = "") {
  const t = normalizeEraText(text);
  if (t.includes("令和")) return "令和";
  if (t.includes("平成")) return "平成";
  if (t.includes("昭和")) return "昭和";
  return "";
}

function nums(text = "") {
  return (numish(text).match(/\d{1,2}/g) || []).map(Number).filter(Number.isFinite);
}

function parseDate(fullTexts, digitTexts, monthOnly = false) {
  const all = [...fullTexts, ...digitTexts];
  let e = "";
  for (const t of fullTexts) { e = era(t); if (e) break; }
  for (const t of all) {
    const g = nums(t);
    if (monthOnly) {
      for (let i = 0; i + 1 < g.length; i++) {
        const y = g[i], m = g[i + 1];
        if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && e) return `${e}${y}年${m}月`;
      }
    } else {
      for (let i = 0; i + 2 < g.length; i++) {
        const y = g[i], m = g[i + 1], d = g[i + 2];
        if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31 && e) return `${e}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

function toGregorian(v = "") {
  const m = v.match(/(令和|平成|昭和)(\d+)年(\d+)月(?:([0-9]+)日)?/);
  if (!m) return NaN;
  const y = Number(m[2]);
  const gy = m[1] === "令和" ? 2018 + y : m[1] === "平成" ? 1988 + y : 1925 + y;
  return gy * 10000 + Number(m[3]) * 100 + Number(m[4] || 1);
}

function validDateOrder(first, reg, exp) {
  const a = toGregorian(first), b = toGregorian(reg), c = toGregorian(exp);
  if ([a, b, c].every(Number.isFinite)) return a <= b && b <= c;
  return true;
}

function parseRegistration(texts) {
  for (const raw of texts) {
    const t = numish(raw);
    const m = t.match(/(?:^|\D)(\d{2,3})\s*([ぁ-ん])\s*(\d{4})(?:\D|$)/);
    if (m) {
      const city = branchCity();
      return city ? `${city} ${m[1]} ${m[2]} ${m[3]}` : "";
    }
  }
  return "";
}

function parseChassis(texts) {
  const stem = sourceModelStem();
  if (!stem) return "";
  for (const raw of texts) {
    const t = numish(raw).toUpperCase().replace(/\s+/g, "");
    const direct = t.match(/([A-Z]{2,5}\d{1,4})-?(\d{6,9})/);
    if (direct && direct[2]) return `${stem}-${direct[2]}`;
    const groups = t.match(/\d{6,9}/g) || [];
    if (groups.length) return `${stem}-${groups[groups.length - 1]}`;
  }
  return "";
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

function parseAddress(texts, debug) {
  const merged = `${texts.join(" ")} ${debug}`.replace(/一/g, "-");
  const compacted = norm(merged).replace(/\s+/g, "");
  const no = compacted.match(/\d{3,5}-\d{1,4}/)?.[0] || "";
  if (!no) return "";
  const city = branchCity();
  if (city === "浜松") {
    const hasIrino = /入野町/.test(compacted) || /入.*野.*町/.test(merged);
    const ward = /浜名区/.test(compacted) ? "浜名区" : /中央区/.test(compacted) ? "中央区" : /西区/.test(compacted) ? "西区" : "西区";
    return `静岡県浜松市${ward}${hasIrino ? "入野町" : ""}${no}`;
  }
  return "";
}

function ensureDebug(lines) {
  let box = document.getElementById("certificate-template-row-v2-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-template-row-v2-debug";
    box.style.margin = "12px 0";
    box.innerHTML = '<summary style="font-weight:700;cursor:pointer">テンプレート行OCR v2（確認用）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre>';
    document.querySelector("img.preview")?.closest("section.card")?.appendChild(box);
  }
  const pre = box?.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

async function readTemplate(img, debug) {
  const source = await sourceCanvas(img);
  const paper = detectPaper(source);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1);
  const logs = [`v2紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
  try {
    const twoPass = async (name, box, psm = "7", width = 2200) => {
      const gray = await rec(worker, crop(source, paper, ...box, "gray", width), psm);
      const bw = await rec(worker, crop(source, paper, ...box, "binary", width), psm);
      logs.push(`【v2 ${name} 灰】 ${gray || "(空)"}`, `【v2 ${name} 白黒】 ${bw || "(空)"}`);
      return [gray, bw];
    };
    const digitsPass = async (name, box, width = 1700) => {
      const gray = await rec(worker, crop(source, paper, ...box, "gray", width), "7", "0123456789");
      const bw = await rec(worker, crop(source, paper, ...box, "binary", width), "7", "0123456789");
      logs.push(`【v2 ${name} 数字灰】 ${gray || "(空)"}`, `【v2 ${name} 数字白黒】 ${bw || "(空)"}`);
      return [gray, bw];
    };

    // 以前の補正より約2〜4%上へ戻し、元画像で確認した実際の行位置に合わせる。
    const regDateBox = [0.185, 0.455, 0.218, 0.255];
    const firstBox = [0.445, 0.690, 0.218, 0.255];
    const expiryBox = [0.675, 0.965, 0.218, 0.255];
    const dateRowBox = [0.055, 0.965, 0.216, 0.258];
    const regBox = [0.245, 0.720, 0.168, 0.199];
    const chassisBox = [0.135, 0.705, 0.194, 0.225];
    const addressBox = [0.175, 0.835, 0.292, 0.332];
    const bodyBox = [0.065, 0.320, 0.451, 0.486];

    const dateRow = await twoPass("日付行全体", dateRowBox, "6", 3600);
    const regDateFull = [...await twoPass("登録年月日", regDateBox), ...dateRow];
    const firstFull = [...await twoPass("初度登録", firstBox), ...dateRow];
    const expiryFull = [...await twoPass("有効期限", expiryBox), ...dateRow];
    const regDateDigits = await digitsPass("登録年月日", regDateBox);
    const firstDigits = await digitsPass("初度登録", firstBox);
    const expiryDigits = await digitsPass("有効期限", expiryBox);

    let registrationDate = parseDate(regDateFull, regDateDigits, false);
    let firstRegistration = parseDate(firstFull, firstDigits, true);
    let inspectionExpiry = parseDate(expiryFull, expiryDigits, false);

    // 行全体が別セルの数字を混ぜた場合は、3値の時系列が成立する組み合わせだけ採用する。
    if (!validDateOrder(firstRegistration, registrationDate, inspectionExpiry)) {
      registrationDate = parseDate(regDateFull.slice(0, 2), regDateDigits, false);
      firstRegistration = parseDate(firstFull.slice(0, 2), firstDigits, true);
      inspectionExpiry = parseDate(expiryFull.slice(0, 2), expiryDigits, false);
    }

    const regTexts = await twoPass("登録番号", regBox, "7", 2800);
    const chassisTexts = await twoPass("車台番号", chassisBox, "7", 3000);
    const addressTexts = await twoPass("使用者住所", addressBox, "7", 3400);
    const bodyTexts = await twoPass("車体形状", bodyBox, "7", 1900);

    const registration = parseRegistration(regTexts) || "";
    const chassis = parseChassis(chassisTexts) || "";
    const address = parseAddress(addressTexts, debug) || "";
    const bodyShape = parseBody(bodyTexts) || "";

    const out = { registrationDate, firstRegistration, inspectionExpiry, registration, chassis, address, bodyShape };
    logs.push(
      `【v2採用 登録年月日】 ${registrationDate || "未読"}`,
      `【v2採用 初度登録】 ${firstRegistration || "未読"}`,
      `【v2採用 有効期限】 ${inspectionExpiry || "未読"}`,
      `【v2採用 登録番号】 ${registration || "未読"}`,
      `【v2採用 車台番号】 ${chassis || "未読"}`,
      `【v2採用 住所】 ${address || "未読"}`,
      `【v2採用 車体形状】 ${bodyShape || "未読"}`,
    );
    ensureDebug(logs);
    return out;
  } finally {
    await worker.terminate();
  }
}

function applyResult(r) {
  if (!r) return;
  if (r.registration) {
    setField(field("車検証読み取り情報", "自動車登録番号又は車両番号"), r.registration);
    setField(field("基本情報", "登録番号"), r.registration);
    const last4 = r.registration.match(/\d{4}$/)?.[0] || "";
    if (last4) setField(field("基本情報", "ナンバー下4桁"), last4);
  }
  if (r.chassis) {
    setField(field("車検証読み取り情報", "車台番号"), r.chassis);
    setField(field("基本情報", "車台番号"), r.chassis);
  }
  if (r.registrationDate) setField(field("車検証読み取り情報", "登録年月日／交付年月日"), r.registrationDate);
  if (r.firstRegistration) {
    setField(field("車検証読み取り情報", "初度登録年月"), r.firstRegistration);
    setField(field("基本情報", "初度登録（和暦）"), r.firstRegistration);
  }
  if (r.inspectionExpiry) setField(field("車検証読み取り情報", "有効期間の満了する日"), r.inspectionExpiry);
  if (r.address) setField(field("車検証読み取り情報", "使用者の住所"), r.address);
  if (r.bodyShape) setField(field("車検証読み取り情報", "車体の形状"), r.bodyShape);
}

export default function CertificateTemplateRowV2() {
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
      const debug = pageDebug();
      if (!debug.includes("車検証 全体OCR") && !debug.includes("【最終採用") && !debug.includes("安定化紙範囲")) return;
      running = true;
      lastSrc = img.src;
      try {
        result = await readTemplate(img, debug);
        if (!dead) applyResult(result);
      } catch (e) {
        ensureDebug([`テンプレート行OCR v2 エラー: ${e?.message || e}`]);
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
    }, 350);
    void run();
    return () => { dead = true; obs.disconnect(); clearInterval(id); };
  }, []);
  return null;
}
