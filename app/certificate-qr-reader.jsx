"use client";

import { useEffect } from "react";

function hex(bytes = []) {
  return Array.from(bytes)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function visibleText(value = "") {
  return String(value)
    .replace(/\0/g, "\\0")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n\n")
    .replace(/\t/g, "\\t");
}

async function imageCanvasFromImage(img, max = 5200) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, max / Math.max(iw, ih));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(iw * scale));
  canvas.height = Math.max(1, Math.round(ih * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function imageCanvasFromFile(file, max = 5200) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const x = new Image();
      x.onload = () => resolve(x);
      x.onerror = () => reject(new Error("QR画像を開けませんでした"));
      x.src = url;
    });
    return await imageCanvasFromImage(img, max);
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
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 112 && Math.max(r, g, b) - Math.min(r, g, b) < 95;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (paperish(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.24) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (paperish(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.24) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function cloneCanvas(source) {
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(source, 0, 0);
  return c;
}

function enhance(source, mode) {
  const canvas = cloneCanvas(source);
  if (mode === "color") return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  let sum = 0;
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const v = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.7 + image.data[p + 2] * 0.08);
    gray[i] = v;
    sum += v;
  }
  const avg = sum / Math.max(1, gray.length);
  const threshold = Math.max(105, Math.min(220, avg - 10));
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "contrast") v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.85 + 150)));
    if (mode === "binary") v = v < threshold ? 0 : 255;
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cropCanvas(source, box, targetWidth = 2200) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.max(1, Math.min(7, targetWidth / sw));
  const pad = 42;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  c.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = false;
  x.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  return c;
}

function codeBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const points = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = Math.max(18, Math.round(Math.min(width, height) * 0.025));
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
}

function scanMany(jsQR, source, label) {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) break;
    const binary = Array.from(code.binaryData || []);
    found.push({ label, data: code.data || "", binary, hex: hex(binary) });
    const b = codeBounds(code, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.left, b.top, Math.max(1, b.right - b.left), Math.max(1, b.bottom - b.top));
  }
  return found;
}

function uniqueCodes(list) {
  const map = new Map();
  for (const item of list) {
    const key = item.hex || item.data;
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

async function scanCanvas(source, closeUp = false) {
  const mod = await import("jsqr");
  const jsQR = mod.default || mod;
  const regions = closeUp
    ? [
        ["QR近接 全体", [0, 0, 1, 1], 4800],
        ["QR近接 左", [0, 0, 0.62, 1], 3200],
        ["QR近接 中央", [0.18, 0, 0.64, 1], 3200],
        ["QR近接 右", [0.38, 0, 0.62, 1], 3200],
      ]
    : [
        ["QR帯", [0.34, 0.73, 0.65, 0.22], 4200],
        ["左3個", [0.41, 0.75, 0.43, 0.18], 3200],
        ["右2個", [0.72, 0.75, 0.27, 0.18], 2600],
        ["下部広域", [0.28, 0.67, 0.71, 0.29], 4200],
      ];

  const all = [];
  for (const [label, box, target] of regions) {
    const base = cropCanvas(source, box, target);
    for (const mode of ["color", "contrast", "binary"]) {
      all.push(...scanMany(jsQR, enhance(base, mode), `${label}/${mode}`));
    }
  }
  return uniqueCodes(all);
}

function ensurePanel() {
  let details = document.getElementById("certificate-qr-debug");
  if (details) return details;
  details = document.createElement("details");
  details.id = "certificate-qr-debug";
  details.open = true;
  details.style.marginTop = "14px";
  details.style.border = "1px solid #b9d2ff";
  details.style.borderRadius = "14px";
  details.style.background = "#f5f9ff";
  details.style.padding = "14px";
  const summary = document.createElement("summary");
  summary.style.fontWeight = "800";
  summary.style.cursor = "pointer";
  summary.textContent = "車検証QR（確認用）";
  details.appendChild(summary);
  document.querySelector("img.preview")?.closest("section.card")?.appendChild(details);
  return details;
}

function addCloseUpControls(box, onCamera, onLibrary) {
  const help = document.createElement("div");
  help.style.marginTop = "12px";
  help.style.padding = "10px";
  help.style.borderRadius = "10px";
  help.style.background = "#fff7e8";
  help.style.lineHeight = "1.6";
  help.textContent = "QRが読めない場合は、車検証下部の5個のQRだけを画面いっぱいに入れて近くから撮影してください。";
  box.appendChild(help);

  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1fr 1fr";
  row.style.gap = "8px";
  row.style.marginTop = "10px";

  const camera = document.createElement("button");
  camera.type = "button";
  camera.textContent = "📷 QRだけ近くで撮影";
  camera.style.padding = "13px 10px";
  camera.style.borderRadius = "10px";
  camera.style.border = "1px solid #2f6fe4";
  camera.style.background = "#2f6fe4";
  camera.style.color = "white";
  camera.style.fontWeight = "800";
  camera.onclick = onCamera;

  const library = document.createElement("button");
  library.type = "button";
  library.textContent = "🖼 QR写真を選ぶ";
  library.style.padding = "13px 10px";
  library.style.borderRadius = "10px";
  library.style.border = "1px solid #2f6fe4";
  library.style.background = "white";
  library.style.color = "#2f6fe4";
  library.style.fontWeight = "800";
  library.onclick = onLibrary;

  row.append(camera, library);
  box.appendChild(row);
}

function renderResult(result, message, handlers) {
  const details = ensurePanel();
  details.querySelectorAll("[data-qr-content]").forEach((x) => x.remove());
  const box = document.createElement("div");
  box.dataset.qrContent = "1";
  box.style.marginTop = "10px";

  const status = document.createElement("div");
  status.style.fontWeight = "800";
  status.style.marginBottom = "10px";
  status.textContent = message || `QRコードを ${result.length} 件読み取りました。`;
  box.appendChild(status);

  result.forEach((item, index) => {
    const card = document.createElement("div");
    card.style.background = "white";
    card.style.border = "1px solid #d7e3f8";
    card.style.borderRadius = "10px";
    card.style.padding = "10px";
    card.style.marginTop = "8px";
    const title = document.createElement("b");
    title.textContent = `QR ${index + 1} (${item.label})`;
    const textPre = document.createElement("pre");
    textPre.style.whiteSpace = "pre-wrap";
    textPre.style.wordBreak = "break-all";
    textPre.style.fontSize = "12px";
    textPre.style.background = "#f8fafc";
    textPre.style.padding = "8px";
    textPre.style.borderRadius = "8px";
    textPre.textContent = visibleText(item.data) || "(文字列なし)";
    const hexPre = document.createElement("pre");
    hexPre.style.whiteSpace = "pre-wrap";
    hexPre.style.wordBreak = "break-all";
    hexPre.style.fontSize = "11px";
    hexPre.style.background = "#f8fafc";
    hexPre.style.padding = "8px";
    hexPre.style.borderRadius = "8px";
    hexPre.textContent = item.hex || "(バイナリなし)";
    card.append(title, document.createTextNode("文字列"), textPre, document.createTextNode("バイナリ HEX"), hexPre);
    box.appendChild(card);
  });

  addCloseUpControls(box, handlers.onCamera, handlers.onLibrary);
  details.appendChild(box);
}

export default function CertificateQrReader() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    let running = false;
    let lastSrc = "";

    const cameraInput = document.createElement("input");
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.style.display = "none";
    document.body.appendChild(cameraInput);

    const libraryInput = document.createElement("input");
    libraryInput.type = "file";
    libraryInput.accept = "image/*";
    libraryInput.style.display = "none";
    document.body.appendChild(libraryInput);

    const handlers = {
      onCamera: () => cameraInput.click(),
      onLibrary: () => libraryInput.click(),
    };

    const scanCloseUp = async (file) => {
      if (!file || running) return;
      running = true;
      renderResult([], "近接QR写真を読み取り中…", handlers);
      try {
        const source = await imageCanvasFromFile(file, 6200);
        const result = await scanCanvas(source, true);
        if (dead) return;
        window.__vehicleCertificateQr = result;
        renderResult(
          result,
          result.length
            ? `近接写真からQRコードを ${result.length} 件読み取りました。`
            : "近接写真でもQRを読み取れませんでした。5個のQRをもっと大きく、ピントを合わせて撮影してください。",
          handlers
        );
      } catch (e) {
        if (!dead) renderResult([], `近接QR読取エラー: ${e?.message || e}`, handlers);
      } finally {
        running = false;
      }
    };

    cameraInput.onchange = () => {
      const file = cameraInput.files?.[0];
      if (file) void scanCloseUp(file);
      cameraInput.value = "";
    };
    libraryInput.onchange = () => {
      const file = libraryInput.files?.[0];
      if (file) void scanCloseUp(file);
      libraryInput.value = "";
    };

    const run = async () => {
      if (dead || running) return;
      const img = document.querySelector("img.preview");
      if (!img?.src || img.src === lastSrc) return;
      running = true;
      lastSrc = img.src;
      renderResult([], "車検証全体写真からQRコードを検索中…", handlers);
      try {
        const source = await imageCanvasFromImage(img, 5200);
        const paper = detectPaper(source);
        const paperCanvas = document.createElement("canvas");
        paperCanvas.width = paper.w;
        paperCanvas.height = paper.h;
        const px = paperCanvas.getContext("2d", { willReadFrequently: true });
        px.drawImage(source, paper.x, paper.y, paper.w, paper.h, 0, 0, paper.w, paper.h);
        const result = await scanCanvas(paperCanvas, false);
        if (dead) return;
        window.__vehicleCertificateQr = result;
        renderResult(
          result,
          result.length
            ? `車検証全体写真からQRコードを ${result.length} 件読み取りました。`
            : `QRコードを読み取れませんでした。用紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`,
          handlers
        );
      } catch (e) {
        if (!dead) renderResult([], `QR読取エラー: ${e?.message || e}`, handlers);
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => void run());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = window.setInterval(() => void run(), 700);
    void run();

    return () => {
      dead = true;
      observer.disconnect();
      window.clearInterval(timer);
      cameraInput.remove();
      libraryInput.remove();
    };
  }, []);

  return null;
}
