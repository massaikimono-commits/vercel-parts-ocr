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

function section(title) {
  return (
    Array.from(document.querySelectorAll("section.card")).find((s) =>
      s.querySelector("h2")?.textContent?.includes(title)
    ) || null
  );
}

function field(title, label) {
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

function setField(el, value) {
  if (!el || !value || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function eraOf(v = "") {
  const t = norm(v)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和");
  if (t.includes("令和")) return "令和";
  if (t.includes("平成")) return "平成";
  if (t.includes("昭和")) return "昭和";
  return "";
}

function numberish(v = "") {
  return norm(v)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");
}

function validParts(parts, monthOnly) {
  if (monthOnly) {
    if (parts.length !== 2) return false;
    return parts[0] >= 1 && parts[0] <= 64 && parts[1] >= 1 && parts[1] <= 12;
  }
  if (parts.length !== 3) return false;
  return (
    parts[0] >= 1 &&
    parts[0] <= 64 &&
    parts[1] >= 1 &&
    parts[1] <= 12 &&
    parts[2] >= 1 &&
    parts[2] <= 31
  );
}

function candidatesFromText(raw, monthOnly, fallbackEra) {
  const text = numberish(raw);
  const era = eraOf(text) || fallbackEra || "";
  const nums = (text.match(/\d{1,2}/g) || []).map(Number);
  const need = monthOnly ? 2 : 3;
  const out = [];

  for (let i = 0; i + need <= nums.length; i += 1) {
    const parts = nums.slice(i, i + need);
    if (!validParts(parts, monthOnly)) continue;
    let score = 1;
    if (eraOf(text)) score += 8;
    if (/年|月|日/.test(text)) score += 4;
    if (nums.length === need) score += 4;
    if (parts[0] >= 20) score += 1;
    out.push({ era, parts, score, raw });
  }
  return out;
}

function bestDate(attempts, monthOnly, fallbackEra) {
  const all = attempts.flatMap((x) => candidatesFromText(x, monthOnly, fallbackEra));
  if (!all.length) return "";
  all.sort((a, b) => b.score - a.score);
  const b = all[0];
  if (!b.era) return "";
  return monthOnly
    ? `${b.era}${b.parts[0]}年${b.parts[1]}月`
    : `${b.era}${b.parts[0]}年${b.parts[1]}月${b.parts[2]}日`;
}

function bodyFrom(attempts) {
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
  for (const raw of attempts) {
    const t = compact(raw)
      .replace(/パン/g, "バン")
      .replace(/ハン/g, "バン")
      .replace(/バソ/g, "バン")
      .replace(/パソ/g, "バン");
    for (const c of choices) if (t.includes(c)) return c;
    if (/[バハパ][ンソ]/.test(t)) return "バン";
  }
  return "";
}

async function sourceCanvas(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, 4600 / Math.max(iw, ih));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(iw * scale));
  c.height = Math.max(1, Math.round(ih * scale));
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const isPaper = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0;
    let n = 0;
    for (let x = 0; x < w; x += step) {
      if (isPaper(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let n = 0;
    for (let y = top; y <= bottom; y += step) {
      if (isPaper(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, box, mode = "gray", targetWidth = 2200, thresholdOffset = -14) {
  const [x0, x1, y0, y1] = box;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(12, targetWidth / sw));
  const pad = 24;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  c.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);

  if (mode !== "color") {
    const im = x.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    let n = 0;
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * 0.22 + im.data[p + 1] * 0.7 + im.data[p + 2] * 0.08);
      sum += g;
      n += 1;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
    }
    if (mode === "binary") {
      const th = Math.max(110, Math.min(225, sum / Math.max(1, n) + thresholdOffset));
      for (let p = 0; p < im.data.length; p += 4) {
        const v = im.data[p] < th ? 0 : 255;
        im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      }
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

async function recognize(worker, canvas, psm = "7", whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: whitelist,
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

async function readAttempts(worker, source, paper, box, block = false) {
  const psmLine = "7";
  const psmBlock = "6";
  const gray = crop(source, paper, box, "gray", 2400);
  const bw = crop(source, paper, box, "binary", 2400, -18);
  const out = [];
  out.push(await recognize(worker, gray, psmLine, ""));
  out.push(await recognize(worker, bw, psmLine, ""));
  if (block) out.push(await recognize(worker, gray, psmBlock, ""));
  out.push(await recognize(worker, bw, psmLine, "0123456789令和平成昭年月日 .-/"));
  return out.filter(Boolean);
}

function ensureDebug(lines) {
  let box = document.getElementById("certificate-critical-v3-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-critical-v3-debug";
    box.style.margin = "12px 0";
    box.innerHTML =
      '<summary style="font-weight:700;cursor:pointer">日付・車体形状OCR v3（確認用）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre>';
    document.querySelector("img.preview")?.closest("section.card")?.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

async function readCritical(img) {
  const source = await sourceCanvas(img);
  const paper = detectPaper(source);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });
  const logs = [`v3紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];

  try {
    // 年/月/日を細切れにせず、値セルを横長に読んでから分解する。
    const regAttempts = await readAttempts(worker, source, paper, [0.235, 0.475, 0.194, 0.239], true);
    const firstAttempts = await readAttempts(worker, source, paper, [0.435, 0.665, 0.194, 0.239], true);
    const expAttempts = await readAttempts(worker, source, paper, [0.625, 0.965, 0.194, 0.239], true);

    const currentReg = field("車検証読み取り情報", "登録年月日／交付年月日")?.value || "";
    const currentFirst = field("車検証読み取り情報", "初度登録年月")?.value || "";
    const currentExp = field("車検証読み取り情報", "有効期間の満了する日")?.value || "";

    const registrationDate = bestDate(regAttempts, false, eraOf(currentReg));
    const firstRegistration = bestDate(firstAttempts, true, eraOf(currentFirst));
    const inspectionExpiry = bestDate(expAttempts, false, eraOf(currentExp));

    const bodyAttempts = await readAttempts(worker, source, paper, [0.085, 0.36, 0.410, 0.465], true);
    const bodyShape = bodyFrom(bodyAttempts);

    logs.push(
      `【v3 登録年月日候補】 ${regAttempts.join(" / ") || "(空)"}`,
      `【v3 初度登録候補】 ${firstAttempts.join(" / ") || "(空)"}`,
      `【v3 有効期限候補】 ${expAttempts.join(" / ") || "(空)"}`,
      `【v3 車体形状候補】 ${bodyAttempts.join(" / ") || "(空)"}`,
      `【v3採用 登録年月日】 ${registrationDate || "未読"}`,
      `【v3採用 初度登録】 ${firstRegistration || "未読"}`,
      `【v3採用 有効期限】 ${inspectionExpiry || "未読"}`,
      `【v3採用 車体形状】 ${bodyShape || "未読"}`
    );
    ensureDebug(logs);
    return { registrationDate, firstRegistration, inspectionExpiry, bodyShape };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

function applyResult(r) {
  if (!r) return;
  if (r.registrationDate) {
    setField(field("車検証読み取り情報", "登録年月日／交付年月日"), r.registrationDate);
  }
  if (r.firstRegistration) {
    setField(field("車検証読み取り情報", "初度登録年月"), r.firstRegistration);
    setField(field("基本情報", "初度登録（和暦）"), r.firstRegistration);
  }
  if (r.inspectionExpiry) {
    setField(field("車検証読み取り情報", "有効期間の満了する日"), r.inspectionExpiry);
  }
  if (r.bodyShape) {
    setField(field("車検証読み取り情報", "車体の形状"), r.bodyShape);
  }
}

export default function CertificateCriticalV3() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    let running = false;
    let lastSrc = "";
    let result = null;

    const run = async () => {
      if (dead || running) return;
      const img = document.querySelector("img.preview");
      if (!img?.src) return;
      const debug = Array.from(document.querySelectorAll("details pre"))
        .map((x) => x.textContent || "")
        .join("\n");
      if (!debug.includes("車検証 全体OCR")) return;

      if (result && img.src === lastSrc) {
        applyResult(result);
        return;
      }

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

    const observer = new MutationObserver(() => {
      if (result) applyResult(result);
      void run();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const timer = window.setInterval(() => {
      if (result) applyResult(result);
      void run();
    }, 500);
    void run();

    return () => {
      dead = true;
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
