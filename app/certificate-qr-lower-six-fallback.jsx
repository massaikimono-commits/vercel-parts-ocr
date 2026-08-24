"use client";

import { useEffect } from "react";

function hex(bytes = []) {
  return Array.from(bytes)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
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

async function sourceCanvas(file) {
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
    // iPhoneのメモリを圧迫しない範囲。QRには十分な解像度を残す。
    const scale = Math.min(1, 3600 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cropBottomBand(source, y0, mode) {
  // 6個QRは用紙最下段の横一列。広域総当たりではなく、この帯だけを読む。
  const x0 = 0.32;
  const w0 = 0.67;
  const h0 = 0.20;
  const sx = Math.round(source.width * x0);
  const sy = Math.round(source.height * y0);
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const targetWidth = 2500;
  const scale = Math.max(1, Math.min(3, targetWidth / sw));
  const pad = 36;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);

  if (mode === "contrast") {
    const image = ctx.getImageData(0, 0, c.width, c.height);
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      const v = Math.max(0, Math.min(255, Math.round((g - 128) * 2.0 + 150)));
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return c;
}

function bounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 18;
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
}

function decodeMany(jsQR, canvas, tag) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) break;
    const binary = Array.from(code.binaryData || []);
    const pts = [code.location?.topLeftCorner, code.location?.topRightCorner, code.location?.bottomLeftCorner, code.location?.bottomRightCorner].filter(Boolean);
    const centerX = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : 0;
    found.push({
      tag,
      centerX,
      data: code.data || "",
      binary,
      hex: hex(binary),
    });
    const b = bounds(code, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.left, b.top, Math.max(1, b.right - b.left), Math.max(1, b.bottom - b.top));
  }
  return found;
}

function unique(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.hex || item.data;
    if (!key) continue;
    const old = map.get(key);
    if (!old || item.centerX < old.centerX) map.set(key, item);
  }
  return [...map.values()];
}

async function scanLowerRow(file) {
  const js = await import("jsqr");
  const jsQR = js.default || js;
  const source = await sourceCanvas(file);
  const all = [];
  try {
    // 撮影の上下ズレだけ3段階で吸収。1段につき色/コントラストの2回だけ。
    for (const y of [0.76, 0.81, 0.85]) {
      for (const mode of ["color", "contrast"]) {
        const band = cropBottomBand(source, y, mode);
        try {
          all.push(...decodeMany(jsQR, band, `下段6個/y${y}/${mode}`));
        } finally {
          band.width = 1;
          band.height = 1;
        }
        if (unique(all).length >= 6) break;
      }
      if (unique(all).length >= 6) break;
      // Safariへ描画機会を返して、UIを固めない。
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    source.width = 1;
    source.height = 1;
  }

  const result = unique(all)
    .sort((a, b) => a.centerX - b.centerX)
    .slice(0, 6)
    .map((item, index) => ({
      label: `軽量下段6個/QR${index + 1}/${item.tag}/jsQR`,
      data: item.data,
      binary: item.binary,
      hex: item.hex,
    }));
  return result;
}

export default function CertificateQrLowerSixFallback() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let stopped = false;
    let token = 0;
    let pending = null;
    let startedAt = 0;
    let sawProgress = false;
    let running = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || file.type === "application/pdf") return;
      token += 1;
      pending = file;
      startedAt = Date.now();
      sawProgress = false;
      running = false;
    };

    const timer = window.setInterval(async () => {
      if (stopped || running || !pending) return;
      if (document.querySelector(".progress")) {
        sawProgress = true;
        return;
      }

      const existing = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      if (existing.length >= 3) {
        pending = null;
        return;
      }

      const elapsed = Date.now() - startedAt;
      // OCRが確実に終わるまで追加QR処理は始めない。
      if (!sawProgress && elapsed < 18000) return;
      if (sawProgress && elapsed < 7000) return;

      const file = pending;
      const myToken = token;
      pending = null;
      running = true;
      showStatus("OCR完了後に、最下段6個QRだけを軽量解析中…");
      try {
        const result = await scanLowerRow(file);
        if (stopped || myToken !== token) return;
        const current = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const combined = [...current];
        const keys = new Set(current.map((x) => x?.hex || x?.data).filter(Boolean));
        for (const item of result) {
          const key = item.hex || item.data;
          if (!key || keys.has(key)) continue;
          keys.add(key);
          combined.push(item);
        }
        window.__vehicleCertificateQr = combined;
        if (combined.length) {
          window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
        }
        showStatus(`下段6QR軽量解析: ${result.length}件 / QR合計 ${combined.length}件。OCRを止めずに処理しました。`);
      } catch (e) {
        if (!stopped) showStatus(`下段6QR軽量解析エラー: ${e?.message || e}`);
      } finally {
        running = false;
      }
    }, 1000);

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      document.removeEventListener("change", onChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
