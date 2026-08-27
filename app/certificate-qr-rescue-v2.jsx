"use client";

import { useEffect } from "react";

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function fields(item) {
  return String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((x) => x.trim());
}

function version(item) {
  const f = fields(item);
  return f[0] === "K" ? (f[1] || "") : "";
}

function hasCode(items, codeDigit) {
  return (items || []).some((item) => new RegExp(`^${codeDigit}\\d$`).test(version(item)));
}

function wantedHit(item, codeDigit) {
  return !!item && new RegExp(`^${codeDigit}\\d$`).test(version(item));
}

function keyOf(item) {
  return item?.hex || item?.data || "";
}

function bytesHex(bytes = []) {
  return Array.from(bytes)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function decodeRawText(bytes = []) {
  const raw = Uint8Array.from(bytes || []);
  if (!raw.length) return "";
  for (const encoding of ["shift_jis", "utf-8"]) {
    try {
      const text = new TextDecoder(encoding).decode(raw).replace(/\0/g, "").trim();
      if (text && (text.includes("/") || /^K/.test(text))) return text;
    } catch {}
  }
  return "";
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
    const scale = Math.min(1, 4600 / Math.max(iw, ih));
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

function detectPaperLite(source) {
  const scale = Math.min(1, 720 / Math.max(source.width, source.height));
  const p = document.createElement("canvas");
  p.width = Math.max(1, Math.round(source.width * scale));
  p.height = Math.max(1, Math.round(source.height * scale));
  const ctx = p.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, p.width, p.height);
  const image = ctx.getImageData(0, 0, p.width, p.height).data;
  const step = Math.max(2, Math.floor(Math.max(p.width, p.height) / 360));
  const ok = (x, y) => {
    const i = (y * p.width + x) * 4;
    const r = image[i], g = image[i + 1], b = image[i + 2];
    const br = (r + g + b) / 3;
    return br > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 110;
  };
  const ys = [];
  for (let y = 0; y < p.height; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < p.width; x += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 8) return { x: 0, y: 0, w: source.width, h: source.height };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(p.height - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < p.width; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 8) return { x: 0, y: Math.round(top / scale), w: source.width, h: Math.round((bottom - top + 1) / scale) };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(p.width - 1, xs[xs.length - 1] + step * 2);
  return {
    x: Math.round(left / scale),
    y: Math.round(top / scale),
    w: Math.max(1, Math.round((right - left + 1) / scale)),
    h: Math.max(1, Math.round((bottom - top + 1) / scale)),
  };
}

function cropBand(source, paper, mode = "color") {
  const x0 = 0.38, y0 = 0.70, w0 = 0.62, h0 = 0.27;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(paper.w * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(paper.h * h0)));
  const scale = Math.max(1, Math.min(5.5, 3600 / Math.max(1, sw)));
  const pad = 48;
  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale) + pad * 2;
  out.height = Math.round(sh * scale) + pad * 2;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, out.width - pad * 2, out.height - pad * 2);

  if (mode !== "color") {
    const image = ctx.getImageData(0, 0, out.width, out.height);
    let sum = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const g = Math.round(image.data[i] * .22 + image.data[i + 1] * .70 + image.data[i + 2] * .08);
      sum += g;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = g;
    }
    const avg = sum / Math.max(1, image.data.length / 4);
    const th = Math.max(90, Math.min(225, avg - 7));
    for (let i = 0; i < image.data.length; i += 4) {
      const g = image.data[i];
      const v = mode === "binary"
        ? (g < th ? 0 : 255)
        : Math.max(0, Math.min(255, Math.round((g - 128) * 2.15 + 148)));
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return out;
}

function qrBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = Math.max(16, Math.round(Math.min(width, height) * .02));
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
}

function decodeBandJsQr(jsQR, canvas, tag) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!result) break;
    const binary = Array.from(result.binaryData || []);
    const data = result.data || decodeRawText(binary);
    if (data || binary.length) {
      found.push({
        slot: null,
        label: `QR帯域補完/${tag}/jsQR`,
        data,
        binary,
        hex: binary.length ? bytesHex(binary) : "",
      });
    }
    const b = qrBounds(result, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.left, b.top, Math.max(1, b.right - b.left), Math.max(1, b.bottom - b.top));
  }
  return found;
}

function cropQr(source, x0, y0, mode = "contrast") {
  const w0 = 0.078;
  const h0 = 0.115;
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.max(1, Math.min(7.5, 1550 / Math.max(1, sw)));
  const pad = 64;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);

  if (mode !== "color") {
    const image = ctx.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      sum += g;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    }
    const avg = sum / Math.max(1, image.data.length / 4);
    const th = Math.max(92, Math.min(220, avg - 7));
    for (let p = 0; p < image.data.length; p += 4) {
      const g = image.data[p];
      const v = mode === "binary"
        ? (g < th ? 0 : 255)
        : Math.max(0, Math.min(255, Math.round((g - 128) * 2.25 + 150)));
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return c;
}

async function makeZxing() {
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  return new browser.BrowserQRCodeReader(hints);
}

async function decodeZxing(reader, canvas, slot, tag) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return null;
    const binary = Array.from(raw || []);
    return {
      slot,
      label: `QR重点補完/QR${slot + 1}/${tag}/ZXing`,
      data,
      binary,
      hex: bytesHex(binary),
    };
  } catch {
    return null;
  }
}

async function decodeJsQr(jsQR, canvas, slot, tag) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!result?.data) return null;
    const binary = Array.from(result.binaryData || []);
    return {
      slot,
      label: `QR重点補完/QR${slot + 1}/${tag}/jsQR`,
      data: result.data,
      binary,
      hex: binary.length ? bytesHex(binary) : "",
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

async function rescue(file, missing) {
  const source = await sourceCanvas(file);
  const jsMod = await import("jsqr");
  const jsQR = jsMod.default || jsMod;
  const started = performance.now();
  const budgetMs = 3600;
  const recovered = [];
  const paper = detectPaperLite(source);
  const known = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];

  try {
    // 高速QRで取りこぼした時だけ、旧来の「QR帯全体を読む」強い方法を
    // 3モードまでに限定して実行する。K番号と物理slotの固定対応は仮定しない。
    for (const mode of ["color", "contrast", "binary"]) {
      if (performance.now() - started >= budgetMs) break;
      const band = cropBand(source, paper, mode);
      try {
        recovered.push(...decodeBandJsQr(jsQR, band, mode));
      } finally {
        band.width = 1;
        band.height = 1;
      }

      const combined = [...known, ...recovered];
      const still = missing.filter((d) => !hasCode(combined, d));
      if (!still.length || uniqueByKey(combined).length >= 6) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    source.width = 1;
    source.height = 1;
  }

  const uniqueRecovered = uniqueByKey(recovered).filter((item) => {
    const k = keyOf(item);
    return k && !new Set(known.map(keyOf).filter(Boolean)).has(k);
  });
  return { recovered: uniqueRecovered, elapsed: Math.round(performance.now() - started) };
}

function uniqueByKey(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyOf(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

export default function CertificateQrRescueV2() {
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
        // 高速QRの完了前に重い救済処理を始めると、同じQRを二重解析して20秒超になる。
        // fast-readyを待ち、完了後の不足コードだけを救済する。
        const waitStarted = performance.now();
        while (!dead && id === token) {
          const state = window.__vehicleCertificateQrFastState;
          if (state && state.running === false) break;
          if (performance.now() - waitStarted > 6500) break;
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (dead || id !== token) return;
        const before = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const missing = ["0", "2", "7"].filter((d) => !hasCode(before, d));
        if (!missing.length) {
          showStatus("重要QR K0/K2/K7 取得済み。追加解析は省略しました。");
          return;
        }

        showStatus(`高速QR完了後、不足QR K${missing.join(",K")} をQR帯域から補完中…`);
        const { recovered, elapsed } = await rescue(file, missing);
        if (dead || id !== token) return;

        const current = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const combined = [...current];
        const keys = new Set(current.map(keyOf).filter(Boolean));
        for (const item of recovered) {
          const key = keyOf(item);
          if (!key || keys.has(key)) continue;
          keys.add(key);
          combined.push(item);
        }
        window.__vehicleCertificateQr = combined;
        if (recovered.length) {
          window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
        }
        const got = ["0", "2", "7"].filter((d) => hasCode(combined, d));
        const still = ["0", "2", "7"].filter((d) => !hasCode(combined, d));
        const versions = [...new Set(recovered.map(version).filter(Boolean))].sort();
        showStatus(`QR帯域補完: +${recovered.length}件 / ${elapsed}ms${versions.length ? ` / 新規 ${versions.join(",")}` : ""} / 取得 ${got.map((d) => `K${d}`).join(",") || "なし"}${still.length ? ` / 未読 K${still.join(",K")}` : ""}`);
      })().catch((e) => {
        if (!dead && id === token) showStatus(`QR重点補完エラー: ${e?.message || e}`);
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
