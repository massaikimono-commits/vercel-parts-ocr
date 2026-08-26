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
  const reader = await makeZxing();
  const jsMod = await import("jsqr");
  const jsQR = jsMod.default || jsMod;
  const started = performance.now();
  const recovered = [];

  // 軽自動車の6個QRは左から K0/K2/K3/K5/K6/K7。
  // ここでの x は切り出し左端。高速QRと同じ実測位置を使う。
  const plans = {
    "0": { slot: 0, xs: [0.395, 0.425, 0.455] },
    "2": { slot: 1, xs: [0.485, 0.515, 0.545] },
    "7": { slot: 5, xs: [0.845, 0.875, 0.905] },
  };
  const attempts = [
    [0.775, "contrast"],
    [0.805, "contrast"],
    [0.835, "binary"],
    [0.790, "color"],
  ];

  try {
    for (const digit of missing) {
      const plan = plans[digit];
      let done = false;
      for (const [y, mode] of attempts) {
        if (done) break;
        for (const x of plan.xs) {
          const c = cropQr(source, x, y, mode);
          try {
            const z = await decodeZxing(reader, c, plan.slot, `K${digit}/x${x}/y${y}/${mode}`);
            if (wantedHit(z, digit)) {
              recovered.push(z);
              done = true;
              break;
            }
            const j = await decodeJsQr(jsQR, c, plan.slot, `K${digit}/x${x}/y${y}/${mode}`);
            if (wantedHit(j, digit)) {
              recovered.push(j);
              done = true;
              break;
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
  return { recovered, elapsed: Math.round(performance.now() - started) };
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
        await new Promise((resolve) => setTimeout(resolve, 1250));
        if (dead || id !== token) return;
        const before = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const missing = ["0", "2", "7"].filter((d) => !hasCode(before, d));
        if (!missing.length) {
          showStatus("重要QR K0/K2/K7 取得済み。追加解析は省略しました。");
          return;
        }

        showStatus(`不足QR K${missing.join(",K")} を重点補完中…`);
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
        showStatus(`QR重点補完: +${recovered.length}件 / ${elapsed}ms / 取得 ${got.map((d) => `K${d}`).join(",") || "なし"}${still.length ? ` / 未読 K${still.join(",K")}` : ""}`);
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
