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

async function sourceCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("QR解析用画像を開けませんでした"));
      node.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 4200 / Math.max(iw, ih));
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

function cropRegion(source, x0, y0, w0, h0, mode = "color", target = 1350) {
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.max(1, Math.min(5.2, target / Math.max(1, sw)));
  const pad = 42;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);

  if (mode !== "color") {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      sum += g;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    }
    const avg = sum / Math.max(1, image.data.length / 4);
    const threshold = Math.max(95, Math.min(225, avg - 8));
    for (let p = 0; p < image.data.length; p += 4) {
      let v = image.data[p];
      if (mode === "contrast") v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.15 + 148)));
      if (mode === "binary") v = v < threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function makeReader() {
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  return new browser.BrowserQRCodeReader(hints);
}

async function decode(reader, canvas, slot, tag) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return null;
    const binary = Array.from(raw || []);
    return {
      slot,
      label: `高速下段6個/QR${slot + 1}/${tag}/ZXing`,
      data,
      binary,
      hex: hex(binary),
    };
  } catch {
    return null;
  }
}

function unique(items) {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item.hex || item.data;
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
}

function keiVersion(item) {
  const f = String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((x) => x.trim());
  return f[0] === "K" ? (f[1] || "") : "";
}

function showStatus(text) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-qr-fast-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-fast-status";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.borderRadius = "10px";
    box.style.background = "#eefaf2";
    box.style.border = "1px solid #bfe6ce";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}

async function scanFast(file) {
  const source = await sourceCanvas(file);
  const reader = await makeReader();
  const found = [];
  const xs = [0.43, 0.52, 0.61, 0.70, 0.79, 0.875];
  const started = performance.now();

  const runPass = async (y, mode, slots = [0, 1, 2, 3, 4, 5]) => {
    for (const slot of slots) {
      if (found.some((x) => x.slot === slot)) continue;
      const canvas = cropRegion(source, xs[slot], y, 0.125, 0.145, mode, mode === "color" ? 1250 : 1450);
      try {
        const hit = await decode(reader, canvas, slot, `y${y}/${mode}`);
        if (hit) found.push(hit);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  try {
    // 1) 最初の1巡は最も成功率が高かったコントラスト版だけ。
    await runPass(0.80, "contrast");
    // 2) 取りこぼしだけ位置を少し下げて再試行。
    if (unique(found).length < 6) await runPass(0.835, "contrast");
    // 3) 重要QR(車両番号/車台番号系)だけ最後に原色で再試行。
    const important = [0, 1, 5].filter((slot) => !found.some((x) => x.slot === slot));
    if (important.length) await runPass(0.805, "color", important);
  } finally {
    source.width = 1;
    source.height = 1;
  }

  return { result: unique(found), elapsed: Math.round(performance.now() - started) };
}

export default function CertificateQrFast() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let stopped = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || file.type === "application/pdf") return;
      const myToken = ++token;
      showStatus("高速QR解析中…");
      void scanFast(file).then(({ result, elapsed }) => {
        if (stopped || myToken !== token) return;
        window.__vehicleCertificateQr = result;
        window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: result }));
        const versions = [...new Set(result.map(keiVersion).filter(Boolean))].sort();
        showStatus(`高速QR: ${result.length}/6件 / ${elapsed}ms${versions.length ? ` / 軽QR ${versions.join(",")}` : ""}`);
      }).catch((e) => {
        if (!stopped && myToken === token) showStatus(`高速QR解析エラー: ${e?.message || e}`);
      });
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
