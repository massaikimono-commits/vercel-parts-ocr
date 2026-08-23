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

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("QR解析用画像を開けませんでした"));
      node.src = url;
    });

    // iPhoneの元画像解像度をできるだけ維持する。
    const maxSide = 8200;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
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

async function canvasFromPreview(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, 6200 / Math.max(iw, ih));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(iw * scale));
  canvas.height = Math.max(1, Math.round(ih * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };

  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(5, Math.floor(Math.max(w, h) / 720));
  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 103 && Math.max(r, g, b) - Math.min(r, g, b) < 108;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0;
    let n = 0;
    for (let x = 0; x < w; x += step) {
      if (paperish(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let n = 0;
    for (let y = top; y <= bottom; y += step) {
      if (paperish(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };

  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function preprocess(canvas, mode) {
  if (mode === "color") return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  let sum = 0;

  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const g = Math.round(
      image.data[p] * 0.22 + image.data[p + 1] * 0.7 + image.data[p + 2] * 0.08
    );
    gray[i] = g;
    sum += g;
  }
  const avg = sum / Math.max(1, gray.length);
  const threshold = Math.max(92, Math.min(225, avg - 7));

  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "contrast") {
      v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.15 + 147)));
    } else if (mode === "binary") {
      v = v < threshold ? 0 : 255;
    } else if (mode === "binaryDark") {
      v = v < Math.max(75, threshold - 26) ? 0 : 255;
    } else if (mode === "binaryLight") {
      v = v < Math.min(238, threshold + 24) ? 0 : 255;
    }
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cropRegion(source, paper, box, targetWidth, mode) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(paper.w * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(paper.h * h0)));
  const scale = Math.max(1, Math.min(14, targetWidth / Math.max(1, sw)));
  const pad = 64;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    pad,
    pad,
    canvas.width - pad * 2,
    canvas.height - pad * 2
  );
  return preprocess(canvas, mode);
}

function jsQrBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [
    loc.topLeftCorner,
    loc.topRightCorner,
    loc.bottomLeftCorner,
    loc.bottomRightCorner,
  ].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = Math.max(18, Math.round(Math.min(width, height) * 0.025));
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
}

function uniqueCodes(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.hex || item.data;
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
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
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    zxing = new browser.BrowserQRCodeReader(hints);
  } catch {
    zxing = null;
  }

  return { jsQR, zxing };
}

async function decodeWithZXing(reader, canvas, label) {
  if (!reader) return [];
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    return data || raw?.length
      ? [{ label: `${label}/ZXing`, data, binary: Array.from(raw || []), hex: hex(raw || []) }]
      : [];
  } catch {
    return [];
  }
}

function decodeWithJsQR(jsQR, canvas, label) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const found = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "attemptBoth",
    });
    if (!code) break;
    const binary = Array.from(code.binaryData || []);
    found.push({
      label: `${label}/jsQR`,
      data: code.data || "",
      binary,
      hex: hex(binary),
    });
    const b = jsQrBounds(code, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.left, b.top, Math.max(1, b.right - b.left), Math.max(1, b.bottom - b.top));
  }
  return found;
}

async function decodeCrop(decoders, canvas, label) {
  const out = [];
  out.push(...(await decodeWithZXing(decoders.zxing, canvas, label)));
  out.push(...decodeWithJsQR(decoders.jsQR, canvas, label));
  return out;
}

function renderResult(result, message) {
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

    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-all";
    pre.style.fontSize = "12px";
    pre.style.background = "#f8fafc";
    pre.style.padding = "8px";
    pre.style.borderRadius = "8px";
    pre.textContent = `文字列\n${visibleText(item.data) || "(文字列なし)"}\n\nバイナリ HEX\n${item.hex || "(バイナリなし)"}`;
    card.appendChild(pre);
    box.appendChild(card);
  });

  details.appendChild(box);
}

async function scanSource(source, sourceLabel) {
  const decoders = await makeDecoders();
  const paper = detectPaper(source);

  // 5個のQRを個別に大きく切り出す。左右・上下に余白を持たせ、撮影ズレにも対応する。
  const regions = [
    ["QR1", [0.49, 0.735, 0.145, 0.18], 2100],
    ["QR2", [0.565, 0.735, 0.145, 0.18], 2100],
    ["QR3", [0.64, 0.735, 0.145, 0.18], 2100],
    ["QR4", [0.775, 0.735, 0.135, 0.18], 2100],
    ["QR5", [0.86, 0.735, 0.135, 0.18], 2100],
    ["左3個", [0.46, 0.715, 0.37, 0.22], 3600],
    ["右2個", [0.75, 0.715, 0.245, 0.22], 3000],
    ["QR帯", [0.43, 0.70, 0.565, 0.25], 4400],
  ];
  const modes = ["color", "contrast", "binary", "binaryDark", "binaryLight"];

  const all = [];
  for (const [name, box, target] of regions) {
    for (const mode of modes) {
      const crop = cropRegion(source, paper, box, target, mode);
      all.push(...(await decodeCrop(decoders, crop, `${sourceLabel}/${name}/${mode}`)));
    }
  }

  return { result: uniqueCodes(all), paper };
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificateQrReader() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    let running = false;
    let lastFileKey = "";
    let lastPreviewSrc = "";

    const applyScan = async (source, label) => {
      if (dead || running) return;
      running = true;
      renderResult([], "元画像からQRコードを自動解析中…");
      try {
        const { result, paper } = await scanSource(source, label);
        if (dead) return;
        window.__vehicleCertificateQr = result;
        if (result.length) {
          renderResult(
            result,
            `元画像からQRコードを ${result.length} 件読み取りました。OCRより優先して利用します。`
          );
        } else {
          renderResult(
            [],
            `元画像からQRコードを読み取れませんでした。OCR処理はそのまま続行します。用紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`
          );
        }
      } catch (e) {
        if (!dead) {
          renderResult([], `QR自動解析エラー: ${e?.message || e}。OCR処理はそのまま続行します。`);
        }
      } finally {
        running = false;
      }
    };

    const onFileChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file) return;
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (key === lastFileKey) return;
      lastFileKey = key;
      void canvasFromFile(file).then((canvas) => applyScan(canvas, "元画像"));
    };

    // React側がinput.valueを空にする前に元Fileを確保するためcaptureで受ける。
    document.addEventListener("change", onFileChange, true);

    // 万一Fileイベントを拾えなかった場合だけ、プレビューを自動フォールバック解析する。
    const scanPreview = async () => {
      if (dead || running || lastFileKey) return;
      const img = document.querySelector("img.preview");
      if (!img?.src || img.src === lastPreviewSrc) return;
      lastPreviewSrc = img.src;
      try {
        const canvas = await canvasFromPreview(img);
        await applyScan(canvas, "プレビュー");
      } catch {
        // OCR本体を止めない。
      }
    };

    const observer = new MutationObserver(() => void scanPreview());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = window.setInterval(() => void scanPreview(), 800);
    void scanPreview();

    return () => {
      dead = true;
      document.removeEventListener("change", onFileChange, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
