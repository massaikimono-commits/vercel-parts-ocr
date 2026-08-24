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
    const scale = Math.min(1, 3800 / Math.max(iw, ih));
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

function cropRegion(source, x0, y0, w0, h0, mode, target = 1250) {
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.max(1, Math.min(4.8, target / sw));
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
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      const v = Math.max(0, Math.min(255, Math.round((g - 128) * 2.25 + 150)));
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return c;
}

function cropSlot(source, x0, y0, mode) {
  return cropRegion(source, x0, y0, 0.125, 0.145, mode, 1250);
}

function cropFocused(source, x0, y0, mode) {
  return cropRegion(source, x0, y0, 0.095, 0.125, mode, 1550);
}

async function makeReader() {
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  return new browser.BrowserQRCodeReader(hints);
}

async function decodeSlot(reader, canvas, slot, tag) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return null;
    const binary = Array.from(raw || []);
    return {
      slot,
      label: `軽量下段6個/QR${slot + 1}/${tag}/ZXing`,
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

function hasKeiCode(items, firstDigit) {
  return unique(items).some((item) => new RegExp(`^${firstDigit}\\d$`).test(keiVersion(item)));
}

function hasIdentityKeiCode(items) {
  return hasKeiCode(items, "0") || hasKeiCode(items, "2");
}

async function recoverImportantKeiCodes(source, reader, found, known = []) {
  // 旧・軽自動車紙車検証で重要なコード2(車台/原動機)、コード6(種別/用途/形状等)、
  // さらにコード1(車両番号/車台)だけを狭い切り出しで再試行する。
  // 全面再走査はせず、Safariの負荷を抑える。
  const plans = [
    { digit: "2", slot: 1, xs: [0.485, 0.515, 0.545] },
    { digit: "7", slot: 5, xs: [0.765, 0.795, 0.825] },
    { digit: "0", slot: 0, xs: [0.405, 0.435, 0.465] },
  ];
  const attempts = [
    [0.79, "contrast"],
    [0.835, "contrast"],
    [0.805, "color"],
  ];
  const all = () => [...known, ...found];

  for (const plan of plans) {
    if (hasKeiCode(all(), plan.digit)) continue;
    outer: for (const [y, mode] of attempts) {
      for (const x of plan.xs) {
        const focused = cropFocused(source, x, y, mode);
        try {
          const hit = await decodeSlot(reader, focused, plan.slot, `重点K${plan.digit}/x${x}/y${y}/${mode}`);
          if (hit) found.push(hit);
          if (hasKeiCode(all(), plan.digit)) break outer;
        } finally {
          focused.width = 1;
          focused.height = 1;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
  }
}

async function scanSixSlots(file, known = []) {
  const source = await sourceCanvas(file);
  const reader = await makeReader();
  const found = [];
  const identityOnly = unique(known).length >= 3 && !hasIdentityKeiCode(known);

  // QRがほとんど未取得なら従来の軽量6枠スキャン。
  // すでに3件以上取得済みなら、重複スキャンせず車両番号/車台番号を持つ重要QRだけを狙う。
  const xs = [0.43, 0.52, 0.61, 0.70, 0.79, 0.875];
  const passes = [
    [0.80, "color"],
    [0.80, "contrast"],
    [0.835, "color"],
    [0.835, "contrast"],
  ];

  try {
    if (!identityOnly) {
      for (const [y, mode] of passes) {
        for (let slot = 0; slot < xs.length; slot += 1) {
          if (found.some((x) => x.slot === slot)) continue;
          const crop = cropSlot(source, xs[slot], y, mode);
          try {
            const hit = await decodeSlot(reader, crop, slot, `y${y}/${mode}`);
            if (hit) found.push(hit);
          } finally {
            crop.width = 1;
            crop.height = 1;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        if (unique(found).length >= 6) break;
      }
    }

    const all = [...known, ...found];
    if (all.some((item) => keiVersion(item))) {
      await recoverImportantKeiCodes(source, reader, found, known);
    }
  } finally {
    source.width = 1;
    source.height = 1;
  }

  return unique(found);
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
      if (existing.length >= 3 && hasIdentityKeiCode(existing)) {
        pending = null;
        showStatus("主要QR取得済み。車両番号・車台番号の追加スキャンは省略しました。");
        return;
      }

      const elapsed = Date.now() - startedAt;
      if (!sawProgress && elapsed < 18000) return;
      if (sawProgress && elapsed < 7000) return;

      const file = pending;
      const myToken = token;
      pending = null;
      running = true;
      showStatus(existing.length >= 3
        ? "既読QRは再走査せず、車両番号・車台番号QRだけを重点解析中…"
        : "OCR完了後に、下段6個をZXingで個別解析中…");
      try {
        const result = await scanSixSlots(file, existing);
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
        const versions = [...new Set(combined.map(keiVersion).filter(Boolean))].sort();
        const slots = result.map((x) => `${Number.isFinite(x.slot) ? x.slot + 1 : "?"}:${keiVersion(x) || "QR"}`).join(", ");
        showStatus(`下段6QR ZXing解析: 新規${result.length}件 / QR合計 ${combined.length}件${versions.length ? ` / 軽QR ${versions.join(",")}` : ""}${slots ? ` / 検出 ${slots}` : ""}。既読QRの重複処理を省きました。`);
      } catch (e) {
        if (!stopped) showStatus(`下段6QR ZXing解析エラー: ${e?.message || e}`);
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
