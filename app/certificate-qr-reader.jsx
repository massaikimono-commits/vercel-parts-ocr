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

async function imageCanvas(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const max = 3600;
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

function regionCanvas(source, box, targetWidth = 1800) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.min(1.6, Math.max(0.55, targetWidth / sw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function codeBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const points = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = Math.max(12, Math.round(Math.min(width, height) * 0.018));
  const left = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const top = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const right = Math.min(width, Math.ceil(Math.max(...xs) + pad));
  const bottom = Math.min(height, Math.ceil(Math.max(...ys) + pad));
  return { left, top, right, bottom };
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
    found.push({
      label,
      data: code.data || "",
      binary,
      hex: hex(binary),
    });

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

function renderResult(result, message = "") {
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

    const textLabel = document.createElement("div");
    textLabel.style.marginTop = "8px";
    textLabel.textContent = "文字列";
    card.appendChild(textLabel);

    const textPre = document.createElement("pre");
    textPre.style.whiteSpace = "pre-wrap";
    textPre.style.wordBreak = "break-all";
    textPre.style.fontSize = "12px";
    textPre.style.background = "#f8fafc";
    textPre.style.padding = "8px";
    textPre.style.borderRadius = "8px";
    textPre.textContent = visibleText(item.data) || "(文字列なし)";
    card.appendChild(textPre);

    const hexLabel = document.createElement("div");
    hexLabel.textContent = "バイナリ HEX";
    card.appendChild(hexLabel);

    const hexPre = document.createElement("pre");
    hexPre.style.whiteSpace = "pre-wrap";
    hexPre.style.wordBreak = "break-all";
    hexPre.style.fontSize = "11px";
    hexPre.style.background = "#f8fafc";
    hexPre.style.padding = "8px";
    hexPre.style.borderRadius = "8px";
    hexPre.textContent = item.hex || "(バイナリなし)";
    card.appendChild(hexPre);

    box.appendChild(card);
  });

  details.appendChild(box);
}

async function scanVehicleQr(img) {
  const mod = await import("jsqr");
  const jsQR = mod.default || mod;
  const source = await imageCanvas(img);

  // 車検証記録事項のQR群は用紙下部に並ぶ。全体下部＋重なりタイルで小さいQRも拾う。
  const regions = [
    ["下部全体", [0.25, 0.64, 0.74, 0.31], 2100],
    ["下部左", [0.28, 0.66, 0.35, 0.27], 1500],
    ["下部中央", [0.45, 0.66, 0.34, 0.27], 1500],
    ["下部右", [0.64, 0.66, 0.35, 0.27], 1500],
    ["最下部", [0.30, 0.74, 0.68, 0.22], 1900],
  ];

  const all = [];
  for (const [label, box, target] of regions) {
    const c = regionCanvas(source, box, target);
    all.push(...scanMany(jsQR, c, label));
  }
  return uniqueCodes(all);
}

export default function CertificateQrReader() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    let running = false;
    let lastSrc = "";

    const run = async () => {
      if (dead || running) return;
      const img = document.querySelector("img.preview");
      if (!img?.src || img.src === lastSrc) return;

      running = true;
      lastSrc = img.src;
      renderResult([], "QRコードを検索中…");

      try {
        const result = await scanVehicleQr(img);
        if (dead) return;
        if (result.length) {
          window.__vehicleCertificateQr = result;
          renderResult(result);
        } else {
          window.__vehicleCertificateQr = [];
          renderResult([], "QRコードを読み取れませんでした。写真全体が入り、QRが潰れていない画像で再試行してください。");
        }
      } catch (e) {
        if (!dead) renderResult([], `QR読取エラー: ${e?.message || e}`);
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
    };
  }, []);

  return null;
}
