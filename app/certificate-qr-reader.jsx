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

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("QR解析用画像を開けませんでした"));
      node.src = url;
    });

    // QRは小さいため、OCR用より高い解像度を維持する。
    const maxSide = 7600;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(iw * scale));
    canvas.height = Math.max(1, Math.round(ih * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasFromImage(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
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
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 105;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0;
    let n = 0;
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
    let hit = 0;
    let n = 0;
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
    const g = Math.round(
      image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08
    );
    gray[i] = g;
    sum += g;
  }
  const avg = sum / Math.max(1, gray.length);
  const threshold = Math.max(95, Math.min(220, avg - 8));

  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "contrast") {
      v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.1 + 145)));
    } else if (mode === "binary") {
      v = v < threshold ? 0 : 255;
    } else if (mode === "binaryDark") {
      v = v < Math.max(80, threshold - 25) ? 0 : 255;
    } else if (mode === "binaryLight") {
      v = v < Math.min(235, threshold + 22) ? 0 : 255;
    }
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
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
  const scale = Math.max(1, Math.min(12, targetWidth / sw));
  const pad = 48;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // QRのモジュール境界をぼかさない。
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    pad,
    pad,
    canvas.width - pad * 2,
    canvas.height - pad * 2
  );
  return preprocess(canvas, mode);
}

function bounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [
    loc.topLeftCorner,
    loc.topRightCorner,
    loc.bottomLeftCorner,
    loc.bottomRightCorner,
  ].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = Math.max(18, Math.round(Math.min(width, height) * 0.025));
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
}

function scanMany(jsQR, canvas, label) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "attemptBoth",
    });
    if (!code) break;

    const binary = Array.from(code.binaryData || []);
    found.push({ label, data: code.data || "", binary, hex: hex(binary) });

    const b = bounds(code, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.left, b.top, Math.max(1, b.right - b.left), Math.max(1, b.bottom - b.top));
  }
  return found;
}

function uniqueCodes(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.hex || item.data;
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

function renderResult(result, message) {
  let details = document.getElementById("certificate-qr-debug");
  if (!details) {
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
  }

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
    card.appendChild(title);

    const text = document.createElement("pre");
    text.style.whiteSpace = "pre-wrap";
    text.style.wordBreak = "break-all";
    text.style.fontSize = "12px";
    text.style.background = "#f8fafc";
    text.style.padding = "8px";
    text.style.borderRadius = "8px";
    text.textContent = `文字列\n${visibleText(item.data) || "(文字列なし)"}\n\nバイナリ HEX\n${item.hex || "(バイナリなし)"}`;
    card.appendChild(text);
    box.appendChild(card);
  });

  details.appendChild(box);
}

async function scanSource(source, sourceLabel) {
  const mod = await import("jsqr");
  const jsQR = mod.default || mod;
  const paper = detectPaper(source);

  // 車検証のQR群を自動走査する。個別位置だけに依存せず、下部帯を重ねて探索する。
  const regions = [
    ["下部全体", [0.28, 0.66, 0.71, 0.29], 4200],
    ["QR帯", [0.39, 0.72, 0.60, 0.20], 4200],
    ["左側3個", [0.47, 0.73, 0.31, 0.18], 3200],
    ["右側2個", [0.74, 0.73, 0.25, 0.18], 2800],
    ["QR1", [0.49, 0.735, 0.13, 0.17], 1700],
    ["QR2", [0.56, 0.735, 0.13, 0.17], 1700],
    ["QR3", [0.64, 0.735, 0.13, 0.17], 1700],
    ["QR4", [0.77, 0.735, 0.12, 0.17], 1700],
    ["QR5", [0.86, 0.735, 0.13, 0.17], 1700],
  ];

  const modes = ["color", "contrast", "binary", "binaryDark", "binaryLight"];
  const all = [];
  for (const [name, box, target] of regions) {
    for (const mode of modes) {
      const crop = cropRegion(source, paper, box, target, mode);
      all.push(...scanMany(jsQR, crop, `${sourceLabel}/${name}/${mode}`));
    }
  }

  return { result: uniqueCodes(all), paper };
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificateQrReader() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    let running = false;
    let lastPreviewSrc = "";
    let fileSequence = 0;

    const scanOriginalFile = async (file) => {
      const seq = ++fileSequence;
      if (!file || running) return;
      running = true;
      renderResult([], "車検証の元画像からQRコードを自動解析中…");
      try {
        const source = await canvasFromFile(file);
        const { result, paper } = await scanSource(source, "元画像");
        if (dead || seq !== fileSequence) return;
        window.__vehicleCertificateQr = result;
        if (result.length) {
          renderResult(
            result,
            `元画像からQRコードを ${result.length} 件読み取りました。用紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`
          );
        } else {
          renderResult(
            [],
            `元画像からQRコードを読み取れませんでした。OCR処理はそのまま続行します。用紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`
          );
        }
      } catch (e) {
        if (!dead) renderResult([], `QR自動読取エラー: ${e?.message || e}`);
      } finally {
        running = false;
      }
    };

    // React側が input.value を空にする前に、選択された元ファイルを捕まえる。
    const onFileChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (file) void scanOriginalFile(file);
    };
    document.addEventListener("change", onFileChange, true);

    // 既存画面・復帰時の保険としてプレビューからも自動解析する。
    const scanPreview = async () => {
      if (dead || running) return;
      const img = document.querySelector("img.preview");
      if (!img?.src || img.src === lastPreviewSrc) return;
      lastPreviewSrc = img.src;
      running = true;
      try {
        const source = await canvasFromImage(img);
        const { result, paper } = await scanSource(source, "プレビュー");
        if (dead) return;
        if (result.length) {
          window.__vehicleCertificateQr = result;
          renderResult(
            result,
            `プレビューからQRコードを ${result.length} 件読み取りました。用紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`
          );
        }
      } catch {
        // 元画像側が主系統なので、プレビュー側の失敗は表示を上書きしない。
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => void scanPreview());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = window.setInterval(() => void scanPreview(), 1000);
    void scanPreview();

    return () => {
      dead = true;
      fileSequence += 1;
      document.removeEventListener("change", onFileChange, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
