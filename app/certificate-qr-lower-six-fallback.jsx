"use client";

import { useEffect } from "react";

function hex(bytes = []) {
  return Array.from(bytes)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("QRフォールバック画像を開けませんでした"));
      node.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 8200 / Math.max(iw, ih));
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
  const step = Math.max(5, Math.floor(Math.max(w, h) / 720));
  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 103 && Math.max(r, g, b) - Math.min(r, g, b) < 108;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) {
      if (paperish(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) {
      if (paperish(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function preprocess(canvas, mode) {
  if (mode === "color") return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.7 + image.data[p + 2] * 0.08);
    gray[i] = g;
    sum += g;
  }
  const avg = sum / Math.max(1, gray.length);
  const threshold = Math.max(92, Math.min(225, avg - 7));
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "contrast") v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.2 + 148)));
    else if (mode === "binary") v = v < threshold ? 0 : 255;
    else if (mode === "binaryDark") v = v < Math.max(72, threshold - 30) ? 0 : 255;
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cropRegion(source, paper, box, targetWidth, mode) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(paper.w * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(paper.h * h0)));
  const scale = Math.max(1, Math.min(16, targetWidth / Math.max(1, sw)));
  const pad = 72;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  return preprocess(canvas, mode);
}

async function makeDecoders() {
  const js = await import("jsqr");
  const jsQR = js.default || js;
  let zxing = null;
  try {
    const browser = await import("@zxing/browser");
    const lib = await import("@zxing/library");
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    zxing = new browser.BrowserQRCodeReader(hints);
  } catch {
    zxing = null;
  }
  return { jsQR, zxing };
}

async function decodeOne(decoders, canvas, label) {
  const out = [];
  if (decoders.zxing) {
    try {
      const result = await decoders.zxing.decodeFromCanvas(canvas);
      const data = result?.getText?.() || result?.text || "";
      const raw = result?.getRawBytes?.() || result?.rawBytes || [];
      if (data || raw?.length) out.push({ label: `${label}/ZXing`, data, binary: Array.from(raw || []), hex: hex(raw || []) });
    } catch {}
  }
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = decoders.jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (code) {
      const binary = Array.from(code.binaryData || []);
      out.push({ label: `${label}/jsQR`, data: code.data || "", binary, hex: hex(binary) });
    }
  } catch {}
  return out;
}

function unique(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.hex || item.data;
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function showStatus(text) {
  const host = document.getElementById("certificate-qr-debug");
  if (!host) return;
  let box = document.getElementById("certificate-qr-six-fallback-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-six-fallback-status";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.borderRadius = "10px";
    box.style.background = "#fff8e8";
    box.style.border = "1px solid #f1d89b";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}

async function scanLowerSix(file) {
  const source = await canvasFromFile(file);
  const paper = detectPaper(source);
  const decoders = await makeDecoders();
  const regions = [
    ["QR1", [0.415, 0.855, 0.105, 0.13]],
    ["QR2", [0.495, 0.855, 0.105, 0.13]],
    ["QR3", [0.575, 0.855, 0.105, 0.13]],
    ["QR4", [0.655, 0.855, 0.105, 0.13]],
    ["QR5", [0.735, 0.855, 0.105, 0.13]],
    ["QR6", [0.815, 0.855, 0.105, 0.13]],
  ];
  const modes = ["color", "contrast", "binary", "binaryDark"];
  const found = [];
  for (const [name, box] of regions) {
    let accepted = null;
    for (const mode of modes) {
      const crop = cropRegion(source, paper, box, 1900, mode);
      const decoded = await decodeOne(decoders, crop, `下段6個/${name}/${mode}`);
      if (decoded.length) {
        accepted = decoded[0];
        break;
      }
    }
    if (accepted) found.push(accepted);
  }
  return unique(found);
}

export default function CertificateQrLowerSixFallback() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let stopped = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || file.type === "application/pdf") return;
      const currentToken = ++token;
      window.setTimeout(async () => {
        if (stopped || currentToken !== token) return;
        const existing = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        if (existing.length >= 3) return;
        showStatus("通常QRで3件未満のため、最下段6個配置を追加スキャン中…");
        try {
          const result = await scanLowerSix(file);
          if (stopped || currentToken !== token) return;
          if (result.length >= 3) {
            window.__vehicleCertificateQr = result;
            window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: result }));
            showStatus(`最下段6個配置からQRを${result.length}件読み取りました。`);
          } else {
            showStatus(`最下段6個配置もQRは${result.length}件でした。`);
          }
        } catch (error) {
          showStatus(`最下段6個QRスキャン失敗: ${error?.message || String(error)}`);
        }
      }, 1500);
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      token += 1;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
