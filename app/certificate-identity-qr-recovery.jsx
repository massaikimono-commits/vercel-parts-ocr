"use client";

import { useEffect } from "react";
import { prepareDocumentImage } from "./lib/document-image-pipeline";

function fields(item) {
  return String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((x) => x.trim());
}

function version(item) {
  const f = fields(item);
  return f[0] === "K" ? f[1] || "" : "";
}

function isIdentity(item) {
  return /^(?:0|2)\d$/.test(version(item));
}

function isK2(item) {
  return /^2\d$/.test(version(item));
}

function hasDigit(items, digit) {
  return unique(items).some((item) => new RegExp(`^${digit}\\d$`).test(version(item)));
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

function hex(bytes = []) {
  return Array.from(bytes)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function crop(source, box, mode = "color", targetWidth = 4200) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(source.width * x0));
  const sy = Math.max(0, Math.round(source.height * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h0)));
  const scale = Math.max(1, Math.min(7, targetWidth / sw));
  const pad = 48;
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
    let count = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      sum += g;
      count += 1;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    }
    const mean = sum / Math.max(1, count);
    const threshold = Math.max(100, Math.min(225, mean - 8));
    for (let p = 0; p < image.data.length; p += 4) {
      let v = image.data[p];
      if (mode === "contrast") v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.2 + 150)));
      if (mode === "binary") v = v < threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

function jsQrBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = Math.max(20, Math.round(Math.min(width, height) * 0.025));
  return {
    x: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    y: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    w: Math.max(1, Math.ceil(Math.max(...xs) - Math.min(...xs) + pad * 2)),
    h: Math.max(1, Math.ceil(Math.max(...ys) - Math.min(...ys) + pad * 2)),
  };
}

async function decoders() {
  const js = await import("jsqr");
  const jsQR = js.default || js;
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  const zxing = new browser.BrowserQRCodeReader(hints);
  return { jsQR, zxing };
}

function decodeJsQR(jsQR, canvas, label) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!code) break;
    const binary = Array.from(code.binaryData || []);
    const item = { label: `${label}/jsQR`, data: code.data || "", binary, hex: hex(binary) };
    out.push(item);
    const b = jsQrBounds(code, canvas.width, canvas.height);
    if (!b) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  return out;
}

async function decodeZXing(reader, canvas, label) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const data = result?.getText?.() || result?.text || "";
    const raw = result?.getRawBytes?.() || result?.rawBytes || [];
    if (!data && !raw?.length) return [];
    const binary = Array.from(raw || []);
    return [{ label: `${label}/ZXing`, data, binary, hex: hex(binary) }];
  } catch {
    return [];
  }
}

async function scanFocusedIdentitySlots(source, jsQR, zxing, found, known, logs) {
  // 既存6枠解析で使っていた実績座標を中心に、K0/K2だけを両デコーダで読む。
  const plans = [
    { digit: "0", name: "K0", xs: [0.390, 0.405, 0.420, 0.435, 0.450, 0.465] },
    { digit: "2", name: "K2", xs: [0.470, 0.485, 0.500, 0.515, 0.530, 0.545] },
  ];
  const ys = [0.775, 0.790, 0.805, 0.820, 0.835];
  const modes = ["contrast", "color", "binary"];
  const all = () => unique([...(known || []), ...found]);

  for (const plan of plans) {
    if (hasDigit(all(), plan.digit)) continue;
    let done = false;
    for (const y of ys) {
      if (done) break;
      for (const x of plan.xs) {
        if (done) break;
        for (const mode of modes) {
          const canvas = crop(source, [x, y, 0.135, 0.155], mode, 1900);
          try {
            const jsHits = decodeJsQR(jsQR, canvas, `${plan.name}/x${x}/y${y}/${mode}`);
            const zxHits = await decodeZXing(zxing, canvas, `${plan.name}/x${x}/y${y}/${mode}`);
            found.push(...jsHits, ...zxHits);
            const versions = [...jsHits, ...zxHits].map(version).filter(Boolean);
            if (versions.length) logs.push(`${plan.name} x${x} y${y} ${mode}: ${versions.join(",")}`);
            if (hasDigit(all(), plan.digit)) {
              done = true;
              break;
            }
          } finally {
            canvas.width = 1;
            canvas.height = 1;
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    logs.push(`${plan.name}: ${hasDigit(all(), plan.digit) ? "取得" : "未取得"}`);
  }
}

async function scanIdentity(file, known = []) {
  const prepared = await prepareDocumentImage(file, { maxSide: 5200, cropPaper: true, minPaperConfidence: 0.38 });
  const source = prepared.normalized;
  const { jsQR, zxing } = await decoders();
  const found = [];
  const logs = [];

  try {
    // まずK0/K2の想定2枠だけ。32/51/61/71など既読4枠は触らない。
    await scanFocusedIdentitySlots(source, jsQR, zxing, found, known, logs);
    let identities = unique([...known, ...found]).filter(isIdentity);
    if (identities.some(isK2)) return { found: unique(found).filter(isIdentity), logs };

    // ピンポイントでK2まで取れなかった場合だけ、左寄りの下段帯を広めに再確認。
    const broadPlans = [
      ["身元帯A", [0.34, 0.72, 0.30, 0.20]],
      ["身元帯B", [0.38, 0.76, 0.28, 0.17]],
    ];
    for (const [name, box] of broadPlans) {
      for (const mode of ["contrast", "color", "binary"]) {
        const canvas = crop(source, box, mode, 3000);
        try {
          const jsHits = decodeJsQR(jsQR, canvas, `${name}/${mode}`);
          const zxHits = await decodeZXing(zxing, canvas, `${name}/${mode}`);
          found.push(...jsHits, ...zxHits);
          const versions = [...jsHits, ...zxHits].map(version).filter(Boolean);
          logs.push(`${name}/${mode}: ${versions.join(",") || "なし"}`);
          identities = unique([...known, ...found]).filter(isIdentity);
          if (identities.some(isK2)) return { found: unique(found).filter(isIdentity), logs };
        } finally {
          canvas.width = 1;
          canvas.height = 1;
        }
      }
    }

    return { found: unique(found).filter(isIdentity), logs };
  } finally {
    source.width = 1;
    source.height = 1;
  }
}

function showStatus(text, logs = []) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-identity-qr-recovery-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-identity-qr-recovery-debug";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #d9e0ea";
    box.style.borderRadius = "12px";
    box.innerHTML = '<summary style="font-weight:800">車両番号・車台番号QR再探索（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = `${text}${logs.length ? `\n${logs.join("\n")}` : ""}`;
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificateIdentityQrRecovery() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let pending = null;
    let startedAt = 0;
    let sawProgress = false;
    let running = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      startedAt = Date.now();
      sawProgress = false;
      running = false;
      token += 1;
      showStatus("K0/K2待ち");
    };

    const timer = window.setInterval(async () => {
      if (!pending || running) return;
      const existing = unique(Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : []);
      const existingIdentity = existing.filter(isIdentity);
      const qr = window.__vehicleCertificateQrPriority || {};
      if (existingIdentity.some(isK2)) {
        pending = null;
        showStatus(`K2取得済み: ${existingIdentity.map(version).join(",")}`);
        return;
      }
      if (document.querySelector(".progress")) {
        sawProgress = true;
        return;
      }
      const elapsed = Date.now() - startedAt;
      // 通常QR解析を少し待ってから、K0/K2の2枠だけを回収する。
      if (sawProgress && elapsed < 10500) return;
      if (!sawProgress && elapsed < 20000) return;

      const file = pending;
      const myToken = token;
      pending = null;
      running = true;
      showStatus(existingIdentity.length || qr.registrationNumber || qr.chassisNumber
        ? "K0/身元情報は取得済み。K2をピンポイント探索中…"
        : "K0/K2の2枠だけをピンポイント探索中…");
      try {
        const result = await scanIdentity(file, existing);
        if (myToken !== token) return;
        if (!result.found.length) {
          showStatus("K0/K2は未取得。次の2行OCRへ移ります。", result.logs);
          return;
        }
        const current = unique(Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : []);
        const combined = unique([...current, ...result.found]);
        window.__vehicleCertificateQr = combined;
        window.dispatchEvent(new CustomEvent("vehicle-certificate-qr-fallback-ready", { detail: combined }));
        const ids = combined.filter(isIdentity);
        showStatus(`身元QR取得: ${ids.map(version).join(",")} / QR合計 ${combined.length}件${ids.some(isK2) ? " / K2取得" : " / K2は未取得"}`, result.logs);
      } catch (error) {
        showStatus(`身元QR再探索エラー: ${error?.message || error}`);
      } finally {
        running = false;
      }
    }, 700);

    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
