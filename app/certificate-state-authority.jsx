"use client";

import { useEffect } from "react";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

const BODY_TYPES = [
  "キャブオーバ", "ステーションワゴン", "ピックアップ", "ボンネット",
  "バン", "箱型", "セダン", "トラック", "ダンプ", "幌型", "バス"
];

function parseBody(raw = "") {
  const t = compact(raw).replace(/\s+/g, "");
  return BODY_TYPES.find((name) => t.includes(name)) || "";
}

function normalizeDate(raw = "") {
  return compact(raw)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il!]/g, "1");
}

function parseJpDate(raw = "") {
  const t = normalizeDate(raw);
  const eraMatch = t.match(/令和|平成|昭和/);
  if (!eraMatch) return "";
  const era = eraMatch[0];
  let tail = t.slice(t.indexOf(era) + era.length);

  // OCRで「20」の0が縦棒になることがある。日付末尾の 2| は 20 としても候補化する。
  const variants = [tail];
  if (/2\s*[|｜]/.test(tail)) variants.push(tail.replace(/2\s*[|｜]/, "20"));
  variants.push(tail.replace(/[|｜]/g, "1"));

  for (const v of variants) {
    const nums = (v.match(/\d{1,2}/g) || []).map(Number);
    for (let i = 0; i + 2 < nums.length; i += 1) {
      const y = nums[i], m = nums[i + 1], d = nums[i + 2];
      if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${era}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => resolve(n);
      n.onerror = () => reject(new Error("画像を開けませんでした"));
      n.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 5200 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff";
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(5, Math.floor(Math.max(w, h) / 700));
  const ok = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 110;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, box, binary = false, targetWidth = 2600) {
  const [x0, y0, x1, y1] = box;
  const sx = Math.round(paper.x + paper.w * x0);
  const sy = Math.round(paper.y + paper.h * y0);
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(12, targetWidth / sw));
  const pad = 42;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  if (binary) {
    const im = x.getImageData(0, 0, c.width, c.height);
    let sum = 0, n = 0;
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
      sum += g; n += 1;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
    }
    const th = Math.max(100, Math.min(220, sum / Math.max(1, n) - 15));
    for (let p = 0; p < im.data.length; p += 4) {
      const v = im.data[p] < th ? 0 : 255;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

async function targetedRead(file) {
  const source = await canvasFromFile(file);
  const paper = detectPaper(source);
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);
  const dateCandidates = [];
  const bodyCandidates = [];
  const dateRaws = [];
  const bodyRaws = [];

  // 実車検証の印字位置を中心に、上下左右へ少しずつずらした候補。
  const dateBoxes = [
    [0.145, 0.205, 0.430, 0.282],
    [0.165, 0.220, 0.420, 0.275],
    [0.185, 0.228, 0.425, 0.290],
    [0.120, 0.205, 0.460, 0.295],
  ];
  const bodyBoxes = [
    [0.060, 0.435, 0.340, 0.525],
    [0.070, 0.455, 0.320, 0.515],
    [0.090, 0.445, 0.360, 0.535],
  ];

  try {
    for (const b of dateBoxes) {
      for (const binary of [false, true]) {
        const c = crop(source, paper, b, binary, 2800);
        for (const psm of ["7", "6", "11"]) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          const raw = compact((await worker.recognize(c)).data.text || "");
          if (raw) dateRaws.push(raw);
          const value = parseJpDate(raw);
          if (value) dateCandidates.push(value);
        }
      }
    }

    for (const b of bodyBoxes) {
      for (const binary of [false, true]) {
        const c = crop(source, paper, b, binary, 2400);
        for (const psm of ["7", "6", "11"]) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          const raw = compact((await worker.recognize(c)).data.text || "");
          if (raw) bodyRaws.push(raw);
          const value = parseBody(raw);
          if (value) bodyCandidates.push(value);
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  const mode = (items) => {
    const counts = new Map();
    for (const v of items) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  };

  return {
    registrationDate: mode(dateCandidates),
    bodyShape: mode(bodyCandidates),
    dateRaws,
    bodyRaws,
  };
}

function getVehicleStateHook() {
  const node = document.querySelector("main.page");
  if (!node) return null;
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  let fiber = key ? node[key] : null;
  while (fiber) {
    let hook = fiber.memoizedState;
    while (hook) {
      const state = hook.memoizedState;
      if (state && typeof state === "object" && state.certificate && typeof state.firstRegistration === "string" && typeof hook.queue?.dispatch === "function") {
        return hook;
      }
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
}

function fuelTypeFromQr(fuel = "") {
  const t = compact(fuel);
  if (/軽油|ディーゼル/.test(t)) return "ディーゼル";
  if (/ガソリン/.test(t)) return "ガソリン";
  if (/電気/.test(t)) return "EV";
  return "その他";
}

function applyAuthoritativeState(extra = {}) {
  const hook = getVehicleStateHook();
  if (!hook) return false;
  const current = hook.memoizedState;
  const qr = window.__vehicleCertificateQrPriority || {};
  const certificate = {
    ...current.certificate,
    ...(qr.firstRegistration ? { firstRegistration: qr.firstRegistration } : {}),
    ...(qr.inspectionExpiry ? { inspectionExpiry: qr.inspectionExpiry } : {}),
    ...(qr.model ? { model: qr.model } : {}),
    ...(qr.frontFrontAxleWeightKg ? { frontFrontAxleWeightKg: qr.frontFrontAxleWeightKg } : {}),
    ...(qr.frontRearAxleWeightKg ? { frontRearAxleWeightKg: qr.frontRearAxleWeightKg } : {}),
    ...(qr.rearFrontAxleWeightKg ? { rearFrontAxleWeightKg: qr.rearFrontAxleWeightKg } : {}),
    ...(qr.rearRearAxleWeightKg ? { rearRearAxleWeightKg: qr.rearRearAxleWeightKg } : {}),
    ...(qr.fuel ? { fuel: qr.fuel } : {}),
    ...(extra.registrationDate ? { registrationDate: extra.registrationDate } : {}),
    ...(extra.bodyShape ? { bodyShape: extra.bodyShape } : {}),
  };
  const next = {
    ...current,
    certificate,
    ...(qr.firstRegistration ? { firstRegistration: qr.firstRegistration } : {}),
    ...(qr.model ? { model: qr.model } : {}),
    ...(qr.fuel ? { type: fuelTypeFromQr(qr.fuel) } : {}),
  };
  hook.queue.dispatch(next);
  return true;
}

function showStatus(extra, state) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-state-authority-status");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-state-authority-status";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">本体state最終確定（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const qr = window.__vehicleCertificateQrPriority || {};
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = [
    `状態: ${state}`,
    `登録年月日: ${extra?.registrationDate || "未取得"}`,
    `初度登録(QR): ${qr.firstRegistration || "待機中"}`,
    `有効期限(QR): ${qr.inspectionExpiry || "待機中"}`,
    `車体の形状: ${extra?.bodyShape || "未取得"}`,
    "",
    "登録年月日OCR:", ...(extra?.dateRaws || ["(空)"]),
    "", "車体形状OCR:", ...(extra?.bodyRaws || ["(空)"]),
  ].join("\n");
}

export default function CertificateStateAuthority() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let scanId = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++scanId;

      void (async () => {
        // 本体OCRとQR処理を先に完了させ、最後に確定する。
        for (let i = 0; i < 160 && !dead && id === scanId; i += 1) {
          if (!document.querySelector(".progress") && window.__vehicleCertificateQrPriority?.firstRegistration) break;
          await sleep(350);
        }
        if (dead || id !== scanId) return;

        showStatus(null, "登録年月日・車体形状を再読込中");
        const extra = await targetedRead(file);
        if (dead || id !== scanId) return;

        for (let i = 0; i < 8 && !dead && id === scanId; i += 1) {
          const ok = applyAuthoritativeState(extra);
          showStatus(extra, ok ? (i >= 2 ? "本体state反映完了" : "本体stateへ反映中") : "React state待ち");
          await sleep(500);
        }
      })().catch((error) => showStatus({ dateRaws: [String(error?.message || error)] }, "最終確定エラー"));
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
