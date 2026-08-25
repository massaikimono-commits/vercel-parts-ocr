"use client";

import { useEffect } from "react";

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return Boolean(section?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}

function keiVersion(item) {
  const fields = String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((value) => value.trim());
  return fields[0] === "K" ? (fields[1] || "") : "";
}

function hasK7(items = []) {
  return items.some((item) => /^7\d$/.test(keiVersion(item)));
}

function hex(bytes = []) {
  return Array.from(bytes)
    .map((value) => Number(value).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function showStatus(text) {
  const host = document.getElementById("certificate-qr-debug");
  if (!host) return;
  let box = document.getElementById("certificate-qr-k7-targeted-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-k7-targeted-status";
    box.style.marginTop = "8px";
    box.style.padding = "9px";
    box.style.borderRadius = "9px";
    box.style.background = "#eef8ff";
    box.style.border = "1px solid #b7d9f7";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}

async function sourceCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("画像を開けませんでした"));
      node.src = url;
    });
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const scale = Math.min(1, 3800 / Math.max(iw, ih));
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

function cropSlot(source, x0, y0) {
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * 0.125)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * 0.145)));
  const scale = Math.max(1, Math.min(4.8, 1250 / sw));
  const pad = 52;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
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

async function decode(reader, canvas, slot) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return null;
    const binary = Array.from(raw || []);
    return {
      slot,
      label: `軽量K7補助/QR${slot + 1}/y0.835/color/ZXing`,
      data,
      binary,
      hex: hex(binary),
    };
  } catch {
    return null;
  }
}

function mergeQr(item) {
  if (!item) return false;
  const current = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
  const key = item.hex || item.data;
  if (!key) return false;
  const exists = current.some((value) => (value?.hex || value?.data) === key);
  if (exists) return false;
  const combined = [...current, item];
  window.__vehicleCertificateQr = combined;
  window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
  return true;
}

export default function CertificateQrK7TargetedRecovery() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let stopped = false;
    let file = null;
    let generation = 0;
    let running = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const selected = input.files?.[0];
      if (!selected || selected.type === "application/pdf") return;
      generation += 1;
      file = selected;
      running = false;
    };

    const onLowerDone = async () => {
      if (stopped || running || !file) return;
      const current = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      if (hasK7(current)) {
        showStatus("K7系QR取得済み → 追加探索なし");
        return;
      }

      running = true;
      const myGeneration = generation;
      showStatus("K7系QR未取得 → 下段6枠を1回だけ軽量補助探索中…");
      let source = null;
      try {
        source = await sourceCanvas(file);
        const reader = await makeReader();
        const xs = [0.43, 0.52, 0.61, 0.70, 0.79, 0.875];
        let recovered = null;

        for (let slot = 0; slot < xs.length; slot += 1) {
          if (stopped || myGeneration !== generation) return;
          const crop = cropSlot(source, xs[slot], 0.835);
          try {
            const hit = await decode(reader, crop, slot);
            if (hit && /^7\d$/.test(keiVersion(hit))) {
              recovered = hit;
              break;
            }
          } finally {
            crop.width = 1;
            crop.height = 1;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }

        if (stopped || myGeneration !== generation) return;
        if (recovered && mergeQr(recovered)) {
          showStatus(`K7系QR ${keiVersion(recovered)} を補助探索で回復 → stateへ再反映`);
        } else {
          showStatus("K7系QRは補助1passでも未取得 → OCR補完へ渡します");
        }
      } catch (error) {
        if (!stopped) showStatus(`K7系QR補助探索エラー: ${error?.message || error}`);
      } finally {
        if (source) {
          source.width = 1;
          source.height = 1;
        }
        running = false;
      }
    };

    document.addEventListener("change", onChange, true);
    window.addEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    return () => {
      stopped = true;
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    };
  }, []);

  return null;
}
