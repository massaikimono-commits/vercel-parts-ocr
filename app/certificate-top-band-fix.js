"use client";

import { useEffect } from "react";

const compact = (v = "") =>
  String(v)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const onlyDigits = (v = "") =>
  compact(v)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/\D/g, "");

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
    if (compact(t).replace(/\s+/g, "") === compact(label).replace(/\s+/g, "")) {
      return l.querySelector("input");
    }
  }
  return null;
}

function setInput(el, val, allowEmpty = false) {
  if (!el || val == null || (!allowEmpty && !val) || el.value === val) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter) setter.call(el, val);
  else el.value = val;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };

  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));

  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p],
      g = data[p + 1],
      b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0,
      n = 0;
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
    let hit = 0,
      n = 0;
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

function band(source, paper, y0, y1, targetWidth = 3000) {
  const sx = paper.x;
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = paper.w;
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(5, targetWidth / Math.max(1, sw)));

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
  const hist = new Uint32Array(256);
  const gray = new Uint8Array(c.width * c.height);

  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const v = Math.max(
      0,
      Math.min(
        255,
        Math.round(
          (im.data[p] * 0.22 + im.data[p + 1] * 0.7 + im.data[p + 2] * 0.08 - 128) *
            1.35 +
            128
        )
      )
    );
    gray[i] = v;
    hist[v]++;
  }

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0,
    wB = 0,
    best = 0,
    threshold = 180;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = i;
    }
  }

  threshold = Math.max(125, Math.min(215, threshold + 12));
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const v = gray[i] > threshold ? 255 : 0;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
    im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

async function recognize(worker, canvas, psm = "6") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
  });
  const r = await worker.recognize(canvas);
  return compact(r?.data?.text || "");
}

function docNumber(text) {
  const t = compact(text);
  const direct = t.match(/(?<!\d)\d{12}(?!\d)/);
  if (direct) return direct[0];
  for (const line of t.split("\n")) {
    const d = onlyDigits(line);
    if (d.length === 12 && new Set(d).size >= 4) return d;
  }
  return "";
}

function registration(text) {
  const t = compact(text)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[一―‐‑‒–—ー]/g, "-");

  const lines = t.split("\n").map((x) => x.trim()).filter(Boolean);
  for (const line0 of lines) {
    const line = line0.replace(/\s+/g, " ");
    const m = line.match(
      /([一-龠ぁ-んァ-ヶ]{1,8})\s*([0-9]{2,3})\s*([ぁ-ん])\s*[-・.]?\s*([0-9 ]{1,7})/
    );
    if (!m) continue;
    const serial = m[4].replace(/\D/g, "");
    if (serial.length < 1 || serial.length > 4) continue;
    return `${m[1]} ${m[2]} ${m[3]} ${serial.padStart(4, "0")}`;
  }

  const squashed = t.replace(/\s+/g, "");
  const m = squashed.match(
    /([一-龠ぁ-んァ-ヶ]{1,8})([0-9]{2,3})([ぁ-ん])([0-9]{1,4})/
  );
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4].padStart(4, "0")}` : "";
}

function chassis(text) {
  const t = compact(text)
    .toUpperCase()
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/\s+/g, "")
    .replace(/[＿_]/g, "-")
    .replace(/--+/g, "-");
  const all = t.match(/[A-Z]{1,5}[0-9]{1,5}-[0-9]{4,12}/g) || [];
  return all.sort((a, b) => b.length - a.length)[0] || "";
}

function normalizeEraText(text) {
  return compact(text)
    .replace(/作\s*和/g, "令和")
    .replace(/今\s*和/g, "令和")
    .replace(/三\s*和/g, "令和")
    .replace(/平\s*[或戊成]/g, "平成");
}

function eraTokens(text) {
  const t = normalizeEraText(text);
  const out = [];
  const re =
    /(令和|平成|昭和)\s*(元|\d{1,2})\s*[年.．\s]\s*(\d{1,2})\s*[月.．\s](?:(\d{1,2})\s*[日.．]?)?/g;
  let m;
  while ((m = re.exec(t))) {
    const y = m[2] === "元" ? "元" : String(Number(m[2]));
    const mo = Number(m[3]);
    const d = m[4] ? Number(m[4]) : null;
    if (mo < 1 || mo > 12 || (d != null && (d < 1 || d > 31))) continue;
    out.push({
      index: m.index,
      value: d
        ? `${m[1]}${y}年${mo}月${d}日`
        : `${m[1]}${y}年${mo}月`,
      hasDay: d != null,
    });
  }
  return out;
}

function datesFromBand(text) {
  const a = eraTokens(text);
  const full = a.filter((x) => x.hasDay);
  const month = a.filter((x) => !x.hasDay);

  let registrationDate = "";
  let firstRegistration = "";
  let inspectionExpiry = "";

  if (full.length >= 2) {
    registrationDate = full[0].value;
    inspectionExpiry = full[full.length - 1].value;
  } else if (full.length === 1) {
    const v = full[0].value;
    if (/令和[89]|令和1[0-9]/.test(v)) inspectionExpiry = v;
    else registrationDate = v;
  }
  if (month.length) firstRegistration = month[0].value;

  return { registrationDate, firstRegistration, inspectionExpiry };
}

function company(text) {
  for (const line0 of compact(text).split("\n")) {
    const line = line0.replace(/\s{2,}/g, " ").trim();
    const m = line.match(/(株式会社|有限会社|合同会社).{1,60}/);
    if (m) {
      return m[0]
        .replace(/[|｜]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return "";
}

function address(text) {
  for (const line0 of compact(text).split("\n")) {
    let line = line0
      .replace(/使用者の住所/g, "")
      .replace(/使[房用]者.*住所/g, "")
      .replace(/\[[0-9０-９\s._-]{4,}\].*$/g, "")
      .replace(/([0-9])一([0-9])/g, "$1-$2")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, "")
      .trim();
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

function baseLocation(text) {
  const t = compact(text);
  if (/[*＊※kK]{2,}/.test(t)) return "***";
  return address(t);
}

function bodyShape(text) {
  const t = compact(text).replace(/\s+/g, "");
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
  if (/車体の形状.{0,14}[バパ]ン/.test(t)) return "バン";
  return "";
}

function apply(values) {
  const d = (label) => input("車検証読み取り情報", label);
  const b = (label) => input("基本情報", label);

  const trusted = [
    ["記録事項番号", values.documentNumber],
    ["自動車登録番号又は車両番号", values.registrationNumber],
    ["車台番号", values.chassisNumber],
    ["登録年月日／交付年月日", values.registrationDate],
    ["初度登録年月", values.firstRegistration],
    ["有効期間の満了する日", values.inspectionExpiry],
    ["使用者の氏名又は名称", values.userName],
    ["使用者の住所", values.userAddress],
    ["使用の本拠の位置", values.baseLocation],
    ["車体の形状", values.bodyShape],
  ];
  for (const [label, val] of trusted) setInput(d(label), val);

  if (!values.userAddress) {
    const el = d("使用者の住所");
    if (el && /ペペ|バケ|TTTT|手細情報|[<>{}\[\]]/.test(el.value)) {
      setInput(el, "", true);
    }
  }
  if (!values.baseLocation) {
    const el = d("使用の本拠の位置");
    if (el && /原動機|KG-|ババ|T-\s*e/.test(el.value)) {
      setInput(el, "", true);
    }
  }

  for (const label of ["型式指定番号", "類別区分番号"]) {
    const el = d(label);
    if (el && (/^\d{1,2}$/.test(el.value) || /[^0-9-]/.test(el.value))) {
      setInput(el, "", true);
    }
  }

  setInput(b("登録番号"), values.registrationNumber);
  if (values.registrationNumber) {
    const m = values.registrationNumber.match(/(\d{4})(?!.*\d)/);
    if (m) setInput(b("ナンバー下4桁"), m[1]);
  }
  setInput(b("車台番号"), values.chassisNumber);
  setInput(b("初度登録（和暦）"), values.firstRegistration);
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
  const s = Math.min(
    1,
    max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)
  );
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function extract(img) {
  const source = await buildSource(img);
  const paper = detectPaper(source);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1);

  try {
    const header = await recognize(worker, band(source, paper, 0.055, 0.165), "6");
    const identity = await recognize(worker, band(source, paper, 0.145, 0.235), "6");
    const dateBand = await recognize(worker, band(source, paper, 0.215, 0.285), "6");
    const userBand = await recognize(worker, band(source, paper, 0.275, 0.405), "6");
    const detailBand = await recognize(worker, band(source, paper, 0.405, 0.545), "6");

    const dates = datesFromBand(dateBand);
    return {
      documentNumber: docNumber(header),
      registrationNumber: registration(identity),
      chassisNumber: chassis(identity),
      registrationDate: dates.registrationDate,
      firstRegistration: dates.firstRegistration,
      inspectionExpiry: dates.inspectionExpiry,
      userName: company(userBand),
      userAddress: address(userBand),
      baseLocation: baseLocation(userBand),
      bodyShape: bodyShape(detailBand),
    };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

export default function CertificateTopBandFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;

    let dead = false;
    let lastKey = "";
    let running = false;

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
        const values = await extract(img);
        if (dead) return;
        apply(values);
        [500, 1500].forEach((ms) =>
          setTimeout(() => {
            if (!dead) apply(values);
          }, ms)
        );
      } catch (e) {
        console.warn("certificate top-band correction skipped", e);
      } finally {
        running = false;
      }
    };

    const obs = new MutationObserver(() => void run());
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
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
