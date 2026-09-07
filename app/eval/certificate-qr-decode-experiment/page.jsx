"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeCertificateCanvas, expectedCertificateQrCount } from "../../lib/certificate-photo-normalize";
import { detectCertificateQrDensityCandidates2D, clusterCertificateQrCandidates2D } from "../../lib/certificate-qr-density-2d.mjs";

const REQUIRED_NAMES = Array.from({ length: 8 }, (_, i) => `IMG_${String(940 + i).padStart(4, "0")}.jpeg`);
const PATHNAME = "/vehicle-workflow-v2";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const GT_OPTIONS = [
  { value: "", label: "未設定", expected: null },
  { value: "kei", label: "軽6QR", expected: 6 },
  { value: "registered", label: "登録車5QR", expected: 5 },
  { value: "kei-legacy", label: "軽旧2QR", expected: 2 },
];
const RECOGNITION_ISOLATION = Object.freeze({
  groundTruthUsedDuringDecode: false,
  decodeInput: "selected-image-file-only",
  groundTruthAvailableToCandidateDetection: false,
  groundTruthAvailableToDecodeStopping: false,
  groundTruthAvailableToFallbackControl: false,
  groundTruthAvailableToRuntimeVehicleKind: false,
  groundTruthAvailableToRuntimeExpectedQrCount: false,
});
const ENSEMBLE_CONFIGS = [
  { id: "raw-color-small-2x-nearest", source: "raw", mode: "color", crop: "small", widthRel: .10, scale: 2, interpolation: "nearest", quietZoneRatio: .08 },
  { id: "raw-color-medium-3x-nearest", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08 },
  { id: "raw-color-medium-2x-smooth", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 2, interpolation: "smooth", quietZoneRatio: .08 },
];
const RESCUE_CONFIGS = [
  { id: "rescue-gray-medium-3x", source: "raw", mode: "grayscale", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08 },
  { id: "rescue-contrast-weak-medium-3x", source: "raw", mode: "contrast-weak", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08 },
  { id: "rescue-contrast-medium-medium-3x", source: "raw", mode: "contrast-medium", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08 },
  { id: "rescue-sharpen-medium-3x", source: "raw", mode: "sharpen", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08 },
  { id: "rescue-rotate-plus1-medium-3x", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08, rotateDeg: 1.0 },
  { id: "rescue-rotate-minus1-medium-3x", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .08, rotateDeg: -1.0 },
  { id: "rescue-quiet-medium-3x", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest", quietZoneRatio: .14 },
];
const DEFAULT_GROUND_TRUTH = {
  "IMG_0940.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0941.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0942.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0943.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0944.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0945.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0946.jpeg": { vehicleKind: "kei", expectedQrCount: 6 },
  "IMG_0947.jpeg": { vehicleKind: "registered", expectedQrCount: 5 },
};

function safeName(file) {
  return String(file?.name || "").replace(/[^A-Za-z0-9._-]/g, "_");
}
function normalizeFixedFileName(file) {
  const leaf = String(file?.name || "").normalize("NFKC").trim().split(/[\\/]/).pop() || "";
  const match = leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
  return match ? `IMG_${match[1]}.jpeg` : null;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeRequest(url, method, type, base) {
  try {
    const u = new URL(String(url || ""), base);
    return { method: String(method || "GET").toUpperCase(), host: u.host, path: u.pathname, type };
  } catch {
    return { method: String(method || "GET").toUpperCase(), host: "invalid", path: "invalid", type };
  }
}
function hasBinary(win, body) {
  if (!body) return false;
  if (body instanceof win.Blob || body instanceof win.File) return true;
  if (body instanceof win.FormData) {
    for (const [, value] of body.entries()) if (value instanceof win.Blob || value instanceof win.File) return true;
  }
  return false;
}
function installNetworkGuard(win) {
  const requests = [], violations = [];
  const record = (url, method, type) => requests.push(safeRequest(url, method, type, win.location.href));
  const violate = (kind, url, method, binary = false) => violations.push({ kind, ...safeRequest(url, method, kind, win.location.href), binary });

  const originalFetch = win.fetch.bind(win);
  win.fetch = (input, init = {}) => {
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const url = typeof input === "string" || input instanceof win.URL ? input : input?.url || "";
    record(url, method, "fetch");
    const binary = hasBinary(win, init?.body);
    if (binary || MUTATING.has(method)) {
      violate("fetch", url, method, binary);
      return Promise.reject(new Error("AUDIT_BLOCKED_REQUEST"));
    }
    return originalFetch(input, init);
  };

  const open = win.XMLHttpRequest.prototype.open;
  const send = win.XMLHttpRequest.prototype.send;
  win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__auditMethod = String(method || "GET").toUpperCase();
    this.__auditUrl = String(url || "");
    return open.call(this, method, url, ...rest);
  };
  win.XMLHttpRequest.prototype.send = function (body) {
    const method = this.__auditMethod || "GET";
    const url = this.__auditUrl || "";
    record(url, method, "xhr");
    const binary = hasBinary(win, body);
    if (binary || MUTATING.has(method)) {
      violate("xhr", url, method, binary);
      throw new Error("AUDIT_BLOCKED_REQUEST");
    }
    return send.call(this, body);
  };

  if (win.navigator?.sendBeacon) {
    win.navigator.sendBeacon = (url, data) => {
      record(url, "POST", "beacon");
      violate("beacon", url, "POST", hasBinary(win, data));
      return false;
    };
  }
  win.WebSocket = function (url) {
    record(url, "GET", "websocket");
    violate("websocket", url, "GET", false);
    throw new Error("AUDIT_BLOCKED_WEBSOCKET");
  };
  const blockForm = function (event) {
    event?.preventDefault?.();
    const form = event?.target || this;
    const method = String(form?.method || "GET").toUpperCase();
    const url = form?.action || win.location.href;
    record(url, method, "form");
    violate("form", url, method, false);
  };
  win.document.addEventListener("submit", blockForm, true);
  win.HTMLFormElement.prototype.submit = function () { return blockForm.call(this); };
  if (win.HTMLFormElement.prototype.requestSubmit) win.HTMLFormElement.prototype.requestSubmit = function () { return blockForm.call(this); };

  return {
    finish() {
      try { win.document.removeEventListener("submit", blockForm, true); } catch {}
      return {
        requests,
        violations,
        binaryUploadAttempts: violations.filter((v) => v.binary).length,
        blockedMutationRequests: violations.filter((v) => MUTATING.has(v.method)).length,
      };
    },
  };
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
    const ratio = Math.min(1, 4400 / Math.max(iw, ih));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(iw * ratio));
    canvas.height = Math.max(1, Math.round(ih * ratio));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function paperPoint(pageGeometry, source, candidate) {
  const q = Array.isArray(pageGeometry?.quad) && pageGeometry.quad.length === 4 ? pageGeometry.quad : null;
  if (q) {
    const x = Math.max(0, Math.min(1, Number(candidate.x) || 0));
    const y = Math.max(0, Math.min(1, Number(candidate.y) || 0));
    const top = {
      x: q[0].x * (1 - x) + q[1].x * x,
      y: q[0].y * (1 - x) + q[1].y * x,
    };
    const bottom = {
      x: q[3].x * (1 - x) + q[2].x * x,
      y: q[3].y * (1 - x) + q[2].y * x,
    };
    return {
      x: top.x * (1 - y) + bottom.x * y,
      y: top.y * (1 - y) + bottom.y * y,
    };
  }
  const b = pageGeometry?.bounds || pageGeometry || { x: 0, y: 0, w: source.width, h: source.height };
  return { x: b.x + b.w * candidate.x, y: b.y + b.h * candidate.y };
}
function paperWidthPx(pageGeometry, source) {
  const q = Array.isArray(pageGeometry?.quad) && pageGeometry.quad.length === 4 ? pageGeometry.quad : null;
  if (q) {
    const top = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const bottom = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
    return Math.max(1, (top + bottom) / 2);
  }
  return Math.max(1, Number(pageGeometry?.bounds?.w || pageGeometry?.w || source.width));
}
function sharpenImageData(image) {
  const { data, width, height } = image;
  const src = new Uint8ClampedArray(data);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const p = ((y + ky) * width + (x + kx)) * 4 + channel;
            value += src[p] * kernel[ki++];
          }
        }
        data[(y * width + x) * 4 + channel] = Math.max(0, Math.min(255, value));
      }
    }
  }
}
function cropCandidate(source, pageGeometry, candidate, config) {
  const center = paperPoint(pageGeometry, source, candidate);
  const cropW = Math.max(12, paperWidthPx(pageGeometry, source) * config.widthRel);
  const cropH = cropW;
  let sx = center.x - cropW / 2;
  let sy = center.y - cropH / 2;
  sx = Math.max(0, Math.min(source.width - cropW, sx));
  sy = Math.max(0, Math.min(source.height - cropH, sy));
  const sw = Math.max(1, Math.min(source.width - sx, cropW));
  const sh = Math.max(1, Math.min(source.height - sy, cropH));
  const scale = Math.max(.8, Math.min(3, Number(config.scale) || 1));
  const quietZoneRatio = Math.max(.04, Math.min(.20, Number(config.quietZoneRatio) || .08));
  const pad = Math.max(12, Math.round(Math.min(sw, sh) * scale * quietZoneRatio));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = config.interpolation === "smooth";
  if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = "high";

  const rotate = Number(config.rotateDeg) || 0;
  if (rotate) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotate * Math.PI / 180);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  if (rotate) ctx.restore();

  if (config.mode !== "color") {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      sum += g;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    }
    const avg = sum / Math.max(1, image.data.length / 4);
    let contrast = 1;
    let midpoint = 128;
    if (config.mode === "contrast-weak") { contrast = 1.35; midpoint = avg; }
    if (config.mode === "contrast-medium") { contrast = 1.70; midpoint = avg; }
    if (config.mode === "contrast-weak" || config.mode === "contrast-medium") {
      for (let p = 0; p < image.data.length; p += 4) {
        const g = image.data[p];
        const v = Math.max(0, Math.min(255, Math.round((g - midpoint) * contrast + midpoint)));
        image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      }
    }
    if (config.mode === "sharpen") sharpenImageData(image);
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}
function canonicalText(value) {
  return String(value ?? "")
    .replace(/\0+$/g, "")
    .replace(/\r\n?/g, "\n");
}
function decodeBytesText(bytes = []) {
  const raw = Uint8Array.from(bytes || []);
  if (!raw.length) return "";
  for (const encoding of ["utf-8", "shift_jis"]) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(raw);
      if (text) return canonicalText(text);
    } catch {}
  }
  return "";
}
function canonicalDecode(text, bytes = []) {
  const direct = canonicalText(text);
  if (direct) return direct;
  return decodeBytesText(bytes);
}
async function decodeJs(jsQR, canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!result) return { success: false, canonical: "" };
    const canonical = canonicalDecode(result.data || "", Array.from(result.binaryData || []));
    return { success: Boolean(canonical), canonical };
  } catch {
    return { success: false, canonical: "" };
  }
}
async function makeReader() {
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  return new browser.BrowserQRCodeReader(hints);
}
async function decodeZxing(reader, canvas) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const raw = Array.from(result?.getRawBytes?.() || result?.rawBytes || []);
    const text = result?.getText?.() || result?.text || "";
    const canonical = canonicalDecode(text, raw);
    return { success: Boolean(canonical), canonical };
  } catch {
    return { success: false, canonical: "" };
  }
}
function sameCanonical(a, b) {
  return Boolean(a && b && a === b);
}
function traceCounts(trace) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const js = events.filter((e) => e.type === "jsqr-result");
  const zx = events.filter((e) => e.type === "zxing-result");
  return {
    jsqrAttempts: js.length,
    jsqrSuccesses: js.filter((e) => e.success).length,
    zxingAttempts: zx.length,
    zxingSuccesses: zx.filter((e) => e.success).length,
  };
}
async function waitForInputAndFastReady(frame) {
  const started = performance.now();
  while (performance.now() - started < 12000) {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const input = [...(doc?.querySelectorAll('input[type="file"]') || [])]
      .find((node) => node.closest("section.card")?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
    if (input && win?.__certificateQrFastAuditReady === true) return input;
    await wait(80);
  }
  throw new Error("Fast listener readiness timeout");
}
async function runBaseline(frame, file) {
  const win = frame.contentWindow;
  if (!win) throw new Error("iframe access error");
  const guard = installNetworkGuard(win);
  const input = await waitForInputAndFastReady(frame);
  let fastEvent = null;
  const onFast = (event) => { fastEvent = event?.detail || {}; };
  win.addEventListener("vehicle-certificate-qr-fast-ready", onFast);
  const started = performance.now();
  try {
    const dt = new win.DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", { configurable: true, value: dt.files });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    while (performance.now() - started < 12000) {
      const state = win.__vehicleCertificateQrFastState;
      if (fastEvent || state?.running === false) break;
      await wait(80);
    }
    const state = win.__vehicleCertificateQrFastState || {};
    const qr = Array.isArray(win.__vehicleCertificateQr) ? win.__vehicleCertificateQr : [];
    const network = guard.finish();
    return {
      qrCount: qr.length,
      runtimeExpectedQrCount: Number(state.expected || fastEvent?.expected?.count || 0) || null,
      runtimeVehicleKind: state.kind || fastEvent?.expected?.kind || null,
      elapsedMs: Number(state.elapsed || fastEvent?.elapsed || Math.round(performance.now() - started)),
      ...traceCounts(win.__certificateQrFastAuditTrace || {}),
      networkAudit: network,
      privacyFail: network.binaryUploadAttempts > 0,
      timeout: !(fastEvent || state?.running === false),
    };
  } finally {
    win.removeEventListener("vehicle-certificate-qr-fast-ready", onFast);
  }
}
function decodePairCanonicalSet(js, zx) {
  return new Set([js?.success ? js.canonical : "", zx?.success ? zx.canonical : ""].filter(Boolean));
}
function samePhysicalPayloadNear(a, b) {
  const near =
    Math.abs(Number(a.x) - Number(b.x)) <= .055 &&
    Math.abs(Number(a.y) - Number(b.y)) <= .065;
  if (!near) return false;
  for (const canonical of a.canonicalSet || []) {
    if (b.canonicalSet?.has(canonical)) return true;
  }
  return false;
}
async function decodeWithConfig({ jsQR, reader, raw, normalized, candidate, config }) {
  const canvas = cropCandidate(raw, normalized.paper, candidate, config);
  try {
    const js = await decodeJs(jsQR, canvas);
    const zx = await decodeZxing(reader, canvas);
    return {
      jsqrSuccess: js.success,
      zxingSuccess: zx.success,
      physicalSuccess: js.success || zx.success,
      crossEngineDuplicate: js.success && zx.success && sameCanonical(js.canonical, zx.canonical),
      crossEngineConflict: js.success && zx.success && !sameCanonical(js.canonical, zx.canonical),
      canonicalSet: decodePairCanonicalSet(js, zx),
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
function publicAttempt(attempt) {
  return {
    configId: attempt.configId,
    jsqrSuccess: attempt.jsqrSuccess,
    zxingSuccess: attempt.zxingSuccess,
    physicalSuccess: attempt.physicalSuccess,
    crossEngineDuplicate: attempt.crossEngineDuplicate,
    crossEngineConflict: attempt.crossEngineConflict,
  };
}
async function runMatrix(file) {
  const started = performance.now();
  const raw = await sourceCanvas(file);
  const normalized = normalizeCertificateCanvas(raw, 1800);
  const norm = normalized.canvas;
  const normCtx = norm.getContext("2d", { willReadFrequently: true });
  const normImage = normCtx.getImageData(0, 0, norm.width, norm.height);

  const rawCandidates = detectCertificateQrDensityCandidates2D(
    normImage.data,
    normImage.width,
    normImage.height,
    { maxCandidates: 20 }
  );
  const conservative = clusterCertificateQrCandidates2D(rawCandidates, {
    maxCandidates: 10,
    xTolerance: .030,
    rowTolerance: .060,
  });
  const previousStyle = clusterCertificateQrCandidates2D(rawCandidates, {
    maxCandidates: 10,
    xTolerance: .045,
    rowTolerance: .060,
  });
  const candidates = conservative.candidates;
  const [reader, jsMod] = await Promise.all([makeReader(), import("jsqr")]);
  const jsQR = jsMod.default || jsMod;

  const ensembleStats = Object.fromEntries(ENSEMBLE_CONFIGS.map((config) => [config.id, {
    ...config,
    attempts: 0,
    jsqrSuccesses: 0,
    zxingSuccesses: 0,
    physicalSuccesses: 0,
    crossEngineDuplicateRemovedCount: 0,
    crossEngineConflictCount: 0,
  }]));
  const rescueStats = Object.fromEntries(RESCUE_CONFIGS.map((config) => [config.id, {
    ...config,
    attempts: 0,
    jsqrSuccesses: 0,
    zxingSuccesses: 0,
    physicalSuccesses: 0,
    crossEngineDuplicateRemovedCount: 0,
    crossEngineConflictCount: 0,
  }]));

  const physicalRows = [];
  let totalEnsembleAttempts = 0;
  let skippedEnsembleAttempts = 0;
  let totalRescueAttempts = 0;

  try {
    for (let ci = 0; ci < candidates.length; ci += 1) {
      const candidate = candidates[ci];
      const row = {
        candidateIndex: ci + 1,
        x: candidate.x,
        y: candidate.y,
        score: candidate.score,
        mergedPeakCount: candidate.mergedPeakCount || 1,
        ensembleAttempts: [],
        rescueAttempts: [],
        canonicalSet: new Set(),
        ensembleSuccess: false,
        rescueSuccess: false,
      };

      for (let configIndex = 0; configIndex < ENSEMBLE_CONFIGS.length; configIndex += 1) {
        const config = ENSEMBLE_CONFIGS[configIndex];
        const result = await decodeWithConfig({ jsQR, reader, raw, normalized, candidate, config });
        totalEnsembleAttempts += 1;
        const stat = ensembleStats[config.id];
        stat.attempts += 1;
        if (result.jsqrSuccess) stat.jsqrSuccesses += 1;
        if (result.zxingSuccess) stat.zxingSuccesses += 1;
        if (result.physicalSuccess) stat.physicalSuccesses += 1;
        if (result.crossEngineDuplicate) stat.crossEngineDuplicateRemovedCount += 1;
        if (result.crossEngineConflict) stat.crossEngineConflictCount += 1;
        row.ensembleAttempts.push({ configId: config.id, ...result });
        if (result.physicalSuccess) {
          row.ensembleSuccess = true;
          for (const canonical of result.canonicalSet) row.canonicalSet.add(canonical);
          skippedEnsembleAttempts += ENSEMBLE_CONFIGS.length - configIndex - 1;
          break;
        }
        await wait(0);
      }

      if (!row.ensembleSuccess) {
        for (const config of RESCUE_CONFIGS) {
          const result = await decodeWithConfig({ jsQR, reader, raw, normalized, candidate, config });
          totalRescueAttempts += 1;
          const stat = rescueStats[config.id];
          stat.attempts += 1;
          if (result.jsqrSuccess) stat.jsqrSuccesses += 1;
          if (result.zxingSuccess) stat.zxingSuccesses += 1;
          if (result.physicalSuccess) stat.physicalSuccesses += 1;
          if (result.crossEngineDuplicate) stat.crossEngineDuplicateRemovedCount += 1;
          if (result.crossEngineConflict) stat.crossEngineConflictCount += 1;
          row.rescueAttempts.push({ configId: config.id, ...result });
          if (result.physicalSuccess) {
            row.rescueSuccess = true;
            for (const canonical of result.canonicalSet) row.canonicalSet.add(canonical);
          }
          await wait(0);
        }
      }
      physicalRows.push(row);
    }

    const acceptUnique = (rows, includeRescue) => {
      const accepted = [];
      let crossCandidatePayloadDuplicateRemovedCount = 0;
      for (const row of rows) {
        const success = row.ensembleSuccess || (includeRescue && row.rescueSuccess);
        if (!success) continue;
        const duplicate = accepted.some((known) => samePhysicalPayloadNear(known, row));
        if (duplicate) {
          crossCandidatePayloadDuplicateRemovedCount += 1;
          continue;
        }
        accepted.push(row);
      }
      return { accepted, crossCandidatePayloadDuplicateRemovedCount };
    };
    const ensembleUnique = acceptUnique(physicalRows, false);
    const rescueUnique = acceptUnique(physicalRows, true);

    const decodedItems = rescueUnique.accepted
      .map((row) => [...row.canonicalSet][0])
      .filter(Boolean)
      .map((data) => ({ data }));
    const decodedRuntime = expectedCertificateQrCount(decodedItems, "");

    return {
      candidateDetection: {
        dominantRowY: conservative.dominantRowY,
        rawCandidateCount: conservative.inputCandidateCount,
        conservativePhysicalCandidateCount: conservative.candidates.length,
        previousStylePhysicalCandidateCount: previousStyle.candidates.length,
        candidateCountDeltaVsPreviousStyle: conservative.candidates.length - previousStyle.candidates.length,
        rowClusterCount: conservative.rowClusterCount,
        candidatePositionDuplicateRemovedCount: conservative.candidatePositionDuplicateRemovedCount,
        discardedOffRowCount: conservative.discardedOffRowCount,
        physicalCandidates: conservative.candidates.map((candidate, index) => ({
          index: index + 1,
          x: candidate.x,
          y: candidate.y,
          score: candidate.score,
          mergedPeakCount: candidate.mergedPeakCount || 1,
        })),
      },
      ensemble: {
        order: ENSEMBLE_CONFIGS.map((config) => config.id),
        physicalUniqueQrCount: ensembleUnique.accepted.length,
        crossCandidatePayloadDuplicateRemovedCount: ensembleUnique.crossCandidatePayloadDuplicateRemovedCount,
        totalAttempts: totalEnsembleAttempts,
        skippedAttemptsByEarlySuccess: skippedEnsembleAttempts,
        averageAttemptsPerPhysicalCandidate: candidates.length
          ? Number((totalEnsembleAttempts / candidates.length).toFixed(3))
          : 0,
        stats: Object.values(ensembleStats).map((stat) => ({
          id: stat.id,
          attempts: stat.attempts,
          jsqrSuccesses: stat.jsqrSuccesses,
          zxingSuccesses: stat.zxingSuccesses,
          physicalSuccesses: stat.physicalSuccesses,
          crossEngineDuplicateRemovedCount: stat.crossEngineDuplicateRemovedCount,
          crossEngineConflictCount: stat.crossEngineConflictCount,
        })),
      },
      rescueStudy: {
        physicalUniqueQrCountAfterRescue: rescueUnique.accepted.length,
        addedPhysicalQrCount: Math.max(0, rescueUnique.accepted.length - ensembleUnique.accepted.length),
        totalAttempts: totalRescueAttempts,
        stats: Object.values(rescueStats).map((stat) => ({
          id: stat.id,
          attempts: stat.attempts,
          jsqrSuccesses: stat.jsqrSuccesses,
          zxingSuccesses: stat.zxingSuccesses,
          physicalSuccesses: stat.physicalSuccesses,
          crossEngineDuplicateRemovedCount: stat.crossEngineDuplicateRemovedCount,
          crossEngineConflictCount: stat.crossEngineConflictCount,
        })),
      },
      decodedRuntimeVehicleKind: decodedRuntime?.kind || null,
      decodedRuntimeExpectedQrCount: Number(decodedRuntime?.count || 0) || null,
      candidateDiagnostics: physicalRows.map((row) => ({
        candidateIndex: row.candidateIndex,
        x: row.x,
        y: row.y,
        score: row.score,
        mergedPeakCount: row.mergedPeakCount,
        ensembleSuccess: row.ensembleSuccess,
        rescueSuccess: row.rescueSuccess,
        ensembleAttempts: row.ensembleAttempts.map(publicAttempt),
        rescueAttempts: row.rescueAttempts.map(publicAttempt),
      })),
      elapsedMs: Math.round(performance.now() - started),
      normalizeMode: normalized.mode,
      normalizeConfidence: Number(Number(normalized.confidence || 0).toFixed(3)),
    };
  } finally {
    raw.width = 1;
    raw.height = 1;
    norm.width = 1;
    norm.height = 1;
  }
}
function applyCountingIntegrity(matrix, expectedQrCount) {
  const expected = Number(expectedQrCount);
  const ensembleCount = Number(matrix?.ensemble?.physicalUniqueQrCount || 0);
  const rescueCount = Number(matrix?.rescueStudy?.physicalUniqueQrCountAfterRescue || 0);
  return {
    ...matrix,
    ensemble: {
      ...matrix.ensemble,
      countingIntegrityFail: Number.isFinite(expected) ? ensembleCount > expected : false,
    },
    rescueStudy: {
      ...matrix.rescueStudy,
      countingIntegrityFail: Number.isFinite(expected) ? rescueCount > expected : false,
    },
  };
}
function aggregateExperiment(results) {
  return results.reduce((acc, result) => {
    const expected = Number(result.groundTruthExpectedQrCount || 0);
    const ensemble = result.matrix?.ensemble || {};
    const rescue = result.matrix?.rescueStudy || {};
    acc.expected += expected;
    acc.baselinePhysicalUnique += Number(result.baseline.qrCount || 0);
    acc.ensemblePhysicalUnique += Number(ensemble.physicalUniqueQrCount || 0);
    acc.rescuePhysicalUnique += Number(rescue.physicalUniqueQrCountAfterRescue || 0);
    if (result.baseline.qrCount === expected) acc.baselineCompleteImages += 1;
    if (ensemble.physicalUniqueQrCount === expected) acc.ensembleCompleteImages += 1;
    if (rescue.physicalUniqueQrCountAfterRescue === expected) acc.rescueCompleteImages += 1;
    if (ensemble.countingIntegrityFail) acc.ensembleCountingIntegrityFail = true;
    if (rescue.countingIntegrityFail) acc.rescueCountingIntegrityFail = true;
    acc.ensembleAttempts += Number(ensemble.totalAttempts || 0);
    acc.skippedEnsembleAttempts += Number(ensemble.skippedAttemptsByEarlySuccess || 0);
    acc.rescueAttempts += Number(rescue.totalAttempts || 0);
    acc.candidatePositionDuplicateRemovedCount += Number(result.matrix?.candidateDetection?.candidatePositionDuplicateRemovedCount || 0);
    acc.matrixElapsedMs += Number(result.matrix?.elapsedMs || 0);
    acc.baselineElapsedMs += Number(result.baseline?.elapsedMs || 0);
    for (const stat of ensemble.stats || []) {
      acc.ensembleJsqrSuccesses += Number(stat.jsqrSuccesses || 0);
      acc.ensembleZxingSuccesses += Number(stat.zxingSuccesses || 0);
      acc.crossEngineDuplicateRemovedCount += Number(stat.crossEngineDuplicateRemovedCount || 0);
    }
    return acc;
  }, {
    expected: 0,
    baselinePhysicalUnique: 0,
    ensemblePhysicalUnique: 0,
    rescuePhysicalUnique: 0,
    baselineCompleteImages: 0,
    ensembleCompleteImages: 0,
    rescueCompleteImages: 0,
    ensembleCountingIntegrityFail: false,
    rescueCountingIntegrityFail: false,
    ensembleAttempts: 0,
    skippedEnsembleAttempts: 0,
    rescueAttempts: 0,
    candidatePositionDuplicateRemovedCount: 0,
    matrixElapsedMs: 0,
    baselineElapsedMs: 0,
    ensembleJsqrSuccesses: 0,
    ensembleZxingSuccesses: 0,
    crossEngineDuplicateRemovedCount: 0,
  });
}
function publicResult(result) {
  return {
    fileName: result.fileName,
    groundTruthVehicleKind: result.groundTruthVehicleKind,
    groundTruthExpectedQrCount: result.groundTruthExpectedQrCount,
    groundTruthUsedDuringDecode: false,
    baseline: {
      ...result.baseline,
      physicalUniqueQrCount: result.baseline.qrCount,
      countingIntegrityFail: Number.isFinite(result.groundTruthExpectedQrCount)
        ? result.baseline.qrCount > result.groundTruthExpectedQrCount
        : false,
      networkAudit: result.baseline.networkAudit,
      kindMismatch: result.groundTruthVehicleKind
        ? result.baseline.runtimeVehicleKind !== result.groundTruthVehicleKind
        : null,
    },
    matrix: result.matrix,
    decodedRuntimeKindMismatch: result.groundTruthVehicleKind
      ? result.matrix.decodedRuntimeVehicleKind !== result.groundTruthVehicleKind
      : null,
  };
}

export default function CertificateQrDecodeExperimentPage() {
  const [files, setFiles] = useState([]);
  const [groundTruth, setGroundTruth] = useState(DEFAULT_GROUND_TRUTH);
  const [thumbnailUrls, setThumbnailUrls] = useState({});
  const [expandedName, setExpandedName] = useState("");
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("固定8枚を選択してください。");
  const frameRef = useRef(null);

  const normalizedNames = useMemo(() => files.map(normalizeFixedFileName), [files]);
  const nameSet = useMemo(() => new Set(normalizedNames.filter(Boolean)), [normalizedNames]);
  const valid = files.length === 8 && normalizedNames.every(Boolean) && nameSet.size === 8 && REQUIRED_NAMES.every((n) => nameSet.has(n));

  const filesByName = useMemo(() => {
    const map = {};
    for (const file of files) {
      const name = normalizeFixedFileName(file);
      if (name) map[name] = file;
    }
    return map;
  }, [files]);

  useEffect(() => {
    const next = {};
    for (const [name, file] of Object.entries(filesByName)) {
      next[name] = URL.createObjectURL(file);
    }
    setThumbnailUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [filesByName]);

  const setGt = (name, kind) => {
    const opt = GT_OPTIONS.find((x) => x.value === kind) || GT_OPTIONS[0];
    setGroundTruth((prev) => ({ ...prev, [name]: { vehicleKind: kind || null, expectedQrCount: opt.expected } }));
  };
  const reloadFrame = () => new Promise((resolve, reject) => {
    const frame = frameRef.current;
    if (!frame) return reject(new Error("iframe missing"));
    const timeout = setTimeout(() => reject(new Error("iframe load timeout")), 20000);
    frame.onload = () => { clearTimeout(timeout); resolve(); };
    frame.src = `${PATHNAME}?certificateQrAudit=1&nonce=${Date.now()}`;
  });

  const start = async () => {
    if (!valid || running) return;
    setRunning(true);
    setResults([]);
    const ordered = [...files].sort((a, b) => normalizeFixedFileName(a).localeCompare(normalizeFixedFileName(b)));
    const out = [];
    try {
      for (let i = 0; i < ordered.length; i += 1) {
        const file = ordered[i];
        const name = normalizeFixedFileName(file);
        setStatus(`${i + 1}/8 ${name}: Baseline Fast → decode matrix を実行中…`);
        await reloadFrame();
        const baseline = await runBaseline(frameRef.current, file);
        if (baseline.privacyFail) throw new Error(`${name}: privacy FAIL`);
        if (frameRef.current) {
          frameRef.current.src = "about:blank";
          await wait(80);
        }
        // Recognition isolation contract: runMatrix receives only the selected image File.
        // Ground Truth is intentionally read only after decode has fully finished.
        const rawMatrix = await runMatrix(file);
        const gt = groundTruth[name] || {};
        const matrix = applyCountingIntegrity(rawMatrix, gt.expectedQrCount);
        out.push({
          fileName: name,
          groundTruthVehicleKind: gt.vehicleKind || null,
          groundTruthExpectedQrCount: Number.isFinite(gt.expectedQrCount) ? gt.expectedQrCount : null,
          baseline,
          matrix,
        });
        setResults([...out]);
      }
      setStatus("固定8枚のdecode A/B診断が完了しました。Ground Truth未設定画像がある場合、正式QR取得率は未確定のままです。");
    } catch (e) {
      setStatus(`停止: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  const gtReady = results.length === 8 && results.every((r) => Number.isFinite(r.groundTruthExpectedQrCount));
  const totals = gtReady ? aggregateExperiment(results) : null;
  const ensembleRate = totals && !totals.ensembleCountingIntegrityFail && totals.expected
    ? Number((totals.ensemblePhysicalUnique / totals.expected).toFixed(4))
    : null;
  const rescueRate = totals && !totals.rescueCountingIntegrityFail && totals.expected
    ? Number((totals.rescuePhysicalUnique / totals.expected).toFixed(4))
    : null;
  const averageEnsembleAttemptsPerCandidate = results.length
    ? (() => {
        const candidates = results.reduce((sum, r) => sum + Number(r.matrix?.candidateDetection?.conservativePhysicalCandidateCount || 0), 0);
        return candidates ? Number((Number(totals?.ensembleAttempts || 0) / candidates).toFixed(3)) : 0;
      })()
    : null;

  const summary = JSON.stringify({
    schema: "icb-certificate-qr-decode-experiment-summary-v3",
    generatedAt: new Date().toISOString(),
    branchRole: "experimental-only",
    pathname: PATHNAME,
    groundTruthUsedDuringDecode: false,
    recognitionIsolation: RECOGNITION_ISOLATION,
    privacy: {
      imageUpload: false,
      qrPayloadIncluded: false,
      canonicalPayloadIncluded: false,
      thumbnailIncluded: false,
      browserMemoryOnly: true,
    },
    groundTruth: {
      ready: gtReady,
      totalExpectedQrCount: gtReady ? 47 : null,
      runtimeExpectedUsedAsGroundTruth: false,
      usedForScoringOnlyAfterDecode: true,
    },
    baselineTotals: totals ? {
      physicalUniqueQrCount: totals.baselinePhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRate: totals.expected ? Number((totals.baselinePhysicalUnique / totals.expected).toFixed(4)) : null,
      completeImageCount: totals.baselineCompleteImages,
      elapsedMs: totals.baselineElapsedMs,
    } : null,
    ensembleTotals: totals ? {
      physicalUniqueQrCount: totals.ensemblePhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRate: ensembleRate,
      completeImageCount: totals.ensembleCompleteImages,
      countingIntegrityFail: totals.ensembleCountingIntegrityFail,
      totalAttempts: totals.ensembleAttempts,
      averageAttemptsPerPhysicalCandidate: averageEnsembleAttemptsPerCandidate,
      skippedAttemptsByEarlySuccess: totals.skippedEnsembleAttempts,
      jsqrSuccesses: totals.ensembleJsqrSuccesses,
      zxingSuccesses: totals.ensembleZxingSuccesses,
      crossEngineDuplicateRemovedCount: totals.crossEngineDuplicateRemovedCount,
      candidatePositionDuplicateRemovedCount: totals.candidatePositionDuplicateRemovedCount,
      elapsedMs: totals.matrixElapsedMs,
    } : null,
    rescueStudyTotals: totals ? {
      physicalUniqueQrCountAfterRescue: totals.rescuePhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRateAfterRescue: rescueRate,
      completeImageCountAfterRescue: totals.rescueCompleteImages,
      countingIntegrityFail: totals.rescueCountingIntegrityFail,
      totalRescueAttempts: totals.rescueAttempts,
    } : null,
    results: results.map(publicResult),
  }, null, 2);

  const copySummary = async () => {
    await navigator.clipboard.writeText(summary);
    setStatus("非PII decode A/B summaryをコピーしました。");
  };
  const downloadSummary = () => {
    const blob = new Blob([summary], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificate-qr-decode-experiment-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1>車検証QR decode A/B 実験</h1>
      <p>Baselineは実際の {PATHNAME} → CertificateQrFast。改善候補はdynamic XY物理候補ごとに3段adaptive fallbackし、未取得候補だけgeneric rescue変換を比較します。</p>
      <p><b>禁止:</b> QR payloadの表示・保存・送信。本ページのsummaryは座標・設定・成功/失敗・件数のみです。</p>

      <section style={{ border: "1px solid #ccc", borderRadius: 12, padding: 14 }}>
        <input type="file" accept="image/*" multiple disabled={running} onChange={(e) => setFiles([...e.target.files].slice(0, 8))} />
        <div style={{ marginTop: 8 }}>{files.length}/8 選択</div>
        <div style={{ marginTop: 6, fontSize: 12 }}>正規化後: {normalizedNames.map((n) => n || "判定不可").join(" / ")}</div>
        {valid && (
          <div style={{ marginTop: 14 }}>
            <b>QR Ground Truth（写真を見て確認 / ブラウザローカルのみ）</b>
            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700 }}>
              ※ Ground Truthはdecode完了後の採点専用です。候補検出・decode停止・fallback・車種判定には使用しません。
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 12 }}>
              {REQUIRED_NAMES.map((name) => (
                <div key={name} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontFamily: "monospace", fontWeight: 800 }}>{name}</div>
                  {thumbnailUrls[name] && (
                    <button
                      type="button"
                      onClick={() => setExpandedName(name)}
                      disabled={running}
                      style={{ display: "block", width: "100%", padding: 0, marginTop: 8, border: 0, background: "transparent" }}
                    >
                      <img
                        src={thumbnailUrls[name]}
                        alt={`${name} 車検証サムネイル`}
                        style={{
                          display: "block",
                          width: "100%",
                          maxHeight: 260,
                          objectFit: "contain",
                          borderRadius: 10,
                          border: "1px solid #ccc",
                          background: "#f5f5f5",
                        }}
                      />
                    </button>
                  )}
                  <label style={{ display: "block", marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 5 }}>車種</div>
                    <select
                      value={groundTruth[name]?.vehicleKind || ""}
                      disabled={running}
                      onChange={(e) => setGt(name, e.target.value)}
                      style={{ width: "100%", padding: "10px 8px", fontSize: 16 }}
                    >
                      {GT_OPTIONS.map((o) => <option key={o.value || "unset"} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <div style={{ marginTop: 7, fontSize: 13 }}>
                    expected QR数: <b>{groundTruth[name]?.expectedQrCount ?? "未設定"}</b>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <button disabled={!valid || running} onClick={start} style={{ marginTop: 14, padding: "10px 18px", fontWeight: 700 }}>
          {running ? "実験中…" : "固定8枚 A/B開始"}
        </button>
        <div style={{ marginTop: 10, fontWeight: 700 }}>{status}</div>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>画像別</h2>
        {results.map((r) => (
          <div key={r.fileName} style={{ borderBottom: "1px solid #ddd", padding: "10px 0" }}>
            <b>{r.fileName}</b> — GT {r.groundTruthExpectedQrCount ?? "未設定"} —
            Baseline {r.baseline.qrCount} —
            Ensemble {r.matrix.ensemble.physicalUniqueQrCount} {r.matrix.ensemble.countingIntegrityFail ? "COUNTING FAIL" : ""} —
            Rescue後 {r.matrix.rescueStudy.physicalUniqueQrCountAfterRescue} {r.matrix.rescueStudy.countingIntegrityFail ? "COUNTING FAIL" : ""} —
            candidates {r.matrix.candidateDetection.conservativePhysicalCandidateCount}
            / previous-cluster {r.matrix.candidateDetection.previousStylePhysicalCandidateCount} —
            avg attempt {r.matrix.ensemble.averageAttemptsPerPhysicalCandidate} —
            skip {r.matrix.ensemble.skippedAttemptsByEarlySuccess} —
            {r.matrix.elapsedMs}ms —
            decoded kind {r.matrix.decodedRuntimeVehicleKind || "?"}
          </div>
        ))}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Adaptive fallback 集計</h2>
        <div>順番: {ENSEMBLE_CONFIGS.map((c) => c.id).join(" → ")}</div>
        <div>Ground Truth合計: 47 QR</div>
        <div>Baseline: {totals ? `${totals.baselinePhysicalUnique}/${totals.expected}` : "-"}</div>
        <div>Ensemble: {totals ? `${totals.ensemblePhysicalUnique}/${totals.expected}` : "-"} / rate {ensembleRate ?? "-"}</div>
        <div>完全取得: {totals ? `${totals.ensembleCompleteImages}/8` : "-"}</div>
        <div>平均attempt/候補: {averageEnsembleAttemptsPerCandidate ?? "-"}</div>
        <div>早期成功skip: {totals?.skippedEnsembleAttempts ?? "-"}</div>
        <div>Rescue study後: {totals ? `${totals.rescuePhysicalUnique}/${totals.expected}` : "-"} / rate {rescueRate ?? "-"}</div>
      </section>

      <section style={{ marginTop: 18 }}>
        <button disabled={!results.length} onClick={copySummary} style={{ marginRight: 8, padding: "9px 14px" }}>非PII summaryをコピー</button>
        <button disabled={!results.length} onClick={downloadSummary} style={{ padding: "9px 14px" }}>summaryを端末保存</button>
      </section>

      {expandedName && thumbnailUrls[expandedName] && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandedName("")}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 14,
          }}
        >
          <img
            src={thumbnailUrls[expandedName]}
            alt={`${expandedName} 拡大確認`}
            style={{ maxWidth: "100%", maxHeight: "92vh", objectFit: "contain", background: "#fff" }}
          />
        </div>
      )}

            <iframe ref={frameRef} title="baseline certificate QR Fast" style={{ width: "100%", height: 520, border: "1px solid #bbb", marginTop: 20 }} />
      <details style={{ marginTop: 16 }}><summary>非PII summary確認</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{summary}</pre></details>
    </main>
  );
}
