"use client";

import { useEffect } from "react";

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function qrFields(item) {
  return String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((x) => x.trim());
}

function hasKeiCode(items, digit) {
  return (items || []).some((item) => {
    const f = qrFields(item);
    return f[0] === "K" && new RegExp(`^${digit}\\d$`).test(f[1] || "");
  });
}

function keyOf(item) {
  return item?.hex || item?.data || "";
}

function hex(bytes = []) {
  return Array.from(bytes)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

async function sourceCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => resolve(n);
      n.onerror = () => reject(new Error("QR補完用画像を開けませんでした"));
      n.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 4200 / Math.max(iw, ih));
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

function cropFocused(source, x0, y0, mode = "contrast") {
  const w0 = 0.095, h0 = 0.125;
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.max(1, Math.min(5.2, 1550 / Math.max(1, sw)));
  const pad = 52;
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
      const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      const v = Math.max(0, Math.min(255, Math.round((g - 128) * 2.25 + 150)));
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return c;
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
      label: `QR補完/QR${slot + 1}/${tag}/ZXing`,
      data,
      binary,
      hex: hex(binary),
    };
  } catch {
    return null;
  }
}

function showStatus(text) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-qr-rescue-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-rescue-status";
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

async function rescue(file) {
  const existing = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
  const wanted = ["0", "2", "7"].filter((digit) => !hasKeiCode(existing, digit));
  if (!wanted.length) return { added: [], elapsed: 0, skipped: true };

  const source = await sourceCanvas(file);
  const reader = await makeReader();
  const started = performance.now();
  const added = [];
  const plans = {
    "0": { slot: 0, xs: [0.405, 0.435, 0.465] },
    "2": { slot: 1, xs: [0.485, 0.515, 0.545] },
    "7": { slot: 5, xs: [0.765, 0.795, 0.825] },
  };
  const attempts = [
    [0.790, "contrast"],
    [0.835, "contrast"],
    [0.805, "color"],
  ];

  try {
    for (const digit of wanted) {
      const plan = plans[digit];
      outer: for (const [y, mode] of attempts) {
        for (const x of plan.xs) {
          const c = cropFocused(source, x, y, mode);
          try {
            const hit = await decode(reader, c, plan.slot, `K${digit}/x${x}/y${y}/${mode}`);
            if (hit) {
              added.push(hit);
              const all = [...existing, ...added];
              if (hasKeiCode(all, digit)) break outer;
            }
          } finally {
            c.width = 1;
            c.height = 1;
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
  } finally {
    source.width = 1;
    source.height = 1;
  }
  return { added, elapsed: Math.round(performance.now() - started), skipped: false };
}

export default function CertificateQrRescue() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2" && location.pathname !== "/vehicle-workflow-fast") return;
    let dead = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++token;
      void (async () => {
        // Give the normal fast scan first chance; rescue only its misses.
        await new Promise((resolve) => setTimeout(resolve, 1300));
        if (dead || id !== token) return;
        const before = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const missing = ["0", "2", "7"].filter((d) => !hasKeiCode(before, d));
        if (!missing.length) {
          showStatus("重要QR 0/2/7 取得済み。追加解析は省略しました。");
          return;
        }
        showStatus(`不足QR K${missing.join(",K")} を重点補完中…`);
        const { added, elapsed } = await rescue(file);
        if (dead || id !== token) return;
        const current = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const combined = [...current];
        const keys = new Set(current.map(keyOf).filter(Boolean));
        for (const item of added) {
          const key = keyOf(item);
          if (!key || keys.has(key)) continue;
          keys.add(key);
          combined.push(item);
        }
        window.__vehicleCertificateQr = combined;
        if (added.length) {
          window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
        }
        const recovered = ["0", "2", "7"].filter((d) => hasKeiCode(combined, d));
        showStatus(`QR補完: +${added.length}件 / ${elapsed}ms / 重要QR ${recovered.map((d) => `K${d}`).join(",") || "未取得"}`);
      })().catch((e) => {
        if (!dead && id === token) showStatus(`QR補完エラー: ${e?.message || e}`);
      });
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
