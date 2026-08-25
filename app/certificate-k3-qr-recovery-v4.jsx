"use client";

import { useEffect } from "react";

function hex(bytes = []) {
  return Array.from(bytes).map((v) => Number(v).toString(16).padStart(2, "0")).join(" ").toUpperCase();
}

function fields(item) {
  return String(item?.data || "").normalize("NFKC").replace(/\u3000/g, " ").split("/").map((v) => v.trim());
}

function version(item) {
  const f = fields(item);
  return f[0] === "K" ? (f[1] || "") : "";
}

function hasK3(items = []) {
  return items.some((item) => /^3\d$/.test(version(item)));
}

function unique(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = item?.hex || item?.data;
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}

async function sourceCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("K3 QR解析用画像を開けませんでした"));
      node.src = url;
    });
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
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

function cropSlot(source, centerX, y, contrast = false) {
  const x = Math.max(0, centerX - 0.068);
  const w = Math.min(1 - x, 0.136);
  const h = 0.19;
  const sx = Math.round(source.width * x);
  const sy = Math.round(source.height * y);
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(4, 1250 / Math.max(1, sw)));
  const pad = 18;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  if (contrast) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      const v = Math.max(0, Math.min(255, Math.round((g - 128) * 1.9 + 150)));
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

function fromJs(jsQR, canvas, label) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) return null;
    const binary = Array.from(code.binaryData || []);
    return { label, data: code.data || "", binary, hex: hex(binary) };
  } catch {
    return null;
  }
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
  } catch {
    return null;
  }
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

function ensureDebug() {
  const host = document.getElementById("certificate-qr-debug") ||
    document.querySelector("img.preview")?.closest("section.card") ||
    [...document.querySelectorAll("section.card")].find((node) => node.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
  if (!host) return null;
  let box = document.getElementById("certificate-k3-qr-recovery-v4-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-k3-qr-recovery-v4-debug";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.border = "1px solid #b9d2ff";
    box.style.borderRadius = "12px";
    box.style.background = "#f7fbff";
    box.innerHTML = '<summary style="font-weight:800">K3/32 QR補完 v4（確認用）</summary><div data-k3-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  return box;
}

function showStatus(text) {
  const box = ensureDebug();
  const node = box?.querySelector("[data-k3-status]");
  if (node) node.textContent = text;
}

export default function CertificateK3QrRecoveryV4() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pendingFile = null;
    let generation = 0;
    let running = false;
    let stopped = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pendingFile = file;
      generation += 1;
      running = false;
      showStatus("高速QRの結果待ち");
    };

    const run = async () => {
      if (stopped || running || !pendingFile) return;
      const known = unique(Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : []);
      if (hasK3(known)) {
        showStatus(`K3取得済み: ${known.map(version).filter(Boolean).join(",")}`);
        pendingFile = null;
        return;
      }

      running = true;
      const file = pendingFile;
      const mine = generation;
      const started = performance.now();
      showStatus("K3/32だけ右補正した6枠を1周確認中…");
      let source = null;
      try {
        const { jsQR, zxing } = await makeDecoders();
        source = await sourceCanvas(file);
        if (stopped || mine !== generation) return;

        // 実画像のQR中心は従来値より右寄り。K3だけ不足時にこの6中心を確認する。
        const centers = [0.515, 0.595, 0.675, 0.755, 0.835, 0.915];
        const ys = [0.748, 0.778];
        const found = [];

        outer:
        for (const y of ys) {
          for (let i = 0; i < centers.length; i += 1) {
            if (stopped || mine !== generation) return;
            const canvas = cropSlot(source, centers[i], y, y > 0.76);
            try {
              let hit = fromJs(jsQR, canvas, `K3-v4/QR${i + 1}/jsQR`);
              if (hit) {
                found.push(hit);
                if (/^3\d$/.test(version(hit))) break outer;
              } else {
                hit = await fromZxing(zxing, canvas, `K3-v4/QR${i + 1}/ZXing`);
                if (hit) {
                  found.push(hit);
                  if (/^3\d$/.test(version(hit))) break outer;
                }
              }
            } finally {
              canvas.width = 1;
              canvas.height = 1;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        if (stopped || mine !== generation) return;
        const combined = unique([...known, ...found]);
        const elapsed = Math.round(performance.now() - started);
        if (!hasK3(combined)) {
          showStatus(`K3/32未取得 / ${elapsed}ms / 既読 ${known.map(version).filter(Boolean).join(",") || "なし"} / OCR補完を維持`);
          pendingFile = null;
          return;
        }

        window.__vehicleCertificateQr = combined;
        window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
        const versions = [...new Set(combined.map(version).filter(Boolean))].sort();
        showStatus(`K3/32取得 ✓ / ${elapsed}ms / QR合計 ${combined.length}件 / 軽QR ${versions.join(",")}`);
        pendingFile = null;
      } catch (error) {
        if (!stopped && mine === generation) showStatus(`K3補完エラー: ${error?.message || error}`);
      } finally {
        if (source) { source.width = 1; source.height = 1; }
        running = false;
      }
    };

    const onLowerDone = () => window.setTimeout(() => { void run(); }, 20);

    document.addEventListener("change", onChange, true);
    window.addEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    return () => {
      stopped = true;
      generation += 1;
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("vehicle-certificate-lower-six-done", onLowerDone);
    };
  }, []);
  return null;
}
