"use client";

import { useEffect } from "react";

function hex(bytes = []) {
  return Array.from(bytes).map((v) => Number(v).toString(16).padStart(2, "0")).join(" ").toUpperCase();
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}

function unique(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = item?.hex || item?.data;
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function keiVersion(item) {
  const f = String(item?.data || "").normalize("NFKC").replace(/\u3000/g, " ").split("/").map((v) => v.trim());
  return f[0] === "K" ? (f[1] || "") : "";
}

async function sourceCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("QR解析用画像を開けませんでした"));
      node.src = url;
    });
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    // 3024x4032クラスは原寸を維持。QRのモジュールを先に潰さない。
    const scale = Math.min(1, 4300 / Math.max(iw, ih));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(iw * scale));
    canvas.height = Math.max(1, Math.round(ih * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeCrop(source, x, y, w, h, targetWidth = 900, contrast = false) {
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(5, targetWidth / Math.max(1, sw)));
  const pad = 22;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  if (contrast) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < img.data.length; p += 4) {
      const g = Math.round(img.data[p] * 0.22 + img.data[p + 1] * 0.70 + img.data[p + 2] * 0.08);
      const v = Math.max(0, Math.min(255, Math.round((g - 128) * 1.75 + 150)));
      img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v; img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
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
    zxing = new browser.BrowserQRCodeReader(hints);
  } catch {}
  return { jsQR, zxing };
}

function fromJs(jsQR, canvas, label) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) return null;
    const binary = Array.from(code.binaryData || []);
    return { label, data: code.data || "", binary, hex: hex(binary) };
  } catch { return null; }
}

async function fromZxing(reader, canvas, label) {
  if (!reader) return null;
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return null;
    const binary = Array.from(raw || []);
    return { label, data, binary, hex: hex(binary) };
  } catch { return null; }
}

function maskBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = 18;
  return {
    x: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    y: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    w: Math.min(width, Math.ceil(Math.max(...xs) + pad)) - Math.max(0, Math.floor(Math.min(...xs) - pad)),
    h: Math.min(height, Math.ceil(Math.max(...ys) + pad)) - Math.max(0, Math.floor(Math.min(...ys) - pad)),
  };
}

function stripJs(jsQR, canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (let i = 0; i < 6; i += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) break;
    const binary = Array.from(code.binaryData || []);
    found.push({ label: `高速QR/strip/${i + 1}/jsQR`, data: code.data || "", binary, hex: hex(binary) });
    const b = maskBounds(code, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.x, b.y, Math.max(1, b.w), Math.max(1, b.h));
  }
  return found;
}

function ensureDebug() {
  const host = document.querySelector("img.preview")?.closest("section.card") ||
    [...document.querySelectorAll("section.card")].find((node) => node.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
  if (!host) return null;
  let box = document.getElementById("certificate-qr-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-qr-debug";
    box.open = true;
    box.style.marginTop = "14px";
    box.style.border = "1px solid #b9d2ff";
    box.style.borderRadius = "14px";
    box.style.background = "#f5f9ff";
    box.style.padding = "14px";
    box.innerHTML = '<summary style="font-weight:800">車検証QR（確認用）</summary><div data-fast-qr-status style="margin-top:10px;font-weight:800"></div>';
    host.appendChild(box);
  }
  return box;
}

function showStatus(text) {
  const box = ensureDebug();
  let node = box?.querySelector("[data-fast-qr-status]");
  if (!node && box) {
    node = document.createElement("div");
    node.dataset.fastQrStatus = "1";
    box.appendChild(node);
  }
  if (node) node.textContent = text;
}

function publish(found, elapsed) {
  const combined = unique(found);
  window.__vehicleCertificateQr = combined;
  window.__vehicleCertificateLowerSixDone = true;
  window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
  window.dispatchEvent(new Event("vehicle-certificate-lower-six-done"));
  const versions = [...new Set(combined.map(keiVersion).filter(Boolean))].sort();
  showStatus(`高速QR v2完了: ${elapsed}ms / QR ${combined.length}件${versions.length ? ` / 軽QR ${versions.join(",")}` : ""} / 最大2sweep＋不足時strip1回`);
}

export default function CertificateQrReaderV2() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let stopped = false;
    let generation = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || file.type === "application/pdf") return;
      generation += 1;
      const mine = generation;
      window.__vehicleCertificateQr = [];
      window.__vehicleCertificateLowerSixDone = false;
      showStatus("高速QR v2解析中… QR6個を中央基準で確認します");

      void (async () => {
        const started = performance.now();
        let source = null;
        try {
          source = await sourceCanvas(file);
          if (stopped || mine !== generation) return;
          const decoders = await makeDecoders();
          // 実画像上の6個のQR中心。以前はこの値を左端として扱っていたためQRを切ってしまっていた。
          const centers = [0.445, 0.525, 0.602, 0.678, 0.755, 0.838];
          const found = [];
          const occupied = new Set();

          const sweep = async (y, contrast) => {
            for (let slot = 0; slot < centers.length; slot += 1) {
              if (stopped || mine !== generation) return;
              if (occupied.has(slot)) continue;
              const x = Math.max(0, centers[slot] - 0.058);
              const crop = makeCrop(source, x, y, 0.116, 0.185, 940, contrast);
              try {
                let hit = fromJs(decoders.jsQR, crop, `高速QR v2/QR${slot + 1}/${contrast ? "contrast" : "color"}/jsQR`);
                if (!hit) hit = await fromZxing(decoders.zxing, crop, `高速QR v2/QR${slot + 1}/${contrast ? "contrast" : "color"}/ZXing`);
                if (hit) { found.push(hit); occupied.add(slot); }
              } finally { crop.width = 1; crop.height = 1; }
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          };

          await sweep(0.755, false);
          if (unique(found).length < 4) await sweep(0.775, true);

          // 個別枠で3件未満だけ、下段全体をjsQRで1回だけ追加確認する。
          if (unique(found).length < 3) {
            const strip = makeCrop(source, 0.37, 0.745, 0.60, 0.205, 2500, false);
            try { found.push(...stripJs(decoders.jsQR, strip)); }
            finally { strip.width = 1; strip.height = 1; }
          }

          if (stopped || mine !== generation) return;
          publish(unique(found), Math.round(performance.now() - started));
        } catch (error) {
          if (!stopped && mine === generation) {
            window.__vehicleCertificateLowerSixDone = true;
            window.dispatchEvent(new Event("vehicle-certificate-lower-six-done"));
            showStatus(`高速QR v2エラー: ${error?.message || error} / OCR補完へ移行`);
          }
        } finally {
          if (source) { source.width = 1; source.height = 1; }
        }
      })();
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      generation += 1;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
