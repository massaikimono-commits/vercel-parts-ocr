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
  const gray = new Uint8Array(canvas.width * canvas.height);
  let sum = 0;
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.7 + image.data[p + 2] * 0.08);
    gray[i] = g;
    sum += g;
  }
  const avg = sum / Math.max(1, gray.length);
  const threshold = Math.max(88, Math.min(230, avg - 6));
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "contrast") v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.3 + 150)));
    else if (mode === "binary") v = v < threshold ? 0 : 255;
    else if (mode === "binaryDark") v = v < Math.max(70, threshold - 30) ? 0 : 255;
    else if (mode === "binaryLight") v = v < Math.min(240, threshold + 28) ? 0 : 255;
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
  const scale = Math.max(1, Math.min(18, targetWidth / Math.max(1, sw)));
  const pad = 84;
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

function qrBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = Math.max(24, Math.round(Math.min(width, height) * 0.025));
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
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

function decodeManyJsQR(jsQR, canvas, label) {
  const work = document.createElement("canvas");
  work.width = canvas.width;
  work.height = canvas.height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const found = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const image = ctx.getImageData(0, 0, work.width, work.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      if (!code) break;
      const binary = Array.from(code.binaryData || []);
      found.push({ label: `${label}/jsQR`, data: code.data || "", binary, hex: hex(binary) });
      const b = qrBounds(code, work.width, work.height);
      if (!b) break;
      ctx.fillStyle = "#fff";
      ctx.fillRect(b.left, b.top, Math.max(1, b.right - b.left), Math.max(1, b.bottom - b.top));
    } catch {
      break;
    }
  }
  return found;
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
  const found = [];

  // 用紙検出が広すぎても拾えるよう、下側を複数の高さで横一帯スキャンする。
  const bandYs = [0.68, 0.72, 0.76, 0.80, 0.84];
  const bandModes = ["color", "contrast", "binary"];
  for (const y of bandYs) {
    for (const mode of bandModes) {
      const band = cropRegion(source, paper, [0.32, y, 0.66, 0.16], 4300, mode);
      found.push(...decodeManyJsQR(decoders.jsQR, band, `下段帯/y${y}/${mode}`));
      if (found.length >= 4) break;
    }
    if (found.length >= 4) break;
  }

  // 帯スキャンで足りない場合は、6個を1つずつ位置をずらしながら高倍率で探す。
  if (unique(found).length < 4) {
    const rowYs = [0.70, 0.74, 0.78, 0.82];
    const starts = [0.38, 0.405, 0.43];
    const stepX = 0.082;
    const modes = ["color", "contrast", "binary", "binaryDark", "binaryLight"];
    outer: for (const y of rowYs) {
      for (const start of starts) {
        for (let i = 0; i < 6; i += 1) {
          const box = [start + stepX * i, y, 0.125, 0.13];
          for (const mode of modes) {
            const crop = cropRegion(source, paper, box, 2300, mode);
            const decoded = await decodeOne(decoders, crop, `下段6個/r${y}/s${start}/QR${i + 1}/${mode}`);
            if (decoded.length) {
              found.push(decoded[0]);
              break;
            }
          }
          if (unique(found).length >= 6) break outer;
        }
      }
    }
  }

  return { result: unique(found), paper };
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
        showStatus("通常QRで3件未満のため、最下段6個を広域スキャン中…");
        try {
          const { result, paper } = await scanLowerSix(file);
          if (stopped || currentToken !== token) return;
          const combined = unique([...(Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : []), ...result]);
          if (combined.length) {
            window.__vehicleCertificateQr = combined;
            window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
          }
          showStatus(`下段広域QR: ${result.length}件 / 合計${combined.length}件（用紙 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}）`);
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
