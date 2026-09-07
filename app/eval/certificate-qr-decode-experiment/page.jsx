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
const GEOMETRY_RECTIFY_CONFIGS = [
  { id: "geometry-rectify-native", outputScale: 1, sampling: "bilinear" },
  { id: "geometry-rectify-2x-nearest", outputScale: 2, sampling: "nearest" },
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
function paperHeightPx(pageGeometry, source) {
  const q = Array.isArray(pageGeometry?.quad) && pageGeometry.quad.length === 4 ? pageGeometry.quad : null;
  if (q) {
    const left = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const right = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
    return Math.max(1, (left + right) / 2);
  }
  return Math.max(1, Number(pageGeometry?.bounds?.h || pageGeometry?.h || source.height));
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
function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (const value of gray) hist[value] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    weightB += hist[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > bestVariance) {
      bestVariance = between;
      threshold = t;
    }
  }
  return threshold;
}
function thresholdCanvas(ctx, canvas, mode) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const count = canvas.width * canvas.height;
  const gray = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    gray[i] = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
  }
  if (mode === "otsu") {
    const threshold = otsuThreshold(gray);
    for (let i = 0, p = 0; i < count; i += 1, p += 4) {
      const value = gray[i] <= threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = value;
    }
  } else {
    const w = canvas.width;
    const h = canvas.height;
    const integral = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y += 1) {
      let row = 0;
      for (let x = 0; x < w; x += 1) {
        row += gray[y * w + x];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
      }
    }
    const radius = Math.max(6, Math.round(Math.min(w, h) * .055));
    const bias = 7;
    for (let y = 0; y < h; y += 1) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + radius + 1);
      for (let x = 0; x < w; x += 1) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(w, x + radius + 1);
        const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        const mean = sum / Math.max(1, (x1 - x0) * (y1 - y0));
        const value = gray[y * w + x] <= mean - bias ? 0 : 255;
        const p = (y * w + x) * 4;
        image.data[p] = image.data[p + 1] = image.data[p + 2] = value;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
function cropCandidate(source, pageGeometry, candidate, config) {
  let center = paperPoint(pageGeometry, source, candidate);
  let cropW = Math.max(12, paperWidthPx(pageGeometry, source) * (Number(config.widthRel) || .10));
  let cropH = cropW;
  if (config.useRefinedBbox && Number.isFinite(candidate?.refinedRawCenterX) && Number.isFinite(candidate?.refinedRawCenterY)) {
    center = { x: candidate.refinedRawCenterX, y: candidate.refinedRawCenterY };
    const margin = Math.max(.04, Math.min(.45, Number(config.bboxMargin) || .16));
    const baseW = Math.max(12, Number(candidate.refinedRawBboxWidth) || cropW * .55);
    const baseH = Math.max(12, Number(candidate.refinedRawBboxHeight) || baseW);
    cropW = baseW * (1 + margin * 2);
    cropH = baseH * (1 + margin * 2);
  }
  let sx = center.x - cropW / 2;
  let sy = center.y - cropH / 2;
  sx = Math.max(0, Math.min(source.width - cropW, sx));
  sy = Math.max(0, Math.min(source.height - cropH, sy));
  const sw = Math.max(1, Math.min(source.width - sx, cropW));
  const sh = Math.max(1, Math.min(source.height - sy, cropH));
  const scale = Math.max(.8, Math.min(3, Number(config.scale) || 1));
  const quietZoneRatio = config.useRefinedBbox ? .05 : Math.max(.04, Math.min(.20, Number(config.quietZoneRatio) || .08));
  const pad = Math.max(10, Math.round(Math.min(sw, sh) * scale * quietZoneRatio));
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

  if (config.mode === "otsu" || config.mode === "adaptive") thresholdCanvas(ctx, canvas, config.mode);
  return canvas;
}
function rectIntegral(binary, width, height) {
  const out = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += binary[y * width + x];
      out[(y + 1) * (width + 1) + x + 1] = out[y * (width + 1) + x + 1] + row;
    }
  }
  return out;
}
function integralRectSum(integral, width, x0, y0, x1, y1) {
  return integral[y1 * (width + 1) + x1]
    - integral[y0 * (width + 1) + x1]
    - integral[y1 * (width + 1) + x0]
    + integral[y0 * (width + 1) + x0];
}
function refineCandidateQrLike(raw, page, candidate) {
  const center = paperPoint(page, raw, candidate);
  const paperW = paperWidthPx(page, raw);
  const paperH = paperHeightPx(page, raw);
  const searchRawW = Math.max(80, paperW * .12);
  const searchRawH = searchRawW;
  let sx = Math.max(0, Math.min(raw.width - searchRawW, center.x - searchRawW / 2));
  let sy = Math.max(0, Math.min(raw.height - searchRawH, center.y - searchRawH / 2));
  const sw = Math.max(1, Math.min(raw.width - sx, searchRawW));
  const sh = Math.max(1, Math.min(raw.height - sy, searchRawH));
  const analysisSize = 180;
  const canvas = document.createElement("canvas");
  canvas.width = analysisSize;
  canvas.height = analysisSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(raw, sx, sy, sw, sh, 0, 0, analysisSize, analysisSize);
  try {
    const image = ctx.getImageData(0, 0, analysisSize, analysisSize);
    const gray = new Uint8Array(analysisSize * analysisSize);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
    }
    const threshold = otsuThreshold(gray);
    const dark = new Uint8Array(gray.length);
    const edgeH = new Uint8Array(gray.length);
    const edgeV = new Uint8Array(gray.length);
    const diffThreshold = 20;
    for (let y = 0; y < analysisSize; y += 1) {
      for (let x = 0; x < analysisSize; x += 1) {
        const i = y * analysisSize + x;
        dark[i] = gray[i] <= threshold ? 1 : 0;
        if (x + 1 < analysisSize && Math.abs(gray[i] - gray[i + 1]) >= diffThreshold) edgeH[i] = 1;
        if (y + 1 < analysisSize && Math.abs(gray[i] - gray[i + analysisSize]) >= diffThreshold) edgeV[i] = 1;
      }
    }
    const darkI = rectIntegral(dark, analysisSize, analysisSize);
    const hI = rectIntegral(edgeH, analysisSize, analysisSize);
    const vI = rectIntegral(edgeV, analysisSize, analysisSize);
    const sizes = [54, 64, 74, 84, 94];
    let best = null;
    for (const size of sizes) {
      const half = size / 2;
      for (let cy = 54; cy <= 126; cy += 8) {
        for (let cx = 54; cx <= 126; cx += 8) {
          const x0 = Math.max(0, Math.round(cx - half));
          const y0 = Math.max(0, Math.round(cy - half));
          const x1 = Math.min(analysisSize, Math.round(cx + half));
          const y1 = Math.min(analysisSize, Math.round(cy + half));
          const area = Math.max(1, (x1 - x0) * (y1 - y0));
          const hRate = integralRectSum(hI, analysisSize, x0, y0, x1, y1) / area;
          const vRate = integralRectSum(vI, analysisSize, x0, y0, x1, y1) / area;
          const edgeDensity = (hRate + vRate) / 2;
          const axisBalance = Math.min(hRate, vRate) / Math.max(.0001, Math.max(hRate, vRate));
          const darkRatio = integralRectSum(darkI, analysisSize, x0, y0, x1, y1) / area;
          const darkBalance = Math.max(0, 1 - Math.abs(darkRatio - .45) / .45);
          const centerDistance = Math.hypot(cx - analysisSize / 2, cy - analysisSize / 2) / analysisSize;
          const score = edgeDensity * (.55 + .45 * axisBalance) * (.65 + .35 * darkBalance) - centerDistance * .012;
          if (!best || score > best.score) best = { cx, cy, size, score, edgeDensity, axisBalance, darkRatio };
        }
      }
    }
    const scaleX = sw / analysisSize;
    const scaleY = sh / analysisSize;
    const rawCenterX = sx + best.cx * scaleX;
    const rawCenterY = sy + best.cy * scaleY;
    const bboxW = best.size * scaleX;
    const bboxH = best.size * scaleY;
    const dxRel = (rawCenterX - center.x) / paperW;
    const dyRel = (rawCenterY - center.y) / paperH;
    const qrLikePass = best.score >= .028 && best.edgeDensity >= .035 && best.axisBalance >= .18 && best.darkRatio >= .07 && best.darkRatio <= .90;
    return {
      ...candidate,
      coarseX: candidate.x,
      coarseY: candidate.y,
      x: Number(Math.max(0, Math.min(1, Number(candidate.x) + dxRel)).toFixed(4)),
      y: Number(Math.max(0, Math.min(1, Number(candidate.y) + dyRel)).toFixed(4)),
      refinedRawCenterX: rawCenterX,
      refinedRawCenterY: rawCenterY,
      refinedRawBboxWidth: bboxW,
      refinedRawBboxHeight: bboxH,
      bboxWidthRel: Number((bboxW / paperW).toFixed(4)),
      bboxHeightRel: Number((bboxH / paperH).toFixed(4)),
      squareRatio: Number((bboxW / Math.max(1, bboxH)).toFixed(3)),
      refineOffsetXRel: Number(dxRel.toFixed(4)),
      refineOffsetYRel: Number(dyRel.toFixed(4)),
      qrLikeScore: Number(best.score.toFixed(4)),
      localEdgeDensity: Number(best.edgeDensity.toFixed(4)),
      axisBalance: Number(best.axisBalance.toFixed(4)),
      darkRatio: Number(best.darkRatio.toFixed(4)),
      qrLikePass,
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
function rawBbox(candidate) {
  const w = Number(candidate.refinedRawBboxWidth || 0);
  const h = Number(candidate.refinedRawBboxHeight || w);
  return {
    x0: Number(candidate.refinedRawCenterX || 0) - w / 2,
    y0: Number(candidate.refinedRawCenterY || 0) - h / 2,
    x1: Number(candidate.refinedRawCenterX || 0) + w / 2,
    y1: Number(candidate.refinedRawCenterY || 0) + h / 2,
    w,
    h,
  };
}
function bboxIou(a, b) {
  const aa = rawBbox(a);
  const bb = rawBbox(b);
  const iw = Math.max(0, Math.min(aa.x1, bb.x1) - Math.max(aa.x0, bb.x0));
  const ih = Math.max(0, Math.min(aa.y1, bb.y1) - Math.max(aa.y0, bb.y0));
  const intersection = iw * ih;
  const union = aa.w * aa.h + bb.w * bb.h - intersection;
  return union > 0 ? intersection / union : 0;
}
function refineQrCandidates(raw, page, coarseCandidates) {
  const refinedAll = (coarseCandidates || []).map((candidate) => refineCandidateQrLike(raw, page, candidate));
  let weakRejectedCount = refinedAll.filter((candidate) => !candidate.qrLikePass).length;
  let pool = refinedAll.filter((candidate) => candidate.qrLikePass);
  if (pool.length < Math.min(2, refinedAll.length)) {
    pool = [...refinedAll].sort((a, b) => b.qrLikeScore - a.qrLikeScore).slice(0, Math.min(2, refinedAll.length));
    weakRejectedCount = Math.max(0, refinedAll.length - pool.length);
  }
  const kept = [];
  let overlapDuplicateMergedCount = 0;
  for (const candidate of [...pool].sort((a, b) => b.qrLikeScore - a.qrLikeScore)) {
    const duplicate = kept.find((known) => {
      const iou = bboxIou(known, candidate);
      const distance = Math.hypot(
        known.refinedRawCenterX - candidate.refinedRawCenterX,
        known.refinedRawCenterY - candidate.refinedRawCenterY
      );
      const minSize = Math.min(known.refinedRawBboxWidth, candidate.refinedRawBboxWidth);
      return iou >= .30 || distance <= minSize * .48;
    });
    if (duplicate) {
      overlapDuplicateMergedCount += 1;
      continue;
    }
    kept.push(candidate);
  }
  kept.sort((a, b) => a.x - b.x);
  return {
    inputCandidateCount: refinedAll.length,
    qrLikePassCount: refinedAll.filter((candidate) => candidate.qrLikePass).length,
    weakRejectedCount,
    overlapDuplicateMergedCount,
    falseOrDuplicateCandidateReductionCount: Math.max(0, refinedAll.length - kept.length),
    refinedCandidates: kept.map((candidate, index) => ({ ...candidate, index: index + 1 })),
    allDiagnostics: refinedAll.map((candidate, index) => ({
      coarseIndex: index + 1,
      coarseX: candidate.coarseX,
      coarseY: candidate.coarseY,
      refinedX: candidate.x,
      refinedY: candidate.y,
      bboxWidthRel: candidate.bboxWidthRel,
      bboxHeightRel: candidate.bboxHeightRel,
      squareRatio: candidate.squareRatio,
      refineOffsetXRel: candidate.refineOffsetXRel,
      refineOffsetYRel: candidate.refineOffsetYRel,
      qrLikeScore: candidate.qrLikeScore,
      localEdgeDensity: candidate.localEdgeDensity,
      axisBalance: candidate.axisBalance,
      darkRatio: candidate.darkRatio,
      qrLikePass: candidate.qrLikePass,
    })),
  };
}
function finderRatioMatch(runs) {
  if (!Array.isArray(runs) || runs.length !== 5) return null;
  const total = runs.reduce((sum, value) => sum + value, 0);
  if (total < 7) return null;
  const module = total / 7;
  const expected = [1, 1, 3, 1, 1];
  let error = 0;
  for (let i = 0; i < 5; i += 1) error += Math.abs(runs[i] - expected[i] * module);
  const normalizedError = error / total;
  if (normalizedError > .34) return null;
  return { module, normalizedError };
}
function scanFinderRuns(binary, width, height, horizontal = true) {
  const detections = [];
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  for (let o = 0; o < outer; o += 2) {
    const runs = [];
    let last = null;
    let length = 0;
    let start = 0;
    for (let i = 0; i <= inner; i += 1) {
      const value = i < inner
        ? binary[horizontal ? o * width + i : i * width + o]
        : -1;
      if (i === 0) {
        last = value;
        length = 1;
        start = 0;
        continue;
      }
      if (value === last && i < inner) {
        length += 1;
        continue;
      }
      runs.push({ color: last, length, start, end: i - 1 });
      last = value;
      length = 1;
      start = i;
    }
    for (let r = 0; r <= runs.length - 5; r += 1) {
      const seq = runs.slice(r, r + 5);
      if (seq[0].color !== 1 || seq[1].color !== 0 || seq[2].color !== 1 || seq[3].color !== 0 || seq[4].color !== 1) continue;
      const match = finderRatioMatch(seq.map((part) => part.length));
      if (!match) continue;
      const center = (seq[2].start + seq[2].end) / 2;
      detections.push(horizontal
        ? { x: center, y: o, module: match.module, error: match.normalizedError }
        : { x: o, y: center, module: match.module, error: match.normalizedError });
    }
  }
  return detections;
}
function clusterFinderIntersections(horizontal, vertical) {
  const intersections = [];
  for (const h of horizontal) {
    for (const v of vertical) {
      const module = (h.module + v.module) / 2;
      if (module < 1.1) continue;
      if (Math.abs(h.x - v.x) > module * 2.8 || Math.abs(h.y - v.y) > module * 2.8) continue;
      const moduleRatio = Math.max(h.module, v.module) / Math.max(.1, Math.min(h.module, v.module));
      if (moduleRatio > 2.2) continue;
      intersections.push({
        x: (h.x + v.x) / 2,
        y: (h.y + v.y) / 2,
        module,
        score: 1 / (1 + h.error + v.error),
      });
    }
  }
  const clusters = [];
  for (const point of intersections.sort((a, b) => b.score - a.score)) {
    const radius = Math.max(5, point.module * 3.2);
    let cluster = clusters.find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= radius);
    if (!cluster) {
      cluster = { x: point.x, y: point.y, module: point.module, score: point.score, count: 1 };
      clusters.push(cluster);
    } else {
      const w = cluster.count;
      cluster.x = (cluster.x * w + point.x) / (w + 1);
      cluster.y = (cluster.y * w + point.y) / (w + 1);
      cluster.module = (cluster.module * w + point.module) / (w + 1);
      cluster.score += point.score;
      cluster.count += 1;
    }
  }
  return clusters
    .filter((item) => item.count >= 2)
    .map((item) => ({ ...item, score: item.score / item.count }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}
function nearestQrDimension(estimate) {
  const clamped = Math.max(21, Math.min(177, Number(estimate) || 21));
  const version = Math.max(1, Math.min(40, Math.round((clamped - 17) / 4)));
  return 17 + 4 * version;
}
function chooseFinderTriplet(finders) {
  let best = null;
  const points = (finders || []).slice(0, 10);
  for (let i = 0; i < points.length; i += 1) {
    for (let j = 0; j < points.length; j += 1) {
      if (j === i) continue;
      for (let k = j + 1; k < points.length; k += 1) {
        if (k === i) continue;
        const tl = points[i], a = points[j], b = points[k];
        const ux = a.x - tl.x, uy = a.y - tl.y;
        const vx = b.x - tl.x, vy = b.y - tl.y;
        const du = Math.hypot(ux, uy), dv = Math.hypot(vx, vy);
        if (du < 16 || dv < 16) continue;
        const cos = Math.abs((ux * vx + uy * vy) / (du * dv));
        if (cos > .38) continue;
        const legRatio = Math.max(du, dv) / Math.max(1, Math.min(du, dv));
        if (legRatio > 2.0) continue;
        const modules = [tl.module, a.module, b.module];
        const moduleRatio = Math.max(...modules) / Math.max(.1, Math.min(...modules));
        if (moduleRatio > 2.0) continue;
        const cross = ux * vy - uy * vx;
        const tr = cross >= 0 ? a : b;
        const bl = cross >= 0 ? b : a;
        const geometryScore = (tl.score + a.score + b.score) / 3
          * (1 - cos)
          * (1 / legRatio)
          * (1 / moduleRatio);
        if (!best || geometryScore > best.geometryScore) best = { tl, tr, bl, geometryScore, cos, legRatio, moduleRatio };
      }
    }
  }
  return best;
}
function pointAdd(a, b, scale = 1) { return { x: a.x + b.x * scale, y: a.y + b.y * scale }; }
function pointSub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function pointScale(a, scale) { return { x: a.x * scale, y: a.y * scale }; }
function quadBounds(quad) {
  const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function quadArea(quad) {
  let area = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}
function detectLocalQrGeometry(raw, page, candidate) {
  const center = paperPoint(page, raw, candidate);
  const paperW = paperWidthPx(page, raw);
  const searchRawW = Math.max(120, Math.min(raw.width, paperW * .135));
  const searchRawH = searchRawW;
  const sx = Math.max(0, Math.min(raw.width - searchRawW, center.x - searchRawW / 2));
  const sy = Math.max(0, Math.min(raw.height - searchRawH, center.y - searchRawH / 2));
  const sw = Math.max(1, Math.min(raw.width - sx, searchRawW));
  const sh = Math.max(1, Math.min(raw.height - sy, searchRawH));
  const analysisSize = 300;
  const canvas = document.createElement("canvas");
  canvas.width = analysisSize;
  canvas.height = analysisSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(raw, sx, sy, sw, sh, 0, 0, analysisSize, analysisSize);
  try {
    const image = ctx.getImageData(0, 0, analysisSize, analysisSize);
    const gray = new Uint8Array(analysisSize * analysisSize);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
    }
    const threshold = otsuThreshold(gray);
    const binary = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) binary[i] = gray[i] <= threshold ? 1 : 0;
    const horizontal = scanFinderRuns(binary, analysisSize, analysisSize, true);
    const vertical = scanFinderRuns(binary, analysisSize, analysisSize, false);
    const finders = clusterFinderIntersections(horizontal, vertical);
    const triplet = chooseFinderTriplet(finders);
    if (!triplet) {
      return {
        geometryValid: false,
        geometryFailReason: finders.length < 3 ? "finder-count-under-3" : "finder-triplet-inconsistent",
        finderCount: finders.length,
        finders: finders.map((f) => ({ x: f.x, y: f.y, module: f.module, score: Number(f.score.toFixed(4)) })),
      };
    }

    const scaleX = sw / analysisSize;
    const scaleY = sh / analysisSize;
    const toRaw = (p) => ({ x: sx + p.x * scaleX, y: sy + p.y * scaleY });
    const tl = toRaw(triplet.tl), tr = toRaw(triplet.tr), bl = toRaw(triplet.bl);
    const moduleRaw = ((triplet.tl.module + triplet.tr.module + triplet.bl.module) / 3) * Math.sqrt(scaleX * scaleY);
    const du = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const dv = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const dimension = nearestQrDimension(((du + dv) / 2) / Math.max(1, moduleRaw) + 7);
    const uModule = pointScale(pointSub(tr, tl), 1 / Math.max(1, dimension - 7));
    const vModule = pointScale(pointSub(bl, tl), 1 / Math.max(1, dimension - 7));
    const p0 = pointAdd(pointAdd(tl, uModule, -3.5), vModule, -3.5);
    const p1 = pointAdd(pointAdd(tl, uModule, dimension - 3.5), vModule, -3.5);
    const p3 = pointAdd(pointAdd(tl, uModule, -3.5), vModule, dimension - 3.5);
    const p2 = pointAdd(pointAdd(tl, uModule, dimension - 3.5), vModule, dimension - 3.5);
    const q0 = pointAdd(pointAdd(tl, uModule, -7.5), vModule, -7.5);
    const q1 = pointAdd(pointAdd(tl, uModule, dimension + .5), vModule, -7.5);
    const q3 = pointAdd(pointAdd(tl, uModule, -7.5), vModule, dimension + .5);
    const q2 = pointAdd(pointAdd(tl, uModule, dimension + .5), vModule, dimension + .5);
    const quietQuad = [q0, q1, q2, q3];
    const qrQuad = [p0, p1, p2, p3];
    const bounds = quadBounds(quietQuad);
    const inBounds = bounds.x0 >= -2 && bounds.y0 >= -2 && bounds.x1 <= raw.width + 2 && bounds.y1 <= raw.height + 2;
    const area = quadArea(qrQuad);
    const minArea = Math.pow(Math.max(18, moduleRaw * 12), 2);
    if (!inBounds || area < minArea) {
      return {
        geometryValid: false,
        geometryFailReason: !inBounds ? "quad-out-of-bounds" : "quad-too-small",
        finderCount: finders.length,
        geometryScore: Number(triplet.geometryScore.toFixed(4)),
      };
    }
    const widthTop = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const widthBottom = Math.hypot(p2.x - p3.x, p2.y - p3.y);
    const heightLeft = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const heightRight = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const spread = Math.max(widthTop, widthBottom, heightLeft, heightRight) / Math.max(1, Math.min(widthTop, widthBottom, heightLeft, heightRight));
    return {
      geometryValid: true,
      geometryFailReason: "none",
      finderCount: finders.length,
      geometryScore: Number(triplet.geometryScore.toFixed(4)),
      qrDimension: dimension,
      modulePx: Number(moduleRaw.toFixed(2)),
      perspectiveScaleSpread: Number(spread.toFixed(3)),
      qrCenter: {
        x: Number(((p0.x + p1.x + p2.x + p3.x) / 4).toFixed(2)),
        y: Number(((p0.y + p1.y + p2.y + p3.y) / 4).toFixed(2)),
      },
      findersRaw: [tl, tr, bl].map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
      qrQuad: qrQuad.map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
      quietQuad: quietQuad.map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
function solveLinear8(matrix, vector) {
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let j = col; j <= 8; j += 1) a[col][j] /= div;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= 8; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[8]);
}
function homographyDestToSource(size, quad) {
  const dst = [[0,0],[size-1,0],[size-1,size-1],[0,size-1]];
  const m = [], b = [];
  for (let i = 0; i < 4; i += 1) {
    const [u,v] = dst[i];
    const { x, y } = quad[i];
    m.push([u,v,1,0,0,0,-u*x,-v*x]); b.push(x);
    m.push([0,0,0,u,v,1,-u*y,-v*y]); b.push(y);
  }
  return solveLinear8(m,b);
}
function sampleImage(data, width, height, x, y, nearest) {
  if (nearest) {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const p = (iy * width + ix) * 4;
    return [data[p], data[p+1], data[p+2], data[p+3]];
  }
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const out = [0,0,0,255];
  for (let c = 0; c < 3; c += 1) {
    const p00 = data[(y0*width+x0)*4+c], p10 = data[(y0*width+x1)*4+c];
    const p01 = data[(y1*width+x0)*4+c], p11 = data[(y1*width+x1)*4+c];
    out[c] = Math.round((p00*(1-fx)+p10*fx)*(1-fy) + (p01*(1-fx)+p11*fx)*fy);
  }
  return out;
}
function rectifyQrGeometry(raw, geometry, config) {
  const quad = geometry?.quietQuad;
  if (!geometry?.geometryValid || !Array.isArray(quad) || quad.length !== 4) return null;
  const sideA = Math.hypot(quad[1].x-quad[0].x, quad[1].y-quad[0].y);
  const sideB = Math.hypot(quad[2].x-quad[3].x, quad[2].y-quad[3].y);
  const native = Math.max(160, Math.min(520, Math.round((sideA + sideB) / 2)));
  const size = Math.max(160, Math.min(900, Math.round(native * (Number(config.outputScale) || 1))));
  const h = homographyDestToSource(size, quad);
  if (!h) return null;
  const bounds = quadBounds(quad);
  const x0 = Math.max(0, Math.floor(bounds.x0) - 2);
  const y0 = Math.max(0, Math.floor(bounds.y0) - 2);
  const x1 = Math.min(raw.width, Math.ceil(bounds.x1) + 2);
  const y1 = Math.min(raw.height, Math.ceil(bounds.y1) + 2);
  const sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0);
  const src = raw.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, sw, sh);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const out = ctx.createImageData(size, size);
  const nearest = config.sampling === "nearest";
  for (let v = 0; v < size; v += 1) {
    for (let u = 0; u < size; u += 1) {
      const denom = h[6]*u + h[7]*v + 1;
      const sx = (h[0]*u + h[1]*v + h[2]) / denom - x0;
      const sy = (h[3]*u + h[4]*v + h[5]) / denom - y0;
      const rgba = sampleImage(src.data, sw, sh, sx, sy, nearest);
      const p = (v*size+u)*4;
      out.data[p]=rgba[0]; out.data[p+1]=rgba[1]; out.data[p+2]=rgba[2]; out.data[p+3]=255;
    }
  }
  ctx.putImageData(out,0,0);
  return canvas;
}
function geometryOverlap(a,b) {
  if (!a?.geometryValid || !b?.geometryValid) return false;
  const aa=quadBounds(a.quietQuad), bb=quadBounds(b.quietQuad);
  const iw=Math.max(0,Math.min(aa.x1,bb.x1)-Math.max(aa.x0,bb.x0));
  const ih=Math.max(0,Math.min(aa.y1,bb.y1)-Math.max(aa.y0,bb.y0));
  const inter=iw*ih;
  const areaA=(aa.x1-aa.x0)*(aa.y1-aa.y0), areaB=(bb.x1-bb.x0)*(bb.y1-bb.y0);
  const iou=inter/Math.max(1,areaA+areaB-inter);
  const ca=a.qrCenter, cb=b.qrCenter;
  const dist=Math.hypot(ca.x-cb.x,ca.y-cb.y);
  return iou>=.28 || dist<=Math.min(Math.sqrt(areaA),Math.sqrt(areaB))*.35;
}
function documentPerspectiveMetrics(page) {
  const q = Array.isArray(page?.quad) && page.quad.length === 4 ? page.quad : null;
  if (!q) return { documentSkewDeg: 0, perspectiveSpreadDeg: 0, quadAvailable: false };
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const top = angle(q[0], q[1]);
  const bottom = angle(q[3], q[2]);
  const left = angle(q[0], q[3]) - 90;
  const right = angle(q[1], q[2]) - 90;
  return {
    documentSkewDeg: Number((((top + bottom + left + right) / 4)).toFixed(3)),
    perspectiveSpreadDeg: Number((Math.max(top, bottom, left, right) - Math.min(top, bottom, left, right)).toFixed(3)),
    quadAvailable: true,
  };
}
function candidateQualityMetrics(raw, page, candidate) {
  const config = { ...ENSEMBLE_CONFIGS[0], scale: 1, quietZoneRatio: .04 };
  const sourceCropPx = Math.max(1, paperWidthPx(page, raw) * config.widthRel);
  const canvas = cropCandidate(raw, page, candidate, config);
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const count = Math.max(1, image.width * image.height);
    const gray = new Float32Array(count);
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0, p = 0; p < image.data.length; p += 4, i += 1) {
      const g = image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08;
      gray[i] = g;
      sum += g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const mean = sum / count;
    let variance = 0;
    let edgeSum = 0;
    let edgeCount = 0;
    let lapSum = 0;
    let lapSqSum = 0;
    let lapCount = 0;
    for (let y = 1; y < image.height - 1; y += 1) {
      for (let x = 1; x < image.width - 1; x += 1) {
        const i = y * image.width + x;
        const g = gray[i];
        variance += (g - mean) * (g - mean);
        const gx = Math.abs(gray[i + 1] - gray[i - 1]);
        const gy = Math.abs(gray[i + image.width] - gray[i - image.width]);
        edgeSum += (gx + gy) / 2;
        edgeCount += 1;
        const lap = gray[i - 1] + gray[i + 1] + gray[i - image.width] + gray[i + image.width] - 4 * g;
        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount += 1;
      }
    }
    const lapMean = lapCount ? lapSum / lapCount : 0;
    const lapVariance = lapCount ? Math.max(0, lapSqSum / lapCount - lapMean * lapMean) : 0;
    const perspective = documentPerspectiveMetrics(page);
    return {
      cropPixelWidth: Math.round(sourceCropPx),
      cropPixelHeight: Math.round(sourceCropPx),
      analysisCanvasWidth: canvas.width,
      analysisCanvasHeight: canvas.height,
      localContrastRange: Number((max - min).toFixed(2)),
      localLumaStdDev: Number(Math.sqrt(variance / Math.max(1, edgeCount)).toFixed(2)),
      edgeStrength: Number((edgeSum / Math.max(1, edgeCount)).toFixed(2)),
      blurIndicatorLaplacianVariance: Number(lapVariance.toFixed(2)),
      candidateScore: Number(Number(candidate.score || 0).toFixed(4)),
      ...perspective,
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
function canvasToObjectUrl(canvas, type = "image/jpeg", quality = .82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("診断画像の生成に失敗しました"));
      resolve(URL.createObjectURL(blob));
    }, type, quality);
  });
}
async function buildCandidateVisualDiagnostics(file, matrix) {
  const raw=await sourceCanvas(file);
  const normalized=normalizeCertificateCanvas(raw,1800);
  const diagnostics=matrix?.geometryStage?.diagnostics||[];
  const scale=Math.min(1,1400/Math.max(raw.width,raw.height));
  const overlay=document.createElement("canvas");
  overlay.width=Math.max(1,Math.round(raw.width*scale));
  overlay.height=Math.max(1,Math.round(raw.height*scale));
  const ctx=overlay.getContext("2d");
  ctx.drawImage(raw,0,0,overlay.width,overlay.height);
  ctx.lineWidth=Math.max(2,Math.round(3*scale));
  ctx.font=`${Math.max(14,Math.round(18*scale))}px system-ui`;
  ctx.textBaseline="top";
  const cropUrls=[];
  try {
    for (const item of diagnostics) {
      if (item.skippedBecauseASuccess) continue;
      const candidate={x:item.x,y:item.y};
      const center=paperPoint(normalized.paper,raw,candidate);
      const currentW=paperWidthPx(normalized.paper,raw)*ENSEMBLE_CONFIGS[0].widthRel;
      ctx.strokeStyle="#ff9500";
      ctx.strokeRect((center.x-currentW/2)*scale,(center.y-currentW/2)*scale,currentW*scale,currentW*scale);
      ctx.fillStyle="rgba(255,149,0,.92)";
      ctx.fillRect((center.x-currentW/2)*scale,Math.max(0,(center.y-currentW/2)*scale-20),44,20);
      ctx.fillStyle="#fff";
      ctx.fillText(String(item.candidateIndex),(center.x-currentW/2)*scale+4,Math.max(0,(center.y-currentW/2)*scale-18));

      if (item.geometryValid) {
        ctx.fillStyle="#0a84ff";
        for (const p of item.findersRaw||[]) {
          ctx.beginPath(); ctx.arc(p.x*scale,p.y*scale,5,0,Math.PI*2); ctx.fill();
        }
        const drawQuad=(quad,color)=>{
          if (!Array.isArray(quad)||quad.length!==4) return;
          ctx.strokeStyle=color; ctx.beginPath();
          ctx.moveTo(quad[0].x*scale,quad[0].y*scale);
          for(let i=1;i<4;i+=1) ctx.lineTo(quad[i].x*scale,quad[i].y*scale);
          ctx.closePath(); ctx.stroke();
        };
        drawQuad(item.qrQuad,"#34c759");
        drawQuad(item.quietQuad,"#bf5af2");
      }

      const currentSmall=cropCandidate(raw,normalized.paper,candidate,ENSEMBLE_CONFIGS[0]);
      const currentSmallUrl=await canvasToObjectUrl(currentSmall);
      currentSmall.width=1; currentSmall.height=1;
      let rectifiedUrl=null;
      if (item.geometryValid && !item.overlapRejected) {
        const rectified=rectifyQrGeometry(raw,item,GEOMETRY_RECTIFY_CONFIGS[0]);
        if (rectified) {
          rectifiedUrl=await canvasToObjectUrl(rectified);
          rectified.width=1; rectified.height=1;
        }
      }
      cropUrls.push({candidateIndex:item.candidateIndex,currentSmallUrl,rectifiedUrl});
    }
    const overlayUrl=await canvasToObjectUrl(overlay);
    return {overlayUrl,cropUrls,legend:{coarseCrop:"orange",finders:"blue",qrQuad:"green",quietQuad:"purple"}};
  } finally {
    overlay.width=1; overlay.height=1;
    raw.width=1; raw.height=1;
    normalized.canvas.width=1; normalized.canvas.height=1;
  }
}
function revokeVisualDiagnosticEntry(entry) {
  if (!entry) return;
  if (entry.overlayUrl) URL.revokeObjectURL(entry.overlayUrl);
  for (const item of entry.cropUrls||[]) {
    if (item?.currentSmallUrl) URL.revokeObjectURL(item.currentSmallUrl);
    if (item?.rectifiedUrl) URL.revokeObjectURL(item.rectifiedUrl);
  }
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
function structuralValidation(canonical) {
  const text = canonicalText(canonical);
  const length = text.length;
  const slashCount = (text.match(/\//g) || []).length;
  const newlineCount = (text.match(/\n/g) || []).length;
  const pipeCount = (text.match(/\|/g) || []).length;
  const commaCount = (text.match(/,/g) || []).length;
  const replacementCount = (text.match(/�/g) || []).length;
  const controlCount = [...text].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 && ch !== "\n" && ch !== "\t";
  }).length;
  const printableRatio = length ? (length - replacementCount - controlCount) / length : 0;
  const slashFields = text.split("/").filter((part) => part.length > 0).length;
  const newlineFields = text.split("\n").filter((part) => part.length > 0).length;
  let recognizedSchemaClass = "unknown";
  if (slashCount >= 1 && slashFields >= 2) recognizedSchemaClass = "slash-delimited";
  else if (newlineCount >= 1 && newlineFields >= 2) recognizedSchemaClass = "newline-delimited";
  else if (pipeCount >= 1) recognizedSchemaClass = "pipe-delimited";
  else if (commaCount >= 2) recognizedSchemaClass = "comma-delimited";
  else if (length >= 3 && printableRatio >= .98) recognizedSchemaClass = "compact-printable";

  const separatorPattern =
    slashCount ? "slash" :
    newlineCount ? "newline" :
    pipeCount ? "pipe" :
    commaCount ? "comma" :
    "none";

  const failReasons = [];
  if (length < 3) failReasons.push("too-short");
  if (length > 1200) failReasons.push("too-long");
  if (printableRatio < .96) failReasons.push("low-printable-ratio");
  if (replacementCount > 0) failReasons.push("replacement-char");
  if (controlCount > 0) failReasons.push("control-char");
  if (!(slashCount >= 1 && slashCount <= 40 && slashFields >= 2 && slashFields <= 50)) {
    failReasons.push("slash-schema-mismatch");
  }

  let score = 0;
  if (length >= 3 && length <= 1200) score += 2;
  if (slashCount >= 1 && slashCount <= 40) score += 3;
  if (slashFields >= 2 && slashFields <= 50) score += 2;
  if (printableRatio >= .98) score += 2;
  if (replacementCount === 0 && controlCount === 0) score += 1;
  const pass = failReasons.length === 0;

  return {
    pass,
    score,
    payloadLength: length,
    printableRatio: Number(printableRatio.toFixed(4)),
    separatorPattern,
    recognizedSchemaClass,
    structuralFailReason: pass ? "none" : failReasons.join("+"),
    lengthBucket: length < 3 ? "too-short" : length > 1200 ? "too-long" : "normal",
    slashCountBucket: slashCount === 0 ? "none" : slashCount <= 8 ? "1-8" : slashCount <= 20 ? "9-20" : "21+",
    fieldCountBucket: slashFields <= 1 ? "0-1" : slashFields <= 8 ? "2-8" : slashFields <= 20 ? "9-20" : "21+",
    printableRatioBucket: printableRatio >= .98 ? "high" : printableRatio >= .96 ? "borderline" : "low",
  };
}
async function decodeJs(jsQR, canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!result) return { success: false, canonical: "", structural: structuralValidation("") };
    const canonical = canonicalDecode(result.data || "", Array.from(result.binaryData || []));
    return { success: Boolean(canonical), canonical, structural: structuralValidation(canonical) };
  } catch {
    return { success: false, canonical: "", structural: structuralValidation("") };
  }
}
async function makeReader(options = {}) {
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  const invertedHintAvailable = lib.DecodeHintType.ALSO_INVERTED !== undefined;
  if (options.alsoInverted && invertedHintAvailable) hints.set(lib.DecodeHintType.ALSO_INVERTED, true);
  return {
    reader: new browser.BrowserQRCodeReader(hints),
    audit: {
      tryHarderEnabled: true,
      alsoInvertedHintAvailable: invertedHintAvailable,
      alsoInvertedEnabled: Boolean(options.alsoInverted && invertedHintAvailable),
      hybridBinarizerPath: "BrowserCodeReader.decodeFromCanvas built-in",
    },
  };
}
async function decodeZxing(reader, canvas) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const raw = Array.from(result?.getRawBytes?.() || result?.rawBytes || []);
    const text = result?.getText?.() || result?.text || "";
    const canonical = canonicalDecode(text, raw);
    return { success: Boolean(canonical), canonical, structural: structuralValidation(canonical) };
  } catch {
    return { success: false, canonical: "", structural: structuralValidation("") };
  }
}
function sameCanonical(a, b) {
  return Boolean(a && b && a === b);
}
function adoptCanonical(js, zx) {
  const jsValid = Boolean(js?.success && js?.structural?.pass);
  const zxValid = Boolean(zx?.success && zx?.structural?.pass);
  const conflict = Boolean(js?.success && zx?.success && !sameCanonical(js.canonical, zx.canonical));
  if (js?.success && zx?.success && sameCanonical(js.canonical, zx.canonical)) {
    if (!jsValid && !zxValid) return { canonical: "", adoptedEngine: "none", adoptionReason: "same-payload-structural-fail", conflict: false };
    return { canonical: js.canonical, adoptedEngine: "both", adoptionReason: "same-payload", conflict: false };
  }
  if (conflict) {
    if (jsValid && !zxValid) return { canonical: js.canonical, adoptedEngine: "jsqr", adoptionReason: "conflict-js-only-structural-pass", conflict: true };
    if (zxValid && !jsValid) return { canonical: zx.canonical, adoptedEngine: "zxing", adoptionReason: "conflict-zxing-only-structural-pass", conflict: true };
    if (jsValid && zxValid) {
      const jsScore = Number(js.structural.score || 0);
      const zxScore = Number(zx.structural.score || 0);
      if (jsScore >= zxScore + 2) return { canonical: js.canonical, adoptedEngine: "jsqr", adoptionReason: "conflict-higher-structural-score", conflict: true };
      if (zxScore >= jsScore + 2) return { canonical: zx.canonical, adoptedEngine: "zxing", adoptionReason: "conflict-higher-structural-score", conflict: true };
      return { canonical: "", adoptedEngine: "none", adoptionReason: "conflict-ambiguous", conflict: true };
    }
    return { canonical: "", adoptedEngine: "none", adoptionReason: "conflict-structural-fail", conflict: true };
  }
  if (jsValid) return { canonical: js.canonical, adoptedEngine: "jsqr", adoptionReason: "single-engine-structural-pass", conflict: false };
  if (zxValid) return { canonical: zx.canonical, adoptedEngine: "zxing", adoptionReason: "single-engine-structural-pass", conflict: false };
  return { canonical: "", adoptedEngine: "none", adoptionReason: js?.success || zx?.success ? "single-engine-structural-fail" : "no-decode", conflict: false };
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
async function decodeCanvasPair({ jsQR, reader, canvas }) {
  const js = await decodeJs(jsQR, canvas);
  const zx = await decodeZxing(reader, canvas);
  const adopted = adoptCanonical(js, zx);
  const samePayloadBothEngines = Boolean(js.success && zx.success && sameCanonical(js.canonical, zx.canonical));
  return {
    jsqrSuccess: js.success,
    zxingSuccess: zx.success,
    jsStructuralPass: Boolean(js.structural?.pass),
    zxingStructuralPass: Boolean(zx.structural?.pass),
    jsStructural: js.structural,
    zxingStructural: zx.structural,
    samePayloadBothEngines,
    physicalSuccess: Boolean(adopted.canonical),
    crossEngineDuplicate: samePayloadBothEngines,
    crossEngineConflict: adopted.conflict,
    adoptedEngine: adopted.adoptedEngine,
    adoptionReason: adopted.adoptionReason,
    rawCanonicalSet: new Set([js?.success ? js.canonical : "", zx?.success ? zx.canonical : ""].filter(Boolean)),
    canonicalSet: new Set(adopted.canonical ? [adopted.canonical] : []),
  };
}
async function decodeWithConfig({ jsQR, reader, raw, normalized, candidate, config }) {
  const canvas = cropCandidate(raw, normalized.paper, candidate, config);
  try {
    return await decodeCanvasPair({ jsQR, reader, canvas });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
function publicAttempt(attempt) {
  const js = attempt?.jsStructural || {};
  const zx = attempt?.zxingStructural || {};
  return {
    configId: attempt.configId,
    jsqrSuccess: Boolean(attempt.jsqrSuccess),
    zxingSuccess: Boolean(attempt.zxingSuccess),
    samePayloadBothEngines: Boolean(attempt.samePayloadBothEngines),
    jsStructuralPass: Boolean(attempt.jsStructuralPass),
    zxingStructuralPass: Boolean(attempt.zxingStructuralPass),
    jsPayloadLength: Number(js.payloadLength || 0),
    zxingPayloadLength: Number(zx.payloadLength || 0),
    jsPrintableRatio: Number(js.printableRatio || 0),
    zxingPrintableRatio: Number(zx.printableRatio || 0),
    jsSeparatorPattern: js.separatorPattern || "none",
    zxingSeparatorPattern: zx.separatorPattern || "none",
    jsRecognizedSchemaClass: js.recognizedSchemaClass || "unknown",
    zxingRecognizedSchemaClass: zx.recognizedSchemaClass || "unknown",
    jsStructuralFailReason: js.structuralFailReason || "no-decode",
    zxingStructuralFailReason: zx.structuralFailReason || "no-decode",
    physicalSuccess: Boolean(attempt.physicalSuccess),
    crossEngineDuplicate: Boolean(attempt.crossEngineDuplicate),
    crossEngineConflict: Boolean(attempt.crossEngineConflict),
    adoptedEngine: attempt.adoptedEngine || "none",
    adoptionReason: attempt.adoptionReason || "none",
  };
}
function structuralFailAuditFromRows(rows, attemptKey) {
  const samePayloadStructuralFails = [];
  const singleEngineStructuralFails = [];
  let ambiguousConflictCount = 0;
  for (const row of rows || []) {
    for (const attempt of row?.[attemptKey] || []) {
      if (attempt.crossEngineConflict && (attempt.adoptionReason === "conflict-ambiguous" || attempt.adoptionReason === "conflict-structural-fail")) {
        ambiguousConflictCount += 1;
      }
      const audit = publicAttempt(attempt);
      if (attempt.samePayloadBothEngines && !attempt.physicalSuccess) {
        samePayloadStructuralFails.push({ candidateIndex: row.candidateIndex, ...audit });
      } else if (!attempt.crossEngineConflict && !attempt.samePayloadBothEngines
        && (attempt.jsqrSuccess || attempt.zxingSuccess) && !attempt.physicalSuccess) {
        singleEngineStructuralFails.push({ candidateIndex: row.candidateIndex, ...audit });
      }
    }
  }
  return {
    samePayloadStructuralFailCount: samePayloadStructuralFails.length,
    singleEngineStructuralFailCount: singleEngineStructuralFails.length,
    ambiguousConflictCount,
    samePayloadStructuralFails,
    singleEngineStructuralFails,
  };
}
function createStageStats(configs) {
  return Object.fromEntries(configs.map((config) => [config.id, {
    id: config.id,
    attempts: 0,
    jsqrSuccesses: 0,
    zxingSuccesses: 0,
    jsStructuralPasses: 0,
    zxingStructuralPasses: 0,
    physicalSuccesses: 0,
    crossEngineDuplicateCount: 0,
    crossEngineConflictCount: 0,
    netNewCanonicalQrCount: 0,
  }]));
}
function recordAttemptStat(stat, result) {
  stat.attempts += 1;
  if (result.jsqrSuccess) stat.jsqrSuccesses += 1;
  if (result.zxingSuccess) stat.zxingSuccesses += 1;
  if (result.jsStructuralPass) stat.jsStructuralPasses += 1;
  if (result.zxingStructuralPass) stat.zxingStructuralPasses += 1;
  if (result.physicalSuccess) stat.physicalSuccesses += 1;
  if (result.crossEngineDuplicate) stat.crossEngineDuplicateCount += 1;
  if (result.crossEngineConflict) stat.crossEngineConflictCount += 1;
}
function uniqueAcceptedRows(rows, successKey) {
  const accepted = [];
  let duplicatePayloadCandidateCount = 0;
  for (const row of rows) {
    if (!row[successKey]) continue;
    if (accepted.some((known) => samePhysicalPayloadNear(known, row))) {
      duplicatePayloadCandidateCount += 1;
      continue;
    }
    accepted.push(row);
  }
  return { accepted, duplicatePayloadCandidateCount };
}
function conflictDetailsFromRows(stage, rows, attemptKey) {
  const details=[];
  for(const row of rows||[]){
    for(const attempt of row?.[attemptKey]||[]){
      if(!attempt.crossEngineConflict) continue;
      details.push({stage,candidateIndex:row.candidateIndex,...publicAttempt(attempt)});
    }
  }
  return details;
}
function canonicalSetFromRows(rows, successKey) {
  const set = new Set();
  for (const row of rows || []) {
    if (!row?.[successKey]) continue;
    for (const canonical of row.canonicalSet || []) if (canonical) set.add(canonical);
  }
  return set;
}
function canonicalNetNew(stageSet, priorSet) {
  let count = 0;
  for (const canonical of stageSet || []) if (!priorSet.has(canonical)) count += 1;
  return count;
}
function unionCanonicalSets(...sets) {
  const out = new Set();
  for (const set of sets) for (const canonical of set || []) if (canonical) out.add(canonical);
  return out;
}
function legacyCompatibleStageReplay(rows, attemptKey) {
  const accepted = [];
  for (const row of rows || []) {
    const firstRawSuccess = (row?.[attemptKey] || []).find((attempt) => attempt.jsqrSuccess || attempt.zxingSuccess);
    if (!firstRawSuccess) continue;
    const legacyRow = {
      x: row.x,
      y: row.y,
      canonicalSet: new Set(firstRawSuccess.rawCanonicalSet || []),
    };
    if (accepted.some((known) => samePhysicalPayloadNear(known, legacyRow))) continue;
    accepted.push(legacyRow);
  }
  return accepted.length;
}
function stageExclusionDiagnostics(rows, successKey, attemptKey) {
  let rawDecodeCandidateCount = 0;
  let ambiguousConflictRejectedCandidateCount = 0;
  let nonConflictStructuralRejectedCandidateCount = 0;
  for (const row of rows || []) {
    const attempts = row?.[attemptKey] || [];
    const rawSuccess = attempts.some((attempt) => attempt.jsqrSuccess || attempt.zxingSuccess);
    if (rawSuccess) rawDecodeCandidateCount += 1;
    if (row?.[successKey] || !rawSuccess) continue;
    const ambiguousConflict = attempts.some((attempt) =>
      attempt.crossEngineConflict &&
      (attempt.adoptionReason === "conflict-ambiguous" || attempt.adoptionReason === "conflict-structural-fail")
    );
    if (ambiguousConflict) ambiguousConflictRejectedCandidateCount += 1;
    else nonConflictStructuralRejectedCandidateCount += 1;
  }
  return {
    rawDecodeCandidateCount,
    ambiguousConflictRejectedCandidateCount,
    nonConflictStructuralRejectedCandidateCount,
  };
}
async function runAdaptiveRows({ candidates, configs, jsQR, reader, raw, normalized, successKey, attemptKey }) {
  const rows = candidates.map((candidate, index) => ({
    ...candidate,
    candidateIndex: index + 1,
    [successKey]: false,
    [attemptKey]: [],
    canonicalSet: new Set(),
  }));
  const stats = createStageStats(configs);
  let totalAttempts = 0;
  let skippedAttemptsByEarlySuccess = 0;
  for (const row of rows) {
    for (let configIndex = 0; configIndex < configs.length; configIndex += 1) {
      const config = configs[configIndex];
      const result = await decodeWithConfig({ jsQR, reader, raw, normalized, candidate: row, config });
      totalAttempts += 1;
      recordAttemptStat(stats[config.id], result);
      row[attemptKey].push({ configId: config.id, ...result });
      if (result.physicalSuccess) {
        row[successKey] = true;
        for (const canonical of result.canonicalSet) row.canonicalSet.add(canonical);
        skippedAttemptsByEarlySuccess += configs.length - configIndex - 1;
        break;
      }
      await wait(0);
    }
  }
  const unique = uniqueAcceptedRows(rows, successKey);
  const legacyCompatiblePhysicalUniqueQrCount = legacyCompatibleStageReplay(rows, attemptKey);
  const exclusionDiagnostics = stageExclusionDiagnostics(rows, successKey, attemptKey);
  const seen = new Set();
  for (const row of unique.accepted) for (const canonical of row.canonicalSet) seen.add(canonical);
  for (const stat of Object.values(stats)) stat.netNewCanonicalQrCount = 0;
  for (const row of rows) {
    if (!row[successKey]) continue;
    const winning = (row[attemptKey] || []).find((attempt) => attempt.physicalSuccess);
    if (!winning) continue;
    const stat = stats[winning.configId];
    for (const canonical of row.canonicalSet) {
      // For a single adaptive stage, count one net-new physical canonical per winning candidate.
      if (canonical) { stat.netNewCanonicalQrCount += 1; break; }
    }
  }
  return {
    rows,
    stats: Object.values(stats),
    totalAttempts,
    skippedAttemptsByEarlySuccess,
    physicalUniqueQrCount: unique.accepted.length,
    legacyCompatiblePhysicalUniqueQrCount,
    exclusionDiagnostics,
    duplicatePayloadCandidateCount: unique.duplicatePayloadCandidateCount,
    conflictDetails: conflictDetailsFromRows(successKey, rows, attemptKey),
  };
}
async function augmentRows({ rows, configs, jsQR, reader, raw, normalized, priorSuccessKeys, successKey, attemptKey }) {
  const stats = createStageStats(configs);
  const priorAccepted = [];
  for (const row of rows) {
    if (priorSuccessKeys.some((key) => row[key])) priorAccepted.push(row);
    row[successKey] = false;
    row[attemptKey] = [];
  }
  const canonicalSeen = new Set();
  for (const row of priorAccepted) for (const canonical of row.canonicalSet || []) canonicalSeen.add(canonical);
  let totalAttempts = 0;
  let skippedAttemptsByEarlySuccess = 0;

  for (const row of rows) {
    if (priorSuccessKeys.some((key) => row[key])) continue;
    for (let configIndex = 0; configIndex < configs.length; configIndex += 1) {
      const config = configs[configIndex];
      const result = await decodeWithConfig({ jsQR, reader, raw, normalized, candidate: row, config });
      totalAttempts += 1;
      recordAttemptStat(stats[config.id], result);
      row[attemptKey].push({ configId: config.id, ...result });
      if (result.physicalSuccess) {
        row[successKey] = true;
        let netNew = false;
        for (const canonical of result.canonicalSet) {
          row.canonicalSet.add(canonical);
          if (!canonicalSeen.has(canonical)) {
            canonicalSeen.add(canonical);
            netNew = true;
          }
        }
        if (netNew) stats[config.id].netNewCanonicalQrCount += 1;
        skippedAttemptsByEarlySuccess += configs.length - configIndex - 1;
        break;
      }
      await wait(0);
    }
  }

  const accepted = [];
  let duplicatePayloadCandidateCount = 0;
  for (const row of rows) {
    if (!priorSuccessKeys.some((key) => row[key]) && !row[successKey]) continue;
    if (accepted.some((known) => samePhysicalPayloadNear(known, row))) {
      duplicatePayloadCandidateCount += 1;
      continue;
    }
    accepted.push(row);
  }
  return {
    rows,
    stats: Object.values(stats),
    totalAttempts,
    skippedAttemptsByEarlySuccess,
    physicalUniqueQrCount: accepted.length,
    duplicatePayloadCandidateCount,
    conflictDetails: conflictDetailsFromRows(successKey, rows, attemptKey),
  };
}
async function runGeometryFailOnly({ current, raw, normalized, jsQR, reader }) {
  const geometryStarted = performance.now();
  const diagnostics = [];
  for (const row of current.rows) {
    if (row.currentSuccess) {
      diagnostics.push({
        candidateIndex: row.candidateIndex,
        x: row.x,
        y: row.y,
        skippedBecauseASuccess: true,
        geometryValid: false,
        geometryFailReason: "a-success-skip",
      });
      continue;
    }
    const geometry = detectLocalQrGeometry(raw, normalized.paper, row);
    diagnostics.push({
      candidateIndex: row.candidateIndex,
      x: row.x,
      y: row.y,
      skippedBecauseASuccess: false,
      ...geometry,
      overlapRejected: false,
    });
    await wait(0);
  }

  const valid = diagnostics
    .filter((item) => item.geometryValid)
    .sort((a,b) => Number(b.geometryScore||0)-Number(a.geometryScore||0));
  const kept = [];
  let overlapMergedCount = 0;
  for (const item of valid) {
    const overlap = kept.find((known) => geometryOverlap(known, item));
    if (overlap) {
      item.overlapRejected = true;
      item.geometryFailReason = "geometry-overlap-duplicate";
      overlapMergedCount += 1;
    } else {
      kept.push(item);
    }
  }
  const geometryElapsedMs = Math.round(performance.now() - geometryStarted);

  const rectifyStarted = performance.now();
  const stats = createStageStats(GEOMETRY_RECTIFY_CONFIGS);
  const aCanonical=canonicalSetFromRows(current.rows,"currentSuccess");
  const eSeen=new Set();
  const eRows = [];
  for (const geometry of kept) {
    const row = current.rows.find((item) => item.candidateIndex === geometry.candidateIndex);
    const eRow = {
      candidateIndex: geometry.candidateIndex,
      x: row?.x,
      y: row?.y,
      geometry,
      geometrySuccess: false,
      geometryAttempts: [],
      canonicalSet: new Set(),
    };
    for (let i=0;i<GEOMETRY_RECTIFY_CONFIGS.length;i+=1) {
      const config=GEOMETRY_RECTIFY_CONFIGS[i];
      const canvas=rectifyQrGeometry(raw,geometry,config);
      if (!canvas) continue;
      try {
        const result=await decodeCanvasPair({jsQR,reader,canvas});
        recordAttemptStat(stats[config.id],result);
        eRow.geometryAttempts.push({configId:config.id,...result});
        if (result.physicalSuccess) {
          eRow.geometrySuccess=true;
          let configNetNew=false;
          for (const canonical of result.canonicalSet) {
            eRow.canonicalSet.add(canonical);
            if (!aCanonical.has(canonical) && !eSeen.has(canonical)) {
              eSeen.add(canonical);
              configNetNew=true;
            }
          }
          if (configNetNew) stats[config.id].netNewCanonicalQrCount += 1;
          break;
        }
      } finally {
        canvas.width=1;
        canvas.height=1;
      }
      await wait(0);
    }
    eRows.push(eRow);
  }
  const rectifyDecodeElapsedMs=Math.round(performance.now()-rectifyStarted);

  const eCanonical=canonicalSetFromRows(eRows,"geometrySuccess");
  const union=unionCanonicalSets(aCanonical,eCanonical);
  const netNew=canonicalNetNew(eCanonical,aCanonical);
  const structuralAudit=structuralFailAuditFromRows(eRows,"geometryAttempts");

  return {
    geometryElapsedMs,
    rectifyDecodeElapsedMs,
    aFailedCandidateCount: current.rows.filter((row)=>!row.currentSuccess).length,
    finderOrQuadEstablishedCandidateCount: valid.length,
    geometryKeptCandidateCount: kept.length,
    geometryOverlapMergedCount: overlapMergedCount,
    falseCandidateReductionCount: diagnostics.filter((item)=>!item.skippedBecauseASuccess && !item.geometryValid).length + overlapMergedCount,
    aCanonicalCount: aCanonical.size,
    eNetNewCanonicalVsA: netNew,
    finalUnionCanonicalCount: union.size,
    stats:Object.values(stats),
    diagnostics:diagnostics.map((item)=>({
      candidateIndex:item.candidateIndex,
      x:item.x,
      y:item.y,
      skippedBecauseASuccess:Boolean(item.skippedBecauseASuccess),
      geometryValid:Boolean(item.geometryValid),
      geometryFailReason:item.geometryFailReason||"unknown",
      overlapRejected:Boolean(item.overlapRejected),
      finderCount:Number(item.finderCount||0),
      geometryScore:Number(item.geometryScore||0),
      qrDimension:Number(item.qrDimension||0)||null,
      modulePx:Number(item.modulePx||0)||null,
      perspectiveScaleSpread:Number(item.perspectiveScaleSpread||0)||null,
      qrCenter:item.qrCenter||null,
      findersRaw:item.findersRaw||[],
      qrQuad:item.qrQuad||[],
      quietQuad:item.quietQuad||[],
    })),
    rows:eRows,
    structuralAudit,
    eCanonical,
    unionCanonical:union,
  };
}
async function runMatrix(file) {
  const totalStarted = performance.now();
  const raw = await sourceCanvas(file);
  const normalized = normalizeCertificateCanvas(raw, 1800);
  const norm = normalized.canvas;
  const normCtx = norm.getContext("2d", { willReadFrequently: true });
  const normImage = normCtx.getImageData(0, 0, norm.width, norm.height);

  try {
    const detectionStarted = performance.now();
    const rawCandidates = detectCertificateQrDensityCandidates2D(
      normImage.data,
      normImage.width,
      normImage.height,
      { maxCandidates: 20 }
    );
    const coarse = clusterCertificateQrCandidates2D(rawCandidates, {
      maxCandidates: 10,
      xTolerance: .030,
      rowTolerance: .060,
    });
    const candidateDetectionElapsedMs = Math.round(performance.now() - detectionStarted);

    const [readerBundle, jsMod] = await Promise.all([makeReader(), import("jsqr")]);
    const jsQR = jsMod.default || jsMod;

    const aStarted = performance.now();
    const current = await runAdaptiveRows({
      candidates: coarse.candidates,
      configs: ENSEMBLE_CONFIGS,
      jsQR,
      reader: readerBundle.reader,
      raw,
      normalized,
      successKey: "currentSuccess",
      attemptKey: "currentAttempts",
    });
    const aElapsedMs = Math.round(performance.now() - aStarted);

    const geometry = await runGeometryFailOnly({
      current,
      raw,
      normalized,
      jsQR,
      reader: readerBundle.reader,
    });

    const decodedItems=[...geometry.unionCanonical].map((data)=>({data}));
    const decodedRuntime=expectedCertificateQrCount(decodedItems,"");
    const aStructuralAudit=structuralFailAuditFromRows(current.rows,"currentAttempts");
    const allConflicts=current.conflictDetails.map((item)=>({...item,stage:"A-current-ensemble"}));
    for (const detail of conflictDetailsFromRows("E-geometry-rectify",geometry.rows,"geometryAttempts")) allConflicts.push(detail);

    const failOnlyExpectedElapsedMs =
      candidateDetectionElapsedMs + aElapsedMs + geometry.geometryElapsedMs + geometry.rectifyDecodeElapsedMs;

    return {
      candidateDetection:{
        dominantRowY:coarse.dominantRowY,
        rawCandidateCount:coarse.inputCandidateCount,
        coarsePhysicalCandidateCount:coarse.candidates.length,
        candidatePositionDuplicateRemovedCount:coarse.candidatePositionDuplicateRemovedCount,
        discardedOffRowCount:coarse.discardedOffRowCount,
        physicalCandidates:coarse.candidates.map((candidate,index)=>({
          index:index+1,x:candidate.x,y:candidate.y,score:candidate.score,mergedPeakCount:candidate.mergedPeakCount||1,
        })),
      },
      currentEnsemble:{
        physicalUniqueQrCount:current.physicalUniqueQrCount,
        legacyCompatiblePhysicalUniqueQrCount:current.legacyCompatiblePhysicalUniqueQrCount,
        v5ReferenceLegacyCompatiblePhysicalUniqueQrCount:29,
        decodeResultDeltaVsReference:current.legacyCompatiblePhysicalUniqueQrCount-29,
        structuralAndConflictDeltaVsLegacyCompatible:current.physicalUniqueQrCount-current.legacyCompatiblePhysicalUniqueQrCount,
        ...current.exclusionDiagnostics,
        totalAttempts:current.totalAttempts,
        skippedAttemptsByEarlySuccess:current.skippedAttemptsByEarlySuccess,
        stats:current.stats,
        structuralAudit:aStructuralAudit,
      },
      geometryStage:{
        aFailedCandidateCount:geometry.aFailedCandidateCount,
        finderOrQuadEstablishedCandidateCount:geometry.finderOrQuadEstablishedCandidateCount,
        geometryKeptCandidateCount:geometry.geometryKeptCandidateCount,
        geometryOverlapMergedCount:geometry.geometryOverlapMergedCount,
        falseCandidateReductionCount:geometry.falseCandidateReductionCount,
        aCanonicalCount:geometry.aCanonicalCount,
        eNetNewCanonicalVsA:geometry.eNetNewCanonicalVsA,
        finalUnionCanonicalCount:geometry.finalUnionCanonicalCount,
        stats:geometry.stats,
        diagnostics:geometry.diagnostics,
        structuralAudit:geometry.structuralAudit,
      },
      structuralValidation:{
        crossEngineConflictCount:allConflicts.length,
        ambiguousConflictCount:aStructuralAudit.ambiguousConflictCount+geometry.structuralAudit.ambiguousConflictCount,
        samePayloadStructuralFailCount:aStructuralAudit.samePayloadStructuralFailCount+geometry.structuralAudit.samePayloadStructuralFailCount,
        singleEngineStructuralFailCount:aStructuralAudit.singleEngineStructuralFailCount+geometry.structuralAudit.singleEngineStructuralFailCount,
        samePayloadStructuralFails:[
          ...aStructuralAudit.samePayloadStructuralFails.map((item)=>({...item,stage:"A-current-ensemble"})),
          ...geometry.structuralAudit.samePayloadStructuralFails.map((item)=>({...item,stage:"E-geometry-rectify"})),
        ],
        singleEngineStructuralFails:[
          ...aStructuralAudit.singleEngineStructuralFails.map((item)=>({...item,stage:"A-current-ensemble"})),
          ...geometry.structuralAudit.singleEngineStructuralFails.map((item)=>({...item,stage:"E-geometry-rectify"})),
        ],
        conflicts:allConflicts,
        adoptedConflictRule:"ambiguous conflict remains rejected; structural schema is audited, not loosened",
      },
      timing:{
        candidateDetectionElapsedMs,
        aElapsedMs,
        geometryElapsedMs:geometry.geometryElapsedMs,
        rectifyDecodeElapsedMs:geometry.rectifyDecodeElapsedMs,
        failOnlyExpectedElapsedMs,
        totalExperimentalElapsedMs:Math.round(performance.now()-totalStarted),
      },
      decodedRuntimeVehicleKind:decodedRuntime?.kind||null,
      decodedRuntimeExpectedQrCount:Number(decodedRuntime?.count||0)||null,
      normalizeMode:normalized.mode,
      normalizeConfidence:Number(Number(normalized.confidence||0).toFixed(3)),
    };
  } finally {
    raw.width=1; raw.height=1; norm.width=1; norm.height=1;
  }
}
function applyCountingIntegrity(matrix, expectedQrCount) {
  const expected=Number(expectedQrCount);
  const aCount=Number(matrix?.currentEnsemble?.physicalUniqueQrCount||0);
  const finalCount=Number(matrix?.geometryStage?.finalUnionCanonicalCount||0);
  const fail=(count)=>Number.isFinite(expected)?count>expected:false;
  return {
    ...matrix,
    currentEnsemble:{...matrix.currentEnsemble,countingIntegrityFail:fail(aCount)},
    geometryStage:{...matrix.geometryStage,countingIntegrityFail:fail(finalCount)},
  };
}
function aggregateStageStats(target, stats=[]) {
  for(const stat of stats){
    if(!target[stat.id]) target[stat.id]={
      id:stat.id,attempts:0,jsqrSuccesses:0,zxingSuccesses:0,
      jsStructuralPasses:0,zxingStructuralPasses:0,physicalSuccesses:0,
      crossEngineDuplicateCount:0,crossEngineConflictCount:0,netNewCanonicalQrCount:0,
    };
    for(const key of ["attempts","jsqrSuccesses","zxingSuccesses","jsStructuralPasses","zxingStructuralPasses","physicalSuccesses","crossEngineDuplicateCount","crossEngineConflictCount","netNewCanonicalQrCount"]){
      target[stat.id][key]+=Number(stat[key]||0);
    }
  }
}
function aggregateExperiment(results) {
  return results.reduce((acc,result)=>{
    const expected=Number(result.groundTruthExpectedQrCount||0);
    const a=result.matrix?.currentEnsemble||{};
    const e=result.matrix?.geometryStage||{};
    const structural=result.matrix?.structuralValidation||{};
    const timing=result.matrix?.timing||{};
    acc.expected+=expected;
    acc.baselinePhysicalUnique+=Number(result.baseline.qrCount||0);
    acc.aLegacyCompatible+=Number(a.legacyCompatiblePhysicalUniqueQrCount||0);
    acc.aSafe+=Number(a.physicalUniqueQrCount||0);
    acc.eNetNew+=Number(e.eNetNewCanonicalVsA||0);
    acc.finalUnion+=Number(e.finalUnionCanonicalCount||0);
    if(result.baseline.qrCount===expected) acc.baselineCompleteImages+=1;
    if(a.physicalUniqueQrCount===expected) acc.aCompleteImages+=1;
    if(e.finalUnionCanonicalCount===expected) acc.finalCompleteImages+=1;
    if(a.countingIntegrityFail) acc.aCountingIntegrityFail=true;
    if(e.countingIntegrityFail) acc.finalCountingIntegrityFail=true;

    acc.coarseCandidateCount+=Number(result.matrix?.candidateDetection?.coarsePhysicalCandidateCount||0);
    acc.aFailedCandidateCount+=Number(e.aFailedCandidateCount||0);
    acc.finderOrQuadEstablishedCandidateCount+=Number(e.finderOrQuadEstablishedCandidateCount||0);
    acc.geometryKeptCandidateCount+=Number(e.geometryKeptCandidateCount||0);
    acc.geometryOverlapMergedCount+=Number(e.geometryOverlapMergedCount||0);
    acc.falseCandidateReductionCount+=Number(e.falseCandidateReductionCount||0);

    acc.samePayloadStructuralFailCount+=Number(structural.samePayloadStructuralFailCount||0);
    acc.singleEngineStructuralFailCount+=Number(structural.singleEngineStructuralFailCount||0);
    acc.ambiguousConflictCount+=Number(structural.ambiguousConflictCount||0);
    acc.crossEngineConflictCount+=Number(structural.crossEngineConflictCount||0);
    for(const item of structural.samePayloadStructuralFails||[]) acc.samePayloadStructuralFails.push({fileName:result.fileName,...item});
    for(const item of structural.singleEngineStructuralFails||[]) acc.singleEngineStructuralFails.push({fileName:result.fileName,...item});
    for(const item of structural.conflicts||[]) acc.conflicts.push({fileName:result.fileName,...item});

    acc.baselineElapsedMs+=Number(result.baseline?.elapsedMs||0);
    acc.aElapsedMs+=Number(timing.aElapsedMs||0);
    acc.geometryElapsedMs+=Number(timing.geometryElapsedMs||0);
    acc.rectifyDecodeElapsedMs+=Number(timing.rectifyDecodeElapsedMs||0);
    acc.failOnlyExpectedElapsedMs+=Number(timing.failOnlyExpectedElapsedMs||0);
    acc.totalExperimentalElapsedMs+=Number(timing.totalExperimentalElapsedMs||0);

    aggregateStageStats(acc.aStats,a.stats);
    aggregateStageStats(acc.eStats,e.stats);
    return acc;
  },{
    expected:0,baselinePhysicalUnique:0,aLegacyCompatible:0,aSafe:0,eNetNew:0,finalUnion:0,
    baselineCompleteImages:0,aCompleteImages:0,finalCompleteImages:0,
    aCountingIntegrityFail:false,finalCountingIntegrityFail:false,
    coarseCandidateCount:0,aFailedCandidateCount:0,finderOrQuadEstablishedCandidateCount:0,
    geometryKeptCandidateCount:0,geometryOverlapMergedCount:0,falseCandidateReductionCount:0,
    samePayloadStructuralFailCount:0,singleEngineStructuralFailCount:0,ambiguousConflictCount:0,crossEngineConflictCount:0,
    samePayloadStructuralFails:[],singleEngineStructuralFails:[],conflicts:[],
    baselineElapsedMs:0,aElapsedMs:0,geometryElapsedMs:0,rectifyDecodeElapsedMs:0,
    failOnlyExpectedElapsedMs:0,totalExperimentalElapsedMs:0,
    aStats:{},eStats:{},
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
  const [visualDiagnostics, setVisualDiagnostics] = useState({});
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("固定8枚を選択してください。");
  const frameRef = useRef(null);
  const visualDiagnosticsRef = useRef({});

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

  const clearVisualDiagnostics = () => {
    for (const entry of Object.values(visualDiagnosticsRef.current)) revokeVisualDiagnosticEntry(entry);
    visualDiagnosticsRef.current = {};
    setVisualDiagnostics({});
  };

  useEffect(() => {
    clearVisualDiagnostics();
    return () => {
      for (const entry of Object.values(visualDiagnosticsRef.current)) revokeVisualDiagnosticEntry(entry);
      visualDiagnosticsRef.current = {};
    };
  }, [files]);

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
    clearVisualDiagnostics();
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
        if (name === "IMG_0942.jpeg" || name === "IMG_0944.jpeg") {
          setStatus(`${i + 1}/8 ${name}: browser-local crop診断画像を生成中…`);
          const visual = await buildCandidateVisualDiagnostics(file, rawMatrix);
          const previous = visualDiagnosticsRef.current[name];
          if (previous) revokeVisualDiagnosticEntry(previous);
          visualDiagnosticsRef.current = { ...visualDiagnosticsRef.current, [name]: visual };
          setVisualDiagnostics({ ...visualDiagnosticsRef.current });
        }
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
  const rate = (count, fail) => totals && !fail && totals.expected
    ? Number((Number(count || 0) / totals.expected).toFixed(4))
    : null;
  const currentRate = rate(totals?.currentPhysicalUnique, totals?.currentCountingIntegrityFail);
  const coreRate = rate(totals?.corePhysicalUnique, totals?.coreCountingIntegrityFail);
  const thresholdRate = rate(totals?.thresholdPhysicalUnique, totals?.thresholdCountingIntegrityFail);
  const rescueRate = rate(totals?.rescuePhysicalUnique, totals?.rescueCountingIntegrityFail);
  const runtimeVehicleKindCorrectCount = gtReady
    ? results.filter((r) => r.matrix?.decodedRuntimeVehicleKind === r.groundTruthVehicleKind).length
    : null;
  const runtimeVehicleKindAccuracy = gtReady
    ? Number((runtimeVehicleKindCorrectCount / 8).toFixed(4))
    : null;
  const sumStats = (map, key) => Object.values(map || {}).reduce((sum, item) => sum + Number(item?.[key] || 0), 0);

  const summary = JSON.stringify({
    schema: "icb-certificate-qr-decode-experiment-summary-v5",
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
      candidateCropImageIncluded: false,
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
      baselineElapsedMs: totals.baselineElapsedMs,
    } : null,
    aCurrentEnsembleTotals: totals ? {
      physicalUniqueQrCount: totals.currentPhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRate: currentRate,
      completeImageCount: totals.currentCompleteImages,
      countingIntegrityFail: totals.currentCountingIntegrityFail,
      jsqrSuccesses: sumStats(totals.currentStats, "jsqrSuccesses"),
      zxingSuccesses: sumStats(totals.currentStats, "zxingSuccesses"),
      crossEngineConflictCount: sumStats(totals.currentStats, "crossEngineConflictCount"),
      currentEnsembleElapsedMs: totals.currentEnsembleElapsedMs,
      stats: Object.values(totals.currentStats),
    } : null,
    aReproducibilityVsV4: totals ? {
      v4ReferencePhysicalUniqueQrCount: 29,
      v4ReferenceRate: 0.617,
      v5LegacyCompatiblePhysicalUniqueQrCount: totals.aLegacyCompatiblePhysicalUnique,
      v5StructuralAdoptedPhysicalUniqueQrCount: totals.currentPhysicalUnique,
      decodeResultDeltaVsV4Reference: totals.aLegacyCompatiblePhysicalUnique - 29,
      structuralAndConflictDeltaVsLegacyCompatible: totals.currentPhysicalUnique - totals.aLegacyCompatiblePhysicalUnique,
      rawDecodeCandidateCount: totals.aRawDecodeCandidateCount,
      ambiguousConflictRejectedCandidateCount: totals.aAmbiguousConflictRejectedCandidateCount,
      nonConflictStructuralRejectedCandidateCount: totals.aNonConflictStructuralRejectedCandidateCount,
      interpretation: "legacy-compatible replays first raw engine success per candidate; structural-adopted A uses v5 validation/arbitration",
    } : null,
    bRefinedCoreTotals: totals ? {
      physicalUniqueQrCount: totals.corePhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRate: coreRate,
      completeImageCount: totals.coreCompleteImages,
      countingIntegrityFail: totals.coreCountingIntegrityFail,
      jsqrSuccesses: sumStats(totals.coreStats, "jsqrSuccesses"),
      zxingSuccesses: sumStats(totals.coreStats, "zxingSuccesses"),
      crossEngineConflictCount: sumStats(totals.coreStats, "crossEngineConflictCount"),
      refinedCoreElapsedMs: totals.refinedCoreElapsedMs,
      stats: Object.values(totals.coreStats),
    } : null,
    candidateRefinementTotals: totals ? {
      coarseCandidateCount: totals.coarseCandidateCount,
      refinedCandidateCount: totals.refinedCandidateCount,
      weakRejectedCount: totals.weakRejectedCount,
      overlapDuplicateMergedCount: totals.overlapDuplicateMergedCount,
      falseOrDuplicateCandidateReductionCount: totals.falseOrDuplicateCandidateReductionCount,
      candidateRefineElapsedMs: totals.candidateRefineElapsedMs,
    } : null,
    cThresholdTotals: totals ? {
      physicalUniqueQrCountAfterThreshold: totals.thresholdPhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRateAfterThreshold: thresholdRate,
      completeImageCountAfterThreshold: totals.thresholdCompleteImages,
      countingIntegrityFail: totals.thresholdCountingIntegrityFail,
      netNewCanonicalQrCount: Math.max(0, totals.thresholdPhysicalUnique - totals.corePhysicalUnique),
      jsqrSuccesses: sumStats(totals.thresholdStats, "jsqrSuccesses"),
      zxingSuccesses: sumStats(totals.thresholdStats, "zxingSuccesses"),
      crossEngineConflictCount: sumStats(totals.thresholdStats, "crossEngineConflictCount"),
      thresholdElapsedMs: totals.thresholdElapsedMs,
      stats: Object.values(totals.thresholdStats),
    } : null,
    dRotateRescueTotals: totals ? {
      physicalUniqueQrCountAfterRescue: totals.rescuePhysicalUnique,
      expectedQrCount: totals.expected,
      qrAcquisitionRateAfterRescue: rescueRate,
      completeImageCountAfterRescue: totals.rescueCompleteImages,
      countingIntegrityFail: totals.rescueCountingIntegrityFail,
      netNewCanonicalQrCount: Math.max(0, totals.rescuePhysicalUnique - totals.thresholdPhysicalUnique),
      jsqrSuccesses: sumStats(totals.rescueStats, "jsqrSuccesses"),
      zxingSuccesses: sumStats(totals.rescueStats, "zxingSuccesses"),
      crossEngineConflictCount: sumStats(totals.rescueStats, "crossEngineConflictCount"),
      rotateRescueElapsedMs: totals.rotateRescueElapsedMs,
      stats: Object.values(totals.rescueStats),
    } : null,
    canonicalFlowTotals: totals ? {
      aCanonicalCount: totals.aCanonicalCount,
      bNetNewCanonicalVsA: totals.bNetNewCanonicalVsA,
      abCanonicalCount: totals.abCanonicalCount,
      cNetNewCanonicalVsAB: totals.cNetNewCanonicalVsAB,
      abcCanonicalCount: totals.abcCanonicalCount,
      dNetNewCanonicalVsABC: totals.dNetNewCanonicalVsABC,
      finalUnionCanonicalCount: totals.finalUnionCanonicalCount,
      payloadIncluded: false,
      intendedFailOnlyOrder: ["A currentEnsemble", "B refined+tight on A-fail", "C threshold on AB-fail", "D ±1° on ABC-fail"],
    } : null,
    structuralValidationTotals: totals ? {
      crossEngineConflictCount: totals.crossEngineConflictCount,
      conflicts: totals.conflicts,
      adoptionRule: "single structural pass wins; both pass requires structural score lead >=2; ambiguous conflict is not adopted",
      payloadIncluded: false,
    } : null,
    zxingAuditTotals: totals ? {
      tryHarderAlreadyEnabled: true,
      hybridBinarizerAlreadyInBrowserDecodePath: true,
      alsoInvertedHintAvailable: totals.zxingInvertedHintAvailable,
      invertedProbeTestedCandidateCount: totals.zxingInvertedTestedCandidateCount,
      invertedProbeStructuralPassCount: totals.zxingInvertedStructuralPassCount,
      invertedProbeAdditionalStructuralPassVsBase: totals.zxingInvertedAdditionalStructuralPassVsBase,
      invertedProbeElapsedMs: totals.zxingInvertedProbeElapsedMs,
      includedInFinalQrCount: false,
    } : null,
    timingTotals: totals ? {
      baselineElapsedMs: totals.baselineElapsedMs,
      currentEnsembleElapsedMs: totals.currentEnsembleElapsedMs,
      candidateRefineElapsedMs: totals.candidateRefineElapsedMs,
      refinedCoreElapsedMs: totals.refinedCoreElapsedMs,
      thresholdElapsedMs: totals.thresholdElapsedMs,
      rotateRescueElapsedMs: totals.rotateRescueElapsedMs,
      zxingInvertedProbeElapsedMs: totals.zxingInvertedProbeElapsedMs,
      productionCandidateElapsedMs: totals.productionCandidateElapsedMs,
      productionCandidateExcludesInvertedProbe: true,
      productionCandidateTimingIsDiagnosticUpperBoundForFailOnly: true,
      totalExperimentalElapsedMs: totals.totalExperimentalElapsedMs,
    } : null,
    runtimeVehicleKindTotals: gtReady ? {
      correctCount: runtimeVehicleKindCorrectCount,
      imageCount: 8,
      accuracy: runtimeVehicleKindAccuracy,
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
      <p>Baselineは実際の {PATHNAME} → CertificateQrFast。A=現Ensemble、B=QR-like candidate精製＋tight raw crop、C=Otsu/adaptive threshold、D=±1° rescueだけを比較します。</p>
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
        <h2>画像別 A/B/C/D</h2>
        {results.map((r) => (
          <div key={r.fileName} style={{ borderBottom: "1px solid #ddd", padding: "10px 0" }}>
            <b>{r.fileName}</b> — GT {r.groundTruthExpectedQrCount ?? "未設定"} —
            Baseline {r.baseline.qrCount} →
            A {r.matrix.currentEnsemble.physicalUniqueQrCount} →
            B {r.matrix.refinedCore.physicalUniqueQrCount} →
            C {r.matrix.thresholdStage.physicalUniqueQrCountAfterThreshold} →
            D {r.matrix.rotateRescueStage.physicalUniqueQrCountAfterRescue} —
            candidates {r.matrix.candidateDetection.coarsePhysicalCandidateCount}→{r.matrix.candidateRefinement.refinedCandidateCount}
            (削減 {r.matrix.candidateRefinement.falseOrDuplicateCandidateReductionCount}) —
            A {r.matrix.timing.currentEnsembleElapsedMs}ms /
            refine {r.matrix.timing.candidateRefineElapsedMs}ms /
            B {r.matrix.timing.refinedCoreElapsedMs}ms /
            threshold {r.matrix.timing.thresholdElapsedMs}ms /
            ±1° {r.matrix.timing.rotateRescueElapsedMs}ms /
            total {r.matrix.timing.totalExperimentalElapsedMs}ms —
            conflict {r.matrix.structuralValidation.crossEngineConflictCount} —
            kind {r.matrix.decodedRuntimeVehicleKind || "?"}
          </div>
        ))}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>A/B/C/D 集計</h2>
        <div>Ground Truth合計: 47 QR</div>
        <div>Baseline: {totals ? `${totals.baselinePhysicalUnique}/${totals.expected}` : "-"}</div>
        <div>A 現Ensemble: {totals ? `${totals.currentPhysicalUnique}/${totals.expected}` : "-"} / rate {currentRate ?? "-"}</div>
        <div>B candidate精製+tight: {totals ? `${totals.corePhysicalUnique}/${totals.expected}` : "-"} / rate {coreRate ?? "-"}</div>
        <div>C +threshold: {totals ? `${totals.thresholdPhysicalUnique}/${totals.expected}` : "-"} / rate {thresholdRate ?? "-"}</div>
        <div>D +±1°: {totals ? `${totals.rescuePhysicalUnique}/${totals.expected}` : "-"} / rate {rescueRate ?? "-"}</div>
        <div>完全取得: A {totals?.currentCompleteImages ?? "-"}/8 / B {totals?.coreCompleteImages ?? "-"}/8 / C {totals?.thresholdCompleteImages ?? "-"}/8 / D {totals?.rescueCompleteImages ?? "-"}/8</div>
        <div>candidate: coarse {totals?.coarseCandidateCount ?? "-"} → refined {totals?.refinedCandidateCount ?? "-"} / weak除外 {totals?.weakRejectedCount ?? "-"} / overlap統合 {totals?.overlapDuplicateMergedCount ?? "-"}</div>
        <div>canonical flow: A {totals?.aCanonicalCount ?? "-"} / B純増 {totals?.bNetNewCanonicalVsA ?? "-"} / A∪B {totals?.abCanonicalCount ?? "-"} / C純増 {totals?.cNetNewCanonicalVsAB ?? "-"} / A∪B∪C {totals?.abcCanonicalCount ?? "-"} / D純増 {totals?.dNetNewCanonicalVsABC ?? "-"} / final union {totals?.finalUnionCanonicalCount ?? "-"}</div>
        <div>A再現性: v4=29 / legacy-compatible v5={totals?.aLegacyCompatiblePhysicalUnique ?? "-"} / structural採用後={totals?.currentPhysicalUnique ?? "-"}</div>
        <div>A除外内訳: ambiguous conflict {totals?.aAmbiguousConflictRejectedCandidateCount ?? "-"} / non-conflict structural {totals?.aNonConflictStructuralRejectedCandidateCount ?? "-"}</div>
        <div>crossEngineConflict: {totals?.crossEngineConflictCount ?? "-"}</div>
        <div>runtime車種判定: {runtimeVehicleKindCorrectCount ?? "-"}/8 ({runtimeVehicleKindAccuracy ?? "-"})</div>
        <div>時間: baseline {totals?.baselineElapsedMs ?? "-"}ms / A {totals?.currentEnsembleElapsedMs ?? "-"}ms / refine {totals?.candidateRefineElapsedMs ?? "-"}ms / B {totals?.refinedCoreElapsedMs ?? "-"}ms / threshold {totals?.thresholdElapsedMs ?? "-"}ms / ±1° {totals?.rotateRescueElapsedMs ?? "-"}ms / productionCandidate(no probe) {totals?.productionCandidateElapsedMs ?? "-"}ms / probe {totals?.zxingInvertedProbeElapsedMs ?? "-"}ms / total {totals?.totalExperimentalElapsedMs ?? "-"}ms</div>
        {totals && (
          <div style={{ marginTop: 10 }}>
            <b>Threshold / ±1° 純増</b>
            {Object.values(totals.thresholdStats).map((item) => (
              <div key={item.id} style={{ fontSize: 13 }}>{item.id}: netNew {item.netNewCanonicalQrCount} / attempts {item.attempts}</div>
            ))}
            {Object.values(totals.rescueStats).map((item) => (
              <div key={item.id} style={{ fontSize: 13 }}>{item.id}: netNew {item.netNewCanonicalQrCount} / attempts {item.attempts}</div>
            ))}
          </div>
        )}
        {totals && (
          <div style={{ marginTop: 10 }}>
            <b>ZXing audit probe（最終件数には不算入）</b>
            <div style={{ fontSize: 13 }}>
              TRY_HARDER=on / HybridBinarizer=built-in / ALSO_INVERTED available={String(totals.zxingInvertedHintAvailable)} /
              tested {totals.zxingInvertedTestedCandidateCount} / extra structural pass {totals.zxingInvertedAdditionalStructuralPassVsBase}
            </div>
          </div>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>0942 / 0944 browser-local refine診断</h2>
        <p style={{ fontSize: 12 }}>画像/cropは端末ローカルobjectURLのみ。赤枠=旧current-small、緑枠=QR-like refined bbox。summaryには画像を含めません。</p>
        {["IMG_0942.jpeg", "IMG_0944.jpeg"].map((name) => {
          const visual = visualDiagnostics[name];
          const result = results.find((r) => r.fileName === name);
          if (!visual || !result) return <div key={name} style={{ marginTop: 10 }}>{name}: 実験完了後に表示</div>;
          return (
            <div key={name} style={{ marginTop: 16, border: "1px solid #ccc", borderRadius: 12, padding: 12 }}>
              <h3 style={{ marginTop: 0 }}>{name}</h3>
              <img src={visual.overlayUrl} alt={`${name} refined candidate overlay`} style={{ width: "100%", maxHeight: 520, objectFit: "contain", background: "#f4f4f4" }} />
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                {visual.cropUrls.map((crop) => {
                  const diagnostic = result.matrix.candidateDiagnostics.find((item) => item.candidateIndex === crop.candidateIndex);
                  const refined = result.matrix.candidateRefinement.refinedCandidates.find((item) => item.index === crop.candidateIndex);
                  const q = diagnostic?.quality || {};
                  return (
                    <div key={crop.candidateIndex} style={{ borderTop: "1px solid #ddd", paddingTop: 10 }}>
                      <b>candidate {crop.candidateIndex}</b>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        x={diagnostic?.x} y={diagnostic?.y} / qrLike={diagnostic?.qrLikeScore} /
                        B={String(Boolean(diagnostic?.coreSuccess))} /
                        C={String(Boolean(diagnostic?.thresholdSuccess))} /
                        D={String(Boolean(diagnostic?.rotateRescueSuccess))}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        bboxRel {refined?.bboxWidthRel}×{refined?.bboxHeightRel} /
                        refineOffset x={refined?.refineOffsetXRel} y={refined?.refineOffsetYRel} /
                        axisBalance {refined?.axisBalance} /
                        darkRatio {refined?.darkRatio}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        crop {q.cropPixelWidth}×{q.cropPixelHeight}px /
                        contrastRange {q.localContrastRange} /
                        edge {q.edgeStrength} /
                        blurVar {q.blurIndicatorLaplacianVariance}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>A current-small</div>
                          <img src={crop.currentSmallUrl} alt={`${name} candidate ${crop.candidateIndex} current small`} style={{ width: "100%", maxHeight: 220, objectFit: "contain", background: "#fff", border: "1px solid #ddd" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>B tight-small</div>
                          <img src={crop.tightSmallUrl} alt={`${name} candidate ${crop.candidateIndex} tight small`} style={{ width: "100%", maxHeight: 220, objectFit: "contain", background: "#fff", border: "1px solid #ddd" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>B tight-medium</div>
                          <img src={crop.tightMediumUrl} alt={`${name} candidate ${crop.candidateIndex} tight medium`} style={{ width: "100%", maxHeight: 220, objectFit: "contain", background: "#fff", border: "1px solid #ddd" }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
