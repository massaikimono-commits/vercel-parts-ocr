"use client";

import { useEffect } from "react";

function hex(bytes = []) {
  return Array.from(bytes)
    .map((value) => Number(value).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return Boolean(section?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}

function unique(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item) continue;
    const key = item.hex || item.data;
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

function keiVersion(item) {
  const fields = String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((value) => value.trim());
  return fields[0] === "K" ? (fields[1] || "") : "";
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
    const scale = Math.min(1, 2800 / Math.max(iw, ih));
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

function cropSlot(source, x0, y0, mode = "color") {
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * 0.125)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * 0.145)));
  const target = 820;
  const scale = Math.max(1, Math.min(4.2, target / sw));
  const pad = 24;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);

  if (mode === "contrast") {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      const v = Math.max(0, Math.min(255, Math.round((g - 128) * 2 + 148)));
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
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

function decodeJs(jsQR, canvas, slot, tag) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) return null;
    const binary = Array.from(code.binaryData || []);
    return {
      slot,
      label: `高速QR/QR${slot + 1}/${tag}/jsQR`,
      data: code.data || "",
      binary,
      hex: hex(binary),
    };
  } catch {
    return null;
  }
}

async function decodeZxing(reader, canvas, slot, tag) {
  if (!reader) return null;
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return null;
    const binary = Array.from(raw || []);
    return {
      slot,
      label: `高速QR/QR${slot + 1}/${tag}/ZXing`,
      data,
      binary,
      hex: hex(binary),
    };
  } catch {
    return null;
  }
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
  const current = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
  const combined = unique([...current, ...found]);
  window.__vehicleCertificateQr = combined;
  window.__vehicleCertificateLowerSixDone = true;
  window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
  window.dispatchEvent(new Event("vehicle-certificate-lower-six-done"));
  const versions = [...new Set(combined.map(keiVersion).filter(Boolean))].sort();
  showStatus(`高速QR完了: ${elapsed}ms / QR ${combined.length}件${versions.length ? ` / 軽QR ${versions.join(",")}` : ""} / 最大2sweep`);
}

export default function CertificateQrReader() {
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
      window.__vehicleCertificateLowerSixDone = false;
      showStatus("高速QR解析中… 6枠を最大2sweepだけ確認します");

      void (async () => {
        const started = performance.now();
        let source = null;
        try {
          source = await sourceCanvas(file);
          if (stopped || mine !== generation) return;
          const decoders = await makeDecoders();
          const xs = [0.43, 0.52, 0.61, 0.70, 0.79, 0.875];
          const found = [];
          const occupied = new Set();

          const sweep = async (y, mode) => {
            for (let slot = 0; slot < xs.length; slot += 1) {
              if (stopped || mine !== generation) return;
              if (occupied.has(slot)) continue;
              const crop = cropSlot(source, xs[slot], y, mode);
              try {
                let hit = decodeJs(decoders.jsQR, crop, slot, `${mode}/y${y}`);
                if (!hit) hit = await decodeZxing(decoders.zxing, crop, slot, `${mode}/y${y}`);
                if (hit) {
                  found.push(hit);
                  occupied.add(slot);
                }
              } finally {
                crop.width = 1;
                crop.height = 1;
              }
              await new Promise((resolve) => window.setTimeout(resolve, 0));
            }
          };

          await sweep(0.795, "color");
          if (occupied.size < 6) await sweep(0.825, "contrast");
          if (stopped || mine !== generation) return;
          publish(unique(found), Math.round(performance.now() - started));
        } catch (error) {
          if (!stopped && mine === generation) {
            window.__vehicleCertificateLowerSixDone = true;
            window.dispatchEvent(new Event("vehicle-certificate-lower-six-done"));
            showStatus(`高速QRエラー: ${error?.message || error} / OCR補完へ移行`);
          }
        } finally {
          if (source) {
            source.width = 1;
            source.height = 1;
          }
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
