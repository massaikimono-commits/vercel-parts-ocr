"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (value = "") => String(value).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function eraYear(era, y) {
  const n = Number(y);
  if (!Number.isFinite(n) || n < 1) return 0;
  if (era === "令和") return 2018 + n;
  if (era === "平成") return 1988 + n;
  if (era === "昭和") return 1925 + n;
  return 0;
}

function parseMonthYear(value) {
  const m = compact(value).match(/(令和|平成|昭和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  return m ? eraYear(m[1], m[2]) : 0;
}

function parseDateYear(value) {
  const m = compact(value).match(/(令和|平成|昭和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return m ? eraYear(m[1], m[2]) : 0;
}

function candidateTriples(raw) {
  const groups = (String(raw || "").match(/\d{1,4}/g) || []).map((v) => v.replace(/^0+(?=\d)/, ""));
  const triples = [];
  for (let i = 0; i + 2 < groups.length; i += 1) {
    triples.push([Number(groups[i]), Number(groups[i + 1]), Number(groups[i + 2])]);
  }
  const joined = groups.join("");
  for (let yl = 1; yl <= 2; yl += 1) {
    for (let ml = 1; ml <= 2; ml += 1) {
      for (let dl = 1; dl <= 2; dl += 1) {
        if (yl + ml + dl !== joined.length) continue;
        triples.push([
          Number(joined.slice(0, yl)),
          Number(joined.slice(yl, yl + ml)),
          Number(joined.slice(yl + ml)),
        ]);
      }
    }
  }
  return triples.filter(([y, m, d]) => y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31);
}

function parseBody(raw = "") {
  const text = compact(raw)
    .replace(/\s+/g, "")
    .replace(/パン|ハン|バソ|パソ|ヴァン|バシ/g, "バン");
  const names = ["キャブオーバ", "ステーションワゴン", "ピックアップ", "ボンネット", "バン", "箱型", "セダン", "トラック", "ダンプ", "幌型", "バス"];
  return names.find((name) => text.includes(name)) || "";
}

function mode(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = reject;
      node.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 6000 / Math.max(iw, ih));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(iw * scale));
    canvas.height = Math.max(1, Math.round(ih * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(5, Math.floor(Math.max(w, h) / 700));
  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const brightness = (r + g + b) / 3;
    return brightness > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 110;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, count = 0;
    for (let x = 0; x < w; x += step) { if (paperish(x, y)) hit += 1; count += 1; }
    if (hit / Math.max(1, count) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, count = 0;
    for (let y = top; y <= bottom; y += step) { if (paperish(x, y)) hit += 1; count += 1; }
    if (hit / Math.max(1, count) > 0.22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, box, targetWidth = 3000, binary = false) {
  const [x0, y0, x1, y1] = box;
  const sx = Math.round(paper.x + paper.w * x0);
  const sy = Math.round(paper.y + paper.h * y0);
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(14, targetWidth / sw));
  const pad = 44;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  if (binary) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, count = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const gray = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      sum += gray; count += 1;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = gray;
    }
    const threshold = Math.max(105, Math.min(220, sum / Math.max(1, count) - 15));
    for (let p = 0; p < image.data.length; p += 4) {
      const value = image.data[p] < threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = value;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function targetedRead(file) {
  const source = await canvasFromFile(file);
  const paper = detectPaper(source);
  const tesseract = await import("./lib/tesseract-local");
  const worker = await tesseract.createWorker("jpn+eng", 1);
  const dateRaws = [], bodyRaws = [], dateCandidates = [], bodyCandidates = [];
  const q = window.__vehicleCertificateQrPriority || {};
  const minYear = parseMonthYear(q.firstRegistration) || 1926;
  const maxYear = parseDateYear(q.inspectionExpiry) || 2100;
  const defaultEra = String(q.inspectionExpiry || q.firstRegistration || "").match(/令和|平成|昭和/)?.[0] || "令和";
  const dateBoxes = [
    [0.170, 0.215, 0.420, 0.255],
    [0.185, 0.220, 0.405, 0.252],
    [0.155, 0.212, 0.435, 0.258],
  ];
  const bodyBoxes = [
    [0.070, 0.430, 0.350, 0.485],
    [0.090, 0.438, 0.330, 0.480],
    [0.110, 0.445, 0.310, 0.478],
  ];
  try {
    for (const box of dateBoxes) {
      for (const binary of [false, true]) {
        const canvas = crop(source, paper, box, 3200, binary);
        for (const psm of ["7", "6"]) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "0123456789 .,/年月日令和平成昭和" });
          const raw = compact((await worker.recognize(canvas)).data.text || "");
          if (!raw) continue;
          dateRaws.push(raw);
          const era = raw.match(/令和|平成|昭和/)?.[0] || defaultEra;
          for (const [y, m, d] of candidateTriples(raw)) {
            const western = eraYear(era, y);
            if (!western || western < minYear || western > maxYear) continue;
            dateCandidates.push(`${era}${y}年${m}月${d}日`);
          }
        }
      }
    }
    for (const box of bodyBoxes) {
      for (const binary of [false, true]) {
        const canvas = crop(source, paper, box, 2800, binary);
        for (const psm of ["7", "6", "11"]) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "" });
          const raw = compact((await worker.recognize(canvas)).data.text || "");
          if (!raw) continue;
          bodyRaws.push(raw);
          const parsed = parseBody(raw);
          if (parsed) bodyCandidates.push(parsed);
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return {
    registrationDate: mode(dateCandidates),
    bodyShape: mode(bodyCandidates),
    dateRaws,
    bodyRaws,
  };
}

function showStatus(result, state) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-authoritative-v2-status");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-authoritative-v2-status";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">本体state確定OCR（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = [
    `状態: ${state}`,
    `登録年月日: ${result?.registrationDate || "未取得"}`,
    `車体形状: ${result?.bodyShape || "未取得"}`,
    "",
    "登録年月日OCR:",
    ...(result?.dateRaws || ["(空)"]),
    "",
    "車体形状OCR:",
    ...(result?.bodyRaws || ["(空)"]),
  ].join("\n");
}

export default function CertificateAuthoritativeReaderV2() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let scan = 0;
    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++scan;
      void (async () => {
        for (let i = 0; i < 240 && !dead && id === scan; i += 1) {
          if (!document.querySelector(".progress")) break;
          await sleep(250);
        }
        if (dead || id !== scan) return;
        showStatus(null, "専用OCR中");
        const result = await targetedRead(file);
        if (dead || id !== scan) return;
        const patch = {};
        if (result.registrationDate) patch.registrationDate = result.registrationDate;
        if (result.bodyShape) patch.bodyShape = result.bodyShape;
        if (Object.keys(patch).length) {
          window.__vehicleCertificateQrPriority = {
            ...(window.__vehicleCertificateQrPriority || {}),
            ...patch,
          };
          for (let i = 0; i < 4 && !dead && id === scan; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await sleep(650);
          }
        }
        showStatus(result, Object.keys(patch).length ? "本体stateへ反映完了" : "候補なし");
      })().catch((error) => showStatus({ dateRaws: [String(error?.message || error)] }, "エラー"));
    };
    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
