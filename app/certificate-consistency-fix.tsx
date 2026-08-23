/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function compact(v = "") {
  return String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function isCertificateInput(node: EventTarget | null) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function eraDate(year: number, month: number, day = 0) {
  if (!year || !month) return "";
  const suffix = day ? `${day}日` : "";
  if (year >= 2019) return `令和${year - 2018}年${month}月${suffix}`;
  if (year >= 1989) return `平成${year - 1988}年${month}月${suffix}`;
  if (year >= 1926) return `昭和${year - 1925}年${month}月${suffix}`;
  return "";
}

function yyToYear(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n <= 50 ? 2000 + n : 1900 + n;
}

function date6(value: string) {
  const s = String(value || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(s) || s === "999999") return "";
  const y = yyToYear(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return eraDate(y, m, d);
}

function month4(value: string) {
  const s = String(value || "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(s) || s === "9999") return "";
  const y = yyToYear(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (!y || m < 1 || m > 12) return "";
  return eraDate(y, m);
}

function axle(value: string) {
  const s = compact(value).replace(/\s/g, "");
  if (!/^\d{4}$/.test(s)) return "";
  return String(Number(s) * 10);
}

function parseQr3(parts: string[]) {
  if (parts.length !== 3 || parts.some((x) => !x)) return null;
  const joined = parts.map((x) => String(x).normalize("NFKC").replace(/\u3000/g, " ")).join("");
  const f = joined.split("/").map(compact);
  if (f.length < 19 || f[0] !== "2") return null;
  const fuelCode = String(f[18] || "").replace(/\D/g, "");
  const fuelMap: Record<string, string> = {
    "01": "ガソリン", "02": "軽油", "03": "LPG", "05": "電気", "09": "CNG",
    "13": "圧縮水素", "14": "ガソリン・電気", "16": "軽油・電気", "99": "その他",
  };
  return {
    inspectionExpiry: date6(f[3]),
    firstRegistration: month4(f[4]),
    model: compact(f[5]).replace(/\s/g, "").toUpperCase(),
    frontFrontAxleWeightKg: axle(f[6]),
    frontRearAxleWeightKg: axle(f[7]),
    rearFrontAxleWeightKg: axle(f[8]),
    rearRearAxleWeightKg: axle(f[9]),
    fuel: fuelMap[fuelCode] || "",
  };
}

async function canvasFromFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("高速QR用画像を開けませんでした"));
      node.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 6200 / Math.max(iw, ih));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(iw * scale));
    canvas.height = Math.max(1, Math.round(ih * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectPaper(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(5, Math.floor(Math.max(w, h) / 720));
  const paperish = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 103 && Math.max(r, g, b) - Math.min(r, g, b) < 108;
  };
  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (paperish(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (paperish(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function preprocess(canvas: HTMLCanvasElement, mode: string) {
  if (mode === "color") return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  let sum = 0;
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
    gray[i] = g; sum += g;
  }
  const avg = sum / Math.max(1, gray.length);
  const threshold = Math.max(92, Math.min(225, avg - 7));
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "contrast") v = Math.max(0, Math.min(255, Math.round((v - 128) * 2.15 + 147)));
    else if (mode === "binary") v = v < threshold ? 0 : 255;
    else if (mode === "binaryDark") v = v < Math.max(75, threshold - 26) ? 0 : 255;
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cropRegion(source: HTMLCanvasElement, paper: any, box: number[], targetWidth: number, mode: string) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(paper.w * w0)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(paper.h * h0)));
  const scale = Math.max(1, Math.min(12, targetWidth / Math.max(1, sw)));
  const pad = 52;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  return preprocess(canvas, mode);
}

async function makeDecoders() {
  const js = await import("jsqr");
  const jsQR = (js as any).default || js;
  let zxing: any = null;
  try {
    const browser = await import("@zxing/browser");
    const lib = await import("@zxing/library");
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    zxing = new browser.BrowserQRCodeReader(hints);
  } catch { zxing = null; }
  return { jsQR, zxing };
}

async function decodeOne(decoders: any, canvas: HTMLCanvasElement) {
  if (decoders.zxing) {
    try {
      const r = await decoders.zxing.decodeFromCanvas(canvas);
      const text = r?.getText?.() || r?.text || "";
      if (text) return String(text);
    } catch {}
  }
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = decoders.jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    return code?.data || "";
  } catch { return ""; }
}

async function fastQrPriority(file: File) {
  const source = await canvasFromFile(file);
  const paper = detectPaper(source);
  const decoders = await makeDecoders();
  const regions = [
    [[0.49, 0.735, 0.145, 0.18], 2100],
    [[0.565, 0.735, 0.145, 0.18], 2100],
    [[0.64, 0.735, 0.145, 0.18], 2100],
  ] as const;
  const modes = ["contrast", "binaryDark", "color", "binary"];
  const parts = ["", "", ""];
  for (let i = 0; i < regions.length; i += 1) {
    const [box, target] = regions[i];
    for (const mode of modes) {
      const crop = cropRegion(source, paper, [...box], target, mode);
      const value = await decodeOne(decoders, crop);
      if (value) { parts[i] = value; break; }
    }
  }
  return parseQr3(parts);
}

export default function CertificateConsistencyFix() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let stopped = false;
    let scanId = 0;
    let postOcrPushes = 0;
    let wasBusy = false;
    let lastKey = "";

    const resetForNewFile = (event: Event) => {
      if (!isCertificateInput(event.target)) return;
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const id = ++scanId;
      postOcrPushes = 0;
      wasBusy = true;
      lastKey = "";
      (window as any).__vehicleCertificateQrPriority = null;

      void fastQrPriority(file).then((values) => {
        if (stopped || id !== scanId || !values?.firstRegistration || !values?.inspectionExpiry) return;
        (window as any).__vehicleCertificateQrPriority = values;
        (window as any).__vehicleCertificateFastQrReady = true;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: values }));
      }).catch(() => {});
    };

    const pushAuthoritative = () => {
      const q = (window as any).__vehicleCertificateQrPriority;
      if (!q || typeof q !== "object") return;
      const patch = {
        firstRegistration: q.firstRegistration || "",
        inspectionExpiry: q.inspectionExpiry || "",
        model: q.model || "",
        frontFrontAxleWeightKg: q.frontFrontAxleWeightKg || "",
        frontRearAxleWeightKg: q.frontRearAxleWeightKg || "",
        rearFrontAxleWeightKg: q.rearFrontAxleWeightKg || "",
        rearRearAxleWeightKg: q.rearRearAxleWeightKg || "",
        fuel: q.fuel || "",
      };
      if (!Object.values(patch).some(Boolean)) return;
      const key = JSON.stringify(patch);
      const busy = Boolean(document.querySelector(".progress"));
      const changed = key !== lastKey;
      if (busy) {
        wasBusy = true;
        postOcrPushes = 0;
      } else if (wasBusy) {
        postOcrPushes += 1;
        if (postOcrPushes >= 16) wasBusy = false;
      }
      if (!changed && !busy && !wasBusy) return;
      lastKey = key;
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
    };

    document.addEventListener("change", resetForNewFile, true);
    const timer = window.setInterval(pushAuthoritative, 350);
    pushAuthoritative();
    return () => {
      stopped = true;
      document.removeEventListener("change", resetForNewFile, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
