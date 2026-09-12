"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateUnknownSafeCompletion } from "./unknown-safe-contract.mjs";

const LIVE_SCAN_REVISION = "live-poc-v3-candidate-lock-null-semantics-1";
const COUNTING_INTEGRITY_SCHEMA = "icb-certificate-qr-live-counting-integrity-v1";
const PARSER_SEPARATION_SCHEMA = "icb-certificate-qr-live-parser-separated-eval-v1";
const MANAGEMENT_SHORT_SCHEMA = "icb-ocr-management-short-summary-v1";
const EVALUATION_BRANCH = "eval/certificate-qr-live-parser-separation";
const LIVE_BASELINE_HEAD = "00d932767837d7cf501ea8ac96e8a4f6e945204a";
const COUNTING_DIAGNOSTIC_SHORT_WINDOW_FRAMES = 3;
const COUNTING_DIAGNOSTIC_SPATIAL_CLUSTER_DISTANCE = .11;
const FRAME_INTERVAL_MS = 250;
const MAX_DECODE_DIMENSION = 1280;
const PHYSICAL_LOCATOR_EVERY_FRAMES = 4;
const PHYSICAL_LOCATOR_MAX_WIDTH = 520;
const PHYSICAL_LOCATOR_TRACK_TTL_FRAMES = 16;
const PHYSICAL_LOCATOR_DECODE_MATCH_WINDOW_FRAMES = 12;
const LOCAL_RESCUE_STALL_FRAMES = 16;
const LOCAL_RESCUE_VARIANTS_PER_FRAME = 2;
const LOCAL_RESCUE_RETARGET_EVERY_FRAMES = 6;
const GUIDE_ROI = Object.freeze({ x: .04, y: .43, w: .92, h: .44 });
const SUB_ROIS_PER_FRAME = 3;
const SUB_ROIS = Object.freeze([
  { id: "left", x: 0, y: 0, w: .30, h: 1 },
  { id: "left-mid", x: .175, y: 0, w: .30, h: 1 },
  { id: "center", x: .35, y: 0, w: .30, h: 1 },
  { id: "right-mid", x: .525, y: 0, w: .30, h: 1 },
  { id: "right", x: .70, y: 0, w: .30, h: 1 },
]);
const LOCAL_RESCUE_VARIANTS = Object.freeze([
  { id: "wide", dx: -.06, dy: 0, dw: .12, dh: 0, scale: 1 },
  { id: "narrow-upscale", dx: .04, dy: .08, dw: -.08, dh: -.16, scale: 1.25 },
  { id: "left-offset", dx: -.08, dy: 0, dw: 0, dh: 0, scale: 1.1 },
  { id: "right-offset", dx: .08, dy: 0, dw: 0, dh: 0, scale: 1.1 },
  { id: "upper", dx: -.03, dy: 0, dw: .06, dh: -.28, scale: 1.15 },
  { id: "lower", dx: -.03, dy: .28, dw: .06, dh: -.28, scale: 1.15 },
  { id: "base-upscale", dx: 0, dy: 0, dw: 0, dh: 0, scale: 1.3 },
]);

function canonicalText(value) {
  return String(value ?? "")
    .replace(/\0+$/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function decodeBytesText(bytes = []) {
  const raw = Uint8Array.from(bytes || []);
  if (!raw.length) return "";
  const candidates = [];
  for (const encoding of ["utf-8", "shift_jis"]) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(raw).replace(/\0/g, "").trim();
      if (!text) continue;
      let score = 0;
      if (/^(?:2|K)\//.test(text)) score += 12;
      if (text.includes("/")) score += 5;
      if (/[一-龠ぁ-んァ-ヶ]/.test(text)) score += 2;
      const controls = (text.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
      score -= controls * 4;
      candidates.push({ text, score });
    } catch {}
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.text || "";
}

function canonicalDecode(text, bytes = []) {
  const fromBytes = decodeBytesText(bytes);
  return canonicalText(fromBytes || text || "");
}

function parserSchemaRecognition(canonical) {
  const text = canonicalText(canonical);
  if (/^K\//.test(text)) return { recognized: true, parserSchemaClass: "kei-slash" };
  if (/^2\//.test(text)) return { recognized: true, parserSchemaClass: "registered-slash" };
  return { recognized: false, parserSchemaClass: "unrecognized" };
}

function structuralValidation(canonical) {
  const text = canonicalText(canonical);
  const chars = [...text];
  const length = chars.length;
  const slashCount = (text.match(/\//g) || []).length;
  const slashFields = text.split("/").filter(Boolean).length;
  const replacementCount = (text.match(/�/g) || []).length;
  const controlCount = chars.filter((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 && ch !== "\n" && ch !== "\t";
  }).length;
  const printableRatio = length ? (length - replacementCount - controlCount) / length : 0;
  const failReasons = [];
  if (length < 3) failReasons.push("too-short");
  if (length > 1200) failReasons.push("too-long");
  if (printableRatio < .96) failReasons.push("low-printable-ratio");
  if (replacementCount > 0) failReasons.push("replacement-char");
  if (controlCount > 0) failReasons.push("control-char");
  if (!(slashCount >= 1 && slashCount <= 40 && slashFields >= 2 && slashFields <= 50)) {
    failReasons.push("slash-schema-mismatch");
  }
  const parser = parserSchemaRecognition(text);
  return {
    pass: failReasons.length === 0,
    parserSchemaRecognized: parser.recognized,
    parserSchemaClass: parser.parserSchemaClass,
    payloadLength: length,
    printableRatio: Number(printableRatio.toFixed(4)),
    structuralFailReason: failReasons.length ? failReasons.join("+") : "none",
  };
}

function decodeIntegrityValidation(canonical) {
  const text = canonicalText(canonical);
  const chars = [...text];
  const length = chars.length;
  const replacementCount = (text.match(/�/g) || []).length;
  const controlCount = chars.filter((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 && ch !== "\n" && ch !== "\t";
  }).length;
  const printableRatio = length ? (length - replacementCount - controlCount) / length : 0;
  const failReasons = [];
  if (length < 3) failReasons.push("too-short");
  if (length > 1200) failReasons.push("too-long");
  if (printableRatio < .96) failReasons.push("low-printable-ratio");
  if (replacementCount > 0) failReasons.push("replacement-char");
  if (controlCount > 0) failReasons.push("control-char");
  return {
    pass: failReasons.length === 0,
    payloadLength: length,
    printableRatio: Number(printableRatio.toFixed(4)),
    replacementCount,
    controlCount,
    failReason: failReasons.length ? failReasons.join("+") : "none",
  };
}

function nonPiiFingerprint(text) {
  let hash = 2166136261;
  const classes = [...canonicalText(text)].map((ch) => {
    if (/[0-9]/.test(ch)) return "D";
    if (/[A-Z]/.test(ch)) return "U";
    if (/[a-z]/.test(ch)) return "L";
    if (ch === "/") return "/";
    if (ch === " ") return "W";
    return "O";
  });
  for (const ch of classes.join("")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `live-${hash.toString(16).padStart(8, "0")}`;
}

function qrBounds(code, width, height) {
  const loc = code?.location;
  if (!loc) return null;
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].filter(Boolean);
  if (!pts.length) return null;
  const xs = pts.map((p) => Number(p.x));
  const ys = pts.map((p) => Number(p.y));
  const pad = Math.max(12, Math.round(Math.min(width, height) * .018));
  return {
    left: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    top: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    right: Math.min(width, Math.ceil(Math.max(...xs) + pad)),
    bottom: Math.min(height, Math.ceil(Math.max(...ys) + pad)),
  };
}

function frameQuality(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const w = image.width;
  const h = image.height;
  const step = Math.max(1, Math.floor(Math.max(w, h) / 360));
  let n = 0;
  let sum = 0;
  let sq = 0;
  let min = 255;
  let max = 0;
  let edgeSum = 0;
  let edgeN = 0;
  let lapSum = 0;
  let lapSq = 0;
  let lapN = 0;
  let dark = 0;
  let bright = 0;
  const grayAt = (x, y) => {
    const p = (y * w + x) * 4;
    return image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08;
  };
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const g = grayAt(x, y);
      n += 1;
      sum += g;
      sq += g * g;
      min = Math.min(min, g);
      max = Math.max(max, g);
      if (g <= 18) dark += 1;
      if (g >= 242) bright += 1;
      const gx = Math.abs(grayAt(x + step, y) - grayAt(x - step, y));
      const gy = Math.abs(grayAt(x, y + step) - grayAt(x, y - step));
      edgeSum += (gx + gy) / 2;
      edgeN += 1;
      const lap =
        grayAt(x - step, y) + grayAt(x + step, y) +
        grayAt(x, y - step) + grayAt(x, y + step) - 4 * g;
      lapSum += lap;
      lapSq += lap * lap;
      lapN += 1;
    }
  }
  const mean = n ? sum / n : 0;
  const variance = n ? Math.max(0, sq / n - mean * mean) : 0;
  const lapMean = lapN ? lapSum / lapN : 0;
  const lapVariance = lapN ? Math.max(0, lapSq / lapN - lapMean * lapMean) : 0;
  const out = {
    lumaMean: Number(mean.toFixed(2)),
    lumaStdDev: Number(Math.sqrt(variance).toFixed(2)),
    contrastRange: Number((max - min).toFixed(2)),
    edgeStrength: Number((edgeSum / Math.max(1, edgeN)).toFixed(2)),
    laplacianVariance: Number(lapVariance.toFixed(2)),
    darkClipRatio: Number((dark / Math.max(1, n)).toFixed(4)),
    brightClipRatio: Number((bright / Math.max(1, n)).toFixed(4)),
  };
  let label = "good";
  if (out.lumaMean < 65) label = "dark";
  else if (out.lumaMean > 220 || out.brightClipRatio > .34) label = "bright";
  else if (out.edgeStrength < 7 || out.laplacianVariance < 180) label = "soft";
  return { ...out, label };
}

function decodeJsMulti(jsQR, sourceCanvas, maxHits = 6) {
  const work = document.createElement("canvas");
  work.width = sourceCanvas.width;
  work.height = sourceCanvas.height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  const hits = [];
  try {
    for (let attempt = 0; attempt < maxHits; attempt += 1) {
      const image = ctx.getImageData(0, 0, work.width, work.height);
      const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      if (!result) break;
      const bytes = Array.from(result.binaryData || []);
      const canonical = canonicalDecode(result.data || "", bytes);
      const bounds = qrBounds(result, work.width, work.height);
      const localPosition = bounds ? {
        nx: Number((((bounds.left + bounds.right) / 2) / work.width).toFixed(4)),
        ny: Number((((bounds.top + bounds.bottom) / 2) / work.height).toFixed(4)),
      } : null;
      if (canonical) hits.push({ canonical, engine: "jsqr", localPosition });
      if (!bounds) break;
      ctx.fillStyle = "#fff";
      ctx.fillRect(
        bounds.left,
        bounds.top,
        Math.max(1, bounds.right - bounds.left),
        Math.max(1, bounds.bottom - bounds.top)
      );
    }
  } finally {
    work.width = 1;
    work.height = 1;
  }
  return hits;
}

async function makeReader() {
  const browser = await import("@zxing/browser");
  const lib = await import("@zxing/library");
  const hints = new Map();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  return new browser.BrowserQRCodeReader(hints);
}

function zxingLocalPosition(result, canvas) {
  const rawPoints = result?.getResultPoints?.() || result?.resultPoints || [];
  const points = Array.from(rawPoints || []).map((point) => ({
    x: Number(point?.getX?.() ?? point?.x),
    y: Number(point?.getY?.() ?? point?.y),
  })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length || !canvas?.width || !canvas?.height) return null;
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return {
    nx: Number((x / canvas.width).toFixed(4)),
    ny: Number((y / canvas.height).toFixed(4)),
  };
}

async function decodeZxing(reader, canvas) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const bytes = Array.from(result?.getRawBytes?.() || result?.rawBytes || []);
    const text = result?.getText?.() || result?.text || "";
    const canonical = canonicalDecode(text, bytes);
    return canonical ? [{ canonical, engine: "zxing", localPosition: zxingLocalPosition(result, canvas) }] : [];
  } catch {
    return [];
  }
}

function rawDiagnosticMetrics(text, bytes = []) {
  const decoded = canonicalDecode(text || "", bytes);
  const chars = [...decoded];
  const length = chars.length;
  const slashCount = (decoded.match(/\//g) || []).length;
  const slashFieldCount = decoded.split("/").filter(Boolean).length;
  const replacementCount = (decoded.match(/�/g) || []).length;
  const controlCount = chars.filter((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 && ch !== "\n" && ch !== "\t";
  }).length;
  const printableRatio = length ? (length - replacementCount - controlCount) / length : 0;
  const parser = parserSchemaRecognition(decoded);
  const structural = structuralValidation(decoded);
  const decodeIntegrity = decodeIntegrityValidation(decoded);
  return {
    decoded,
    rawByteLength: Array.from(bytes || []).length,
    decodedTextLength: length,
    slashCount,
    slashFieldCount,
    printableRatio: Number(printableRatio.toFixed(4)),
    replacementCount,
    controlCount,
    parserSchemaRecognized: parser.recognized,
    parserSchemaClass: parser.parserSchemaClass,
    decodeIntegrityPass: decodeIntegrity.pass,
    decodeIntegrityFailReason: decodeIntegrity.failReason,
    structuralPass: structural.pass,
    structuralFailReason: structural.structuralFailReason,
  };
}

function diagnosticDecodeJsRaw(jsQR, sourceCanvas) {
  try {
    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!result) return [];
    const bytes = Array.from(result.binaryData || []);
    const metrics = rawDiagnosticMetrics(result.data || "", bytes);
    const bounds = qrBounds(result, sourceCanvas.width, sourceCanvas.height);
    const localPosition = bounds ? {
      nx: Number((((bounds.left + bounds.right) / 2) / sourceCanvas.width).toFixed(4)),
      ny: Number((((bounds.top + bounds.bottom) / 2) / sourceCanvas.height).toFixed(4)),
    } : null;
    return [{ engine: "jsqr", localPosition, ...metrics }];
  } catch {
    return [];
  }
}

async function diagnosticDecodeZxingRaw(reader, canvas) {
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const bytes = Array.from(result?.getRawBytes?.() || result?.rawBytes || []);
    const text = result?.getText?.() || result?.text || "";
    return [{
      engine: "zxing",
      localPosition: zxingLocalPosition(result, canvas),
      ...rawDiagnosticMetrics(text, bytes),
    }];
  } catch {
    return [];
  }
}

function spatialCluster2d(points = [], threshold = COUNTING_DIAGNOSTIC_SPATIAL_CLUSTER_DISTANCE) {
  const clusters = [];
  for (const point of points.filter((item) => Number.isFinite(item?.x) && Number.isFinite(item?.y))) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = Math.hypot(point.x - cluster.x, point.y - cluster.y);
      if (distance <= threshold && distance < nearestDistance) {
        nearest = cluster;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      clusters.push({ x: point.x, y: point.y, count: 1 });
    } else {
      const weight = nearest.count;
      nearest.x = (nearest.x * weight + point.x) / (weight + 1);
      nearest.y = (nearest.y * weight + point.y) / (weight + 1);
      nearest.count += 1;
    }
  }
  return clusters;
}

function maxPairDistance(points = []) {
  let max = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      max = Math.max(max, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return Number(max.toFixed(4));
}

function createCountingIntegrityState() {
  return {
    rawDecodeCount: 0,
    rawCandidates: new Map(),
    diagnosticIdByDecoded: new Map(),
    diagnosticSeq: 0,
    preDedupeCanonicalHits: [],
    sameCanonicalSpatialEvents: [],
    maxPhysicalQrCandidateCount: 0,
    locatorRunCountObserved: 0,
  };
}

function countingDiagnosticId(state, decoded) {
  const key = String(decoded || "");
  if (!state.diagnosticIdByDecoded.has(key)) {
    state.diagnosticSeq += 1;
    state.diagnosticIdByDecoded.set(key, `raw-${String(state.diagnosticSeq).padStart(2, "0")}`);
  }
  return state.diagnosticIdByDecoded.get(key);
}

function recordRawDiagnosticHits(state, frameId, subRoiId, roi, hits = [], source = "normal") {
  for (const hit of hits) {
    const diagnosticId = countingDiagnosticId(state, hit.decoded);
    state.rawDecodeCount += 1;
    let candidate = state.rawCandidates.get(diagnosticId);
    if (!candidate) {
      candidate = {
        diagnosticId,
        firstSeenFrame: frameId,
        lastSeenFrame: frameId,
        frameIds: new Set(),
        jsqrFrames: new Set(),
        zxingFrames: new Set(),
        bothEngineFrames: new Set(),
        enginesByFrame: new Map(),
        normalFrames: new Set(),
        rescueFrames: new Set(),
        normalJsqrFrames: new Set(),
        normalZxingFrames: new Set(),
        rescueZxingFrames: new Set(),
        locatorTrackMatches: [],
        hitTimeline: [],
        positions: [],
        rawByteLengths: [],
        decodedTextLengths: [],
        slashCounts: [],
        slashFieldCounts: [],
        printableRatios: [],
        replacementCounts: [],
        controlCounts: [],
        parserSchemaClasses: new Set(),
        parserSchemaRecognized: Boolean(hit.parserSchemaRecognized),
        decodeIntegrityPass: Boolean(hit.decodeIntegrityPass),
        decodeIntegrityFailReasons: new Map(),
        structuralPass: Boolean(hit.structuralPass),
        structuralFailReasons: new Map(),
      };
      state.rawCandidates.set(diagnosticId, candidate);
    }
    candidate.lastSeenFrame = frameId;
    candidate.frameIds.add(frameId);
    if (source === "rescue") {
      candidate.rescueFrames.add(frameId);
      if (hit.engine === "zxing") candidate.rescueZxingFrames.add(frameId);
    } else {
      candidate.normalFrames.add(frameId);
      if (hit.engine === "jsqr") candidate.normalJsqrFrames.add(frameId);
      if (hit.engine === "zxing") candidate.normalZxingFrames.add(frameId);
    }
    if (hit.engine === "jsqr") candidate.jsqrFrames.add(frameId);
    if (hit.engine === "zxing") candidate.zxingFrames.add(frameId);
    if (!candidate.enginesByFrame.has(frameId)) candidate.enginesByFrame.set(frameId, new Set());
    candidate.enginesByFrame.get(frameId).add(hit.engine);
    if (candidate.enginesByFrame.get(frameId).has("jsqr") && candidate.enginesByFrame.get(frameId).has("zxing")) {
      candidate.bothEngineFrames.add(frameId);
    }
    if (source !== "rescue" && Number.isFinite(hit.rawByteLength)) {
      candidate.rawByteLengths.push(hit.rawByteLength);
    }
    candidate.decodedTextLengths.push(hit.decodedTextLength);
    candidate.slashCounts.push(hit.slashCount);
    candidate.slashFieldCounts.push(hit.slashFieldCount);
    candidate.printableRatios.push(hit.printableRatio);
    candidate.replacementCounts.push(hit.replacementCount);
    candidate.controlCounts.push(hit.controlCount);
    candidate.parserSchemaClasses.add(hit.parserSchemaClass);
    candidate.parserSchemaRecognized = candidate.parserSchemaRecognized || Boolean(hit.parserSchemaRecognized);
    candidate.decodeIntegrityPass = candidate.decodeIntegrityPass || Boolean(hit.decodeIntegrityPass);
    candidate.decodeIntegrityFailReasons.set(
      hit.decodeIntegrityFailReason,
      Number(candidate.decodeIntegrityFailReasons.get(hit.decodeIntegrityFailReason) || 0) + 1
    );
    candidate.structuralPass = candidate.structuralPass || Boolean(hit.structuralPass);
    candidate.structuralFailReasons.set(
      hit.structuralFailReason,
      Number(candidate.structuralFailReasons.get(hit.structuralFailReason) || 0) + 1
    );
    if (!Array.isArray(candidate.hitTimeline)) candidate.hitTimeline = [];
    candidate.hitTimeline.push({
      frameId,
      source,
      engine: hit.engine || "unknown",
      decodeIntegrityPass: Boolean(hit.decodeIntegrityPass),
      decodeIntegrityFailReason: hit.decodeIntegrityFailReason || null,
      parserSchemaClass: hit.parserSchemaClass || null,
      parserSchemaRecognized: Boolean(hit.parserSchemaRecognized),
      structuralPass: Boolean(hit.structuralPass),
      structuralFailReason: hit.structuralFailReason || null,
      subRoiId,
    });
    if (candidate.hitTimeline.length > 800) candidate.hitTimeline = candidate.hitTimeline.slice(-800);
    const position = guidePositionFromHit(hit, roi);
    if (position) candidate.positions.push({
      frameId,
      x: position.nx,
      y: position.ny,
      engine: hit.engine,
      subRoiId,
    });
  }
}

function recordPreDedupeCanonicalHits(state, frameId, hits = []) {
  const byCanonical = new Map();
  for (const hit of hits) {
    if (!hit.canonical || !hit.guidePosition) continue;
    if (!byCanonical.has(hit.canonical)) byCanonical.set(hit.canonical, []);
    byCanonical.get(hit.canonical).push(hit);
  }
  for (const [canonical, items] of byCanonical.entries()) {
    const diagnosticId = countingDiagnosticId(state, canonical);
    const points = items.map((item) => ({
      x: Number(item.guidePosition.nx),
      y: Number(item.guidePosition.ny),
      engine: item.engine,
      subRoiId: item.subRoiId,
    }));
    const clusters = spatialCluster2d(points);
    state.preDedupeCanonicalHits.push({
      diagnosticId,
      frameId,
      sameFrameHitCount: items.length,
      sameFrameSpatialClusterCount: clusters.length,
      maxHitDistance: maxPairDistance(points),
      hits: points,
    });
    if (clusters.length >= 2) {
      state.sameCanonicalSpatialEvents.push({
        diagnosticId,
        frameId,
        window: "same-frame",
        spatialClusterCount: clusters.length,
        maxHitDistance: maxPairDistance(points),
      });
    }

    const recent = state.preDedupeCanonicalHits.filter((row) =>
      row.diagnosticId === diagnosticId &&
      frameId - row.frameId <= COUNTING_DIAGNOSTIC_SHORT_WINDOW_FRAMES
    );
    const recentPoints = recent.flatMap((row) => row.hits.map((point) => ({
      x: point.x, y: point.y,
    })));
    const recentClusters = spatialCluster2d(recentPoints);
    if (recentClusters.length >= 2 && maxPairDistance(recentPoints) >= .18) {
      const duplicate = state.sameCanonicalSpatialEvents.some((event) =>
        event.diagnosticId === diagnosticId &&
        event.frameId === frameId &&
        event.window === "short-window"
      );
      if (!duplicate) {
        state.sameCanonicalSpatialEvents.push({
          diagnosticId,
          frameId,
          window: "short-window",
          spatialClusterCount: recentClusters.length,
          maxHitDistance: maxPairDistance(recentPoints),
        });
      }
    }
  }
  if (state.preDedupeCanonicalHits.length > 600) {
    state.preDedupeCanonicalHits = state.preDedupeCanonicalHits.slice(-600);
  }
  if (state.sameCanonicalSpatialEvents.length > 160) {
    state.sameCanonicalSpatialEvents = state.sameCanonicalSpatialEvents.slice(-160);
  }
}

function countingIntegritySnapshot(state, evidenceMap, physicalLocatorUi) {
  const rawCandidates = [...state.rawCandidates.values()].map((candidate) => {
    const positions = candidate.positions || [];
    const clusters = spatialCluster2d(positions.map((position) => ({ x: position.x, y: position.y })));
    const schemaClasses = [...candidate.parserSchemaClasses];
    const failHistogram = Object.fromEntries([...candidate.structuralFailReasons.entries()]);
    const canonicalEntry = [...evidenceMap.values()].find((entry) =>
      entry.diagnosticId && countingDiagnosticId(state, entry.canonical) === candidate.diagnosticId
    );
    return {
      diagnosticId: candidate.diagnosticId,
      firstSeenFrame: candidate.firstSeenFrame,
      lastSeenFrame: candidate.lastSeenFrame,
      frameHitCount: candidate.frameIds.size,
      jsqrFrameCount: candidate.jsqrFrames.size,
      zxingFrameCount: candidate.zxingFrames.size,
      bothEngineFrameCount: candidate.bothEngineFrames?.size || 0,
      normalFrameCount: candidate.normalFrames?.size || 0,
      rescueFrameCount: candidate.rescueFrames?.size || 0,
      normalJsqrFrameCount: candidate.normalJsqrFrames?.size || 0,
      normalZxingFrameCount: candidate.normalZxingFrames?.size || 0,
      rescueZxingFrameCount: candidate.rescueZxingFrames?.size || 0,
      candidateSource: candidate.rescueFrames?.size
        ? (candidate.normalFrames?.size ? "both" : "rescue")
        : "normal",
      rawByteLengthMedian: medianNumber(candidate.rawByteLengths),
      decodedTextLengthMedian: medianNumber(candidate.decodedTextLengths),
      slashCountMedian: medianNumber(candidate.slashCounts),
      slashFieldCountMedian: medianNumber(candidate.slashFieldCounts),
      printableRatioMedian: medianNumber(candidate.printableRatios),
      replacementCountMax: candidate.replacementCounts.length ? Math.max(...candidate.replacementCounts) : 0,
      controlCountMax: candidate.controlCounts.length ? Math.max(...candidate.controlCounts) : 0,
      parserSchemaRecognized: Boolean(candidate.parserSchemaRecognized),
      parserSchemaClasses: schemaClasses,
      decodeIntegrityPass: Boolean(candidate.decodeIntegrityPass),
      decodeIntegrityFailReasonHistogram: Object.fromEntries([...candidate.decodeIntegrityFailReasons.entries()]),
      structuralPass: candidate.structuralPass,
      structuralFailReasonHistogram: failHistogram,
      positionClusterCount: clusters.length,
      positionClusters: clusters.map((cluster) => ({
        x: Number(cluster.x.toFixed(4)),
        y: Number(cluster.y.toFixed(4)),
        hitCount: cluster.count,
      })),
      confirmedInEvidence: Boolean(canonicalEntry?.confirmed),
      confirmedFalseReason: canonicalEntry?.confirmed
        ? "none"
        : candidate.structuralPass
          ? "structural-pass-but-not-confirmed"
          : "structural-fail",
    };
  }).sort((a, b) => a.firstSeenFrame - b.firstSeenFrame);

  const failReasonHistogram = {};
  for (const candidate of rawCandidates) {
    if (candidate.structuralPass) continue;
    for (const [reason, count] of Object.entries(candidate.structuralFailReasonHistogram)) {
      failReasonHistogram[reason] = Number(failReasonHistogram[reason] || 0) + Number(count || 0);
    }
  }

  const unconfirmedStructural = [...evidenceMap.values()]
    .filter((entry) => !entry.confirmed)
    .map((entry) => {
      const positions = entry.guidePositions || [];
      const clusters = spatialCluster2d(positions.map((position) => ({
        x: Number(position.nx), y: Number(position.ny),
      })));
      return {
        diagnosticId: entry.diagnosticId,
        firstSeenFrame: entry.firstSeenFrame,
        lastSeenFrame: entry.lastSeenFrame,
        frameHitCount: entry.frameIds.size,
        jsqrFrameCount: entry.jsqrFrames.size,
        zxingFrameCount: entry.zxingFrames.size,
        payloadLength: entry.payloadLength,
        parserSchemaClass: entry.parserSchemaClass,
        positionClusterCount: clusters.length,
        positionClusters: clusters.map((cluster) => ({
          x: Number(cluster.x.toFixed(4)),
          y: Number(cluster.y.toFixed(4)),
          hitCount: cluster.count,
        })),
        confirmed: false,
        confirmedFalseReason: entry.frameIds.size < 2 && entry.bothEngineFrames.size === 0
          ? "single-frame-no-both-engine"
          : "confirmation-not-met",
      };
    });

  const oneOffPatternMap = new Map();
  for (const entry of unconfirmedStructural.filter((item) => item.frameHitCount === 1)) {
    const position = entry.positionClusters[0] || null;
    const xCell = position ? Math.round(position.x / .15) : -1;
    const yCell = position ? Math.round(position.y / .18) : -1;
    const key = `${entry.parserSchemaClass}|${entry.payloadLength}|${xCell}|${yCell}`;
    if (!oneOffPatternMap.has(key)) {
      oneOffPatternMap.set(key, {
        parserSchemaClass: entry.parserSchemaClass,
        payloadLength: entry.payloadLength,
        xCell,
        yCell,
        candidateIds: [],
      });
    }
    oneOffPatternMap.get(key).candidateIds.push(entry.diagnosticId);
  }

  const physicalCurrentCount = (physicalLocatorUi?.tracks || []).filter((track) =>
    track.confidence !== "low" &&
    physicalLocatorUi.lastFrame != null &&
    track.lastSeenFrame === physicalLocatorUi.lastFrame
  ).length;
  state.maxPhysicalQrCandidateCount = Math.max(state.maxPhysicalQrCandidateCount, physicalCurrentCount);
  if (physicalLocatorUi?.lastFrame != null) state.locatorRunCountObserved = Math.max(
    state.locatorRunCountObserved,
    Number(physicalLocatorUi.runs || 0)
  );

  return {
    schema: COUNTING_INTEGRITY_SCHEMA,
    diagnosticOnly: true,
    evaluationOverheadPresent: true,
    previewEvaluationOnly: true,
    timingComparableToBaseline: false,
    normalDecodeControlChanged: false,
    dedupeChanged: false,
    completionRuleChanged: false,
    rescueChanged: false,
    payloadIncluded: false,
    rawDecodeCount: state.rawDecodeCount,
    rawUniqueDiagnosticCandidateCount: rawCandidates.length,
    structuralPassUniqueCount: rawCandidates.filter((item) => item.structuralPass).length,
    structuralFailUniqueCount: rawCandidates.filter((item) => !item.structuralPass).length,
    failReasonHistogram,
    rawCandidates,
    unconfirmedStructuralPassCandidates: unconfirmedStructural,
    oneOffPatternGroups: [...oneOffPatternMap.values()]
      .filter((group) => group.candidateIds.length >= 2)
      .map((group) => ({ ...group, candidateCount: group.candidateIds.length })),
    sameCanonicalMultiplePhysicalPositionEvents: state.sameCanonicalSpatialEvents,
    duplicatePayloadPhysicalQrCandidateDetected: state.sameCanonicalSpatialEvents.some((event) =>
      event.spatialClusterCount >= 2 && event.maxHitDistance >= .18
    ),
    physicalQrCandidateCount: physicalCurrentCount,
    maxSimultaneousPhysicalQrCandidateCount: state.maxPhysicalQrCandidateCount,
    distinctCanonicalCount: evidenceMap.size,
    confirmedCanonicalCount: [...evidenceMap.values()].filter((entry) => entry.confirmed).length,
  };
}

function parserSeparationCounterfactualSnapshot(state, evidenceMap) {
  const currentCompletion = completionFromEvidenceMap(evidenceMap);
  const candidates = [...state.rawCandidates.values()].map((candidate) => {
    const positions = candidate.positions || [];
    const clusters = spatialCluster2d(positions.map((position) => ({ x: position.x, y: position.y })));
    const schemaClasses = [...candidate.parserSchemaClasses];
    const parserSchemaClass = schemaClasses.includes("kei-slash")
      ? "kei-slash"
      : schemaClasses.includes("registered-slash")
        ? "registered-slash"
        : "unrecognized-safe";
    const recognizedSchema = parserSchemaClass === "kei-slash" || parserSchemaClass === "registered-slash";
    const repeatedFrameSupport = candidate.frameIds.size >= 2;
    const bothEngineSameFrameSupport = (candidate.bothEngineFrames?.size || 0) > 0;
    const genericConfirmationPass =
      Boolean(candidate.decodeIntegrityPass) &&
      (repeatedFrameSupport || bothEngineSameFrameSupport);
    const sortedFrames = [...candidate.frameIds].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const secondDistinctFrame = sortedFrames.length >= 2 ? sortedFrames[1] : null;
    const earliestBothEngineFrame = candidate.bothEngineFrames?.size
      ? Math.min(...[...candidate.bothEngineFrames].map(Number).filter(Number.isFinite))
      : null;
    const genericConfirmationFrame = genericConfirmationPass
      ? [secondDistinctFrame, earliestBothEngineFrame].filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null
      : null;
    return {
      diagnosticId: candidate.diagnosticId,
      firstSeenFrame: candidate.firstSeenFrame,
      lastSeenFrame: candidate.lastSeenFrame,
      frameHitCount: candidate.frameIds.size,
      jsqrFrameCount: candidate.jsqrFrames.size,
      zxingFrameCount: candidate.zxingFrames.size,
      bothEngineFrameCount: candidate.bothEngineFrames?.size || 0,
      normalFrameCount: candidate.normalFrames?.size || 0,
      rescueFrameCount: candidate.rescueFrames?.size || 0,
      normalJsqrFrameCount: candidate.normalJsqrFrames?.size || 0,
      normalZxingFrameCount: candidate.normalZxingFrames?.size || 0,
      rescueZxingFrameCount: candidate.rescueZxingFrames?.size || 0,
      candidateSource: candidate.rescueFrames?.size
        ? (candidate.normalFrames?.size ? "both" : "rescue")
        : "normal",
      payloadLength: medianNumber(candidate.decodedTextLengths),
      rawByteLengthMedian: medianNumber(candidate.rawByteLengths),
      decodeIntegrityPass: Boolean(candidate.decodeIntegrityPass),
      decodeIntegrityFailReasonHistogram: Object.fromEntries([...candidate.decodeIntegrityFailReasons.entries()]),
      parserSchemaRecognized: recognizedSchema,
      parserSchemaClass,
      genericConfirmationPass,
      genericConfirmationFrame,
      confirmationSupport: {
        repeatedFrameSupport,
        bothEngineSameFrameSupport,
      },
      positionClusterCount: clusters.length,
      positionClusters: clusters.map((cluster) => ({
        x: Number(cluster.x.toFixed(4)),
        y: Number(cluster.y.toFixed(4)),
        hitCount: cluster.count,
      })),
    };
  }).sort((a, b) => a.firstSeenFrame - b.firstSeenFrame);

  const decodeIntegritySafe = candidates.filter((candidate) => candidate.decodeIntegrityPass);
  const recognizedSchema = decodeIntegritySafe.filter((candidate) => candidate.parserSchemaRecognized);
  const unrecognizedSafe = decodeIntegritySafe.filter((candidate) =>
    !candidate.parserSchemaRecognized && candidate.genericConfirmationPass
  );
  const separatedConfirmed = decodeIntegritySafe.filter((candidate) => candidate.genericConfirmationPass);
  const separatedConfirmedIds = new Set(separatedConfirmed.map((candidate) => candidate.diagnosticId));
  const decodeIntegritySafeIds = new Set(decodeIntegritySafe.map((candidate) => candidate.diagnosticId));
  const currentConfirmedEntries = [...evidenceMap.values()].filter((entry) => entry.confirmed);
  const currentConfirmedMissingFromSeparated = [];
  const currentConfirmedMissingFromDecodeIntegritySafe = [];
  for (const entry of currentConfirmedEntries) {
    const rawDiagnosticId = state.diagnosticIdByDecoded.get(entry.canonical) || null;
    if (!rawDiagnosticId || !decodeIntegritySafeIds.has(rawDiagnosticId)) {
      currentConfirmedMissingFromDecodeIntegritySafe.push(entry.diagnosticId);
    }
    if (!rawDiagnosticId || !separatedConfirmedIds.has(rawDiagnosticId)) {
      currentConfirmedMissingFromSeparated.push(entry.diagnosticId);
    }
  }
  const normalOnlyCandidateCount = candidates.filter((candidate) => candidate.candidateSource === "normal").length;
  const rescueInvolvedCandidateCount = candidates.filter((candidate) =>
    candidate.candidateSource === "rescue" || candidate.candidateSource === "both"
  ).length;
  const accountingIntegrityPass =
    currentConfirmedMissingFromDecodeIntegritySafe.length === 0 &&
    currentConfirmedMissingFromSeparated.length === 0;
  const expected = currentCompletion.expected;
  const separatedComplete = expected != null && separatedConfirmed.length >= expected;
  const confirmationFrames = separatedConfirmed
    .map((candidate) => candidate.genericConfirmationFrame)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const frameAtFinalConfirmed = confirmationFrames.length
    ? confirmationFrames[confirmationFrames.length - 1]
    : null;
  const frameAtPenultimateConfirmed = confirmationFrames.length >= 2
    ? confirmationFrames[confirmationFrames.length - 2]
    : null;
  const finalQrWaitFrames =
    Number.isFinite(frameAtFinalConfirmed) && Number.isFinite(frameAtPenultimateConfirmed)
      ? Math.max(0, frameAtFinalConfirmed - frameAtPenultimateConfirmed)
      : null;

  return {
    schema: PARSER_SEPARATION_SCHEMA,
    diagnosticOnly: true,
    evaluationVariant: "CURRENT-vs-PARSER_SEPARATED",
    timingComparableToBaseline: false,
    gtUsedInRuntimeOrControl: false,
    currentLogicChanged: false,
    currentStructuralValidationChanged: false,
    currentEvidenceChanged: false,
    currentCompletionChanged: false,
    rescueChanged: false,
    locatorChanged: false,
    payloadIncluded: false,
    layer1DecodeIntegrity: {
      required: [
        "length-3-to-1200",
        "printable-ratio-at-least-0.96",
        "replacement-char-none",
        "control-char-none",
      ],
      slashSchemaRequired: false,
    },
    layer2ParserSchema: {
      recognizedClasses: ["kei-slash", "registered-slash"],
      unknownClass: "unrecognized-safe",
      kindFromUnrecognizedSafe: false,
    },
    strictUnrecognizedSafeConfirmation: {
      repeatedSameCanonicalFramesAtLeast: 2,
      orSameFrameBothEngines: true,
    },
    rawUniqueCount: candidates.length,
    decodeIntegritySafeUniqueCount: decodeIntegritySafe.length,
    recognizedSchemaUniqueCount: recognizedSchema.length,
    unrecognizedSafeUniqueCount: unrecognizedSafe.length,
    normalOnlyCandidateCount,
    rescueInvolvedCandidateCount,
    currentConfirmedCount: currentCompletion.confirmedCount,
    separatedConfirmedCount: separatedConfirmed.length,
    currentConfirmedMissingFromDecodeIntegritySafeCount: currentConfirmedMissingFromDecodeIntegritySafe.length,
    currentConfirmedMissingFromDecodeIntegritySafeDiagnosticIds: currentConfirmedMissingFromDecodeIntegritySafe,
    currentConfirmedMissingFromSeparatedCount: currentConfirmedMissingFromSeparated.length,
    currentConfirmedMissingFromSeparatedDiagnosticIds: currentConfirmedMissingFromSeparated,
    accountingIntegrityPass,
    acquisitionLatencyDiagnostic: {
      confirmationBasis: "strict-generic-confirmation-frame",
      frameAtPenultimateConfirmed,
      frameAtFinalConfirmed,
      finalQrWaitFrames,
      confirmationFrames,
      diagnosticOnly: true,
    },
    diagnosticAccountingSources: {
      normalSubRoiIncluded: true,
      remainingOneRescueIncluded: true,
      rescueDecoderAccountedAs: "zxing",
      exactCanonicalKeySharedAcrossSources: true,
    },
    currentCompletion: {
      variant: "CURRENT",
      kind: currentCompletion.kind,
      expectedQrCount: currentCompletion.expected,
      complete: currentCompletion.complete,
    },
    separatedCompletion: {
      variant: "PARSER_SEPARATED",
      kind: currentCompletion.kind,
      kindSource: "recognized-schema-current-evidence-only",
      expectedQrCount: expected,
      confirmedEvidenceTotal: separatedConfirmed.length,
      complete: separatedComplete,
    },
    unrecognizedSafeCandidates: unrecognizedSafe.map((candidate) => ({
      diagnosticId: candidate.diagnosticId,
      firstSeenFrame: candidate.firstSeenFrame,
      lastSeenFrame: candidate.lastSeenFrame,
      frameHitCount: candidate.frameHitCount,
      jsqrFrameCount: candidate.jsqrFrameCount,
      zxingFrameCount: candidate.zxingFrameCount,
      bothEngineFrameCount: candidate.bothEngineFrameCount,
      normalFrameCount: candidate.normalFrameCount,
      rescueFrameCount: candidate.rescueFrameCount,
      normalJsqrFrameCount: candidate.normalJsqrFrameCount,
      normalZxingFrameCount: candidate.normalZxingFrameCount,
      rescueZxingFrameCount: candidate.rescueZxingFrameCount,
      candidateSource: candidate.candidateSource,
      payloadLength: candidate.payloadLength,
      rawByteLengthMedian: candidate.rawByteLengthMedian,
      parserSchemaClass: candidate.parserSchemaClass,
      decodeIntegrityPass: candidate.decodeIntegrityPass,
      confirmationSupport: candidate.confirmationSupport,
      positionClusterCount: candidate.positionClusterCount,
      positionClusters: candidate.positionClusters,
    })),
    allCandidateDiagnostics: candidates,
  };
}

function unknownSafeStrictSnapshot(state, evidenceMap) {
  const separated = parserSeparationCounterfactualSnapshot(state, evidenceMap);
  const allCandidates = Array.isArray(separated?.allCandidateDiagnostics)
    ? separated.allCandidateDiagnostics
    : [];
  const recognizedConfirmedCount = allCandidates.filter((candidate) =>
    candidate.genericConfirmationPass && candidate.parserSchemaRecognized
  ).length;
  const currentConfirmedCount = Number(separated?.currentConfirmedCount || 0);
  const kind = separated?.currentCompletion?.kind || null;
  const expectedQrCount = Number.isInteger(separated?.currentCompletion?.expectedQrCount)
    ? separated.currentCompletion.expectedQrCount
    : null;
  const candidates = allCandidates
    .filter((candidate) => !candidate.parserSchemaRecognized)
    .map((candidate) => ({
      diagnosticId: candidate.diagnosticId,
      parserSchemaRecognized: false,
      parserSchemaClass: candidate.parserSchemaClass || "unrecognized-safe",
      decodeIntegrityPass: Boolean(candidate.decodeIntegrityPass),
      frameHitCount: Number(candidate.frameHitCount || 0),
      bothEngineFrameCount: Number(candidate.bothEngineFrameCount || 0),
      positionClusterCount: Number(candidate.positionClusterCount || 0),
    }));
  const result = evaluateUnknownSafeCompletion({
    kind,
    expectedQrCount,
    currentConfirmedCount,
    recognizedConfirmedCount,
    candidates,
  });
  const rejectReasonCounts = {};
  for (const candidate of result.candidateResults || []) {
    for (const reason of candidate.rejectReasons || []) {
      rejectReasonCounts[reason] = Number(rejectReasonCounts[reason] || 0) + 1;
    }
  }
  return {
    ...result,
    evaluationVariant: "UNKNOWN_SAFE_STRICT",
    source: "same-live-run-parser-separated-evidence",
    rejectReasonCounts,
    cameraStopSemanticsChanged: false,
    currentSemanticsChanged: false,
    parserSeparatedSemanticsChanged: false,
  };
}

function buildPhysicalSlotUi(state, physicalLocatorUi, expectedQrCount, separated) {
  const expected = Number.isInteger(expectedQrCount) ? expectedQrCount : null;
  const currentTracks = (physicalLocatorUi?.tracks || [])
    .filter((track) =>
      track.confidence !== "low" &&
      physicalLocatorUi.lastFrame != null &&
      track.lastSeenFrame === physicalLocatorUi.lastFrame
    );

  const confirmedCandidates = (separated?.allCandidateDiagnostics || [])
    .filter((candidate) => candidate.genericConfirmationPass);
  const rawById = state?.rawCandidates || new Map();

  const associations = confirmedCandidates.map((candidate) => {
    const raw = rawById.get(candidate.diagnosticId) || null;
    const positions = Array.isArray(raw?.positions) ? raw.positions : [];
    const frameIds = new Set(positions.map((position) => position.frameId));
    const recent = positions.slice(-24);
    const recentX = recent.map((position) => Number(position.x)).filter(Number.isFinite);
    const recentY = recent.map((position) => Number(position.y)).filter(Number.isFinite);
    const x = recentX.length ? medianNumber(recentX) : null;
    const y = recentY.length ? medianNumber(recentY) : null;

    const byFrame = new Map();
    for (const position of positions) {
      if (!byFrame.has(position.frameId)) byFrame.set(position.frameId, []);
      byFrame.get(position.frameId).push({ x: position.x, y: position.y });
    }
    let sameFrameSpatialConflict = false;
    for (const points of byFrame.values()) {
      if (points.length < 2) continue;
      if (spatialCluster2d(points).length >= 2 && maxPairDistance(points) >= .18) {
        sameFrameSpatialConflict = true;
        break;
      }
    }

    const locatorTrackMatches = Array.isArray(raw?.locatorTrackMatches) ? raw.locatorTrackMatches : [];
    const locatorMatchFrames = new Set(locatorTrackMatches.map((match) => match.frameId));
    const temporalContinuityPass = frameIds.size >= 2 || locatorMatchFrames.size >= 2;
    const hasPositionEvidence = Number.isFinite(x) && Number.isFinite(y);
    const stableBase =
      hasPositionEvidence &&
      temporalContinuityPass &&
      !sameFrameSpatialConflict;
    const positionPoints = positions
      .map((position) => ({ x: Number(position.x), y: Number(position.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    const sessionPositionSpan = positionPoints.length >= 2 ? maxPairDistance(positionPoints) : 0;
    const insufficientPositionSupport =
      !hasPositionEvidence ||
      (!temporalContinuityPass && !sameFrameSpatialConflict);

    return {
      diagnosticId: candidate.diagnosticId,
      stableBase,
      sameFrameSpatialConflict,
      nearbyCanonicalConflict: false,
      locatorTrackMultiDiagnosticConflict: false,
      temporalCameraMotionFalseConflict: false,
      insufficientPositionSupport,
      finalConflict: false,
      conflictCategories: [],
      x,
      y,
      sessionPositionSpan,
      firstSeenFrame: candidate.firstSeenFrame,
      lastSeenFrame: candidate.lastSeenFrame,
      positionFrameCount: frameIds.size,
      locatorTrackCount: new Set(locatorTrackMatches.map((match) => match.trackId)).size,
      locatorMatchFrameCount: locatorMatchFrames.size,
    };
  });

  const conflictIds = new Set();
  const nearbyConflictIds = new Set();
  const locatorMultiDiagnosticConflictIds = new Set();
  const nearbyPairDiagnostics = [];

  for (const association of associations) {
    if (association.sameFrameSpatialConflict) conflictIds.add(association.diagnosticId);
  }

  const prelimStable = associations.filter((association) => association.stableBase);
  for (let i = 0; i < prelimStable.length; i += 1) {
    for (let j = i + 1; j < prelimStable.length; j += 1) {
      const a = prelimStable[i], b = prelimStable[j];
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance <= .045) {
        const rawA = rawById.get(a.diagnosticId) || null;
        const rawB = rawById.get(b.diagnosticId) || null;
        const positionsA = Array.isArray(rawA?.positions) ? rawA.positions : [];
        const positionsB = Array.isArray(rawB?.positions) ? rawB.positions : [];
        const byFrameA = new Map();
        const byFrameB = new Map();
        for (const position of positionsA) {
          if (!byFrameA.has(position.frameId)) byFrameA.set(position.frameId, []);
          byFrameA.get(position.frameId).push(position);
        }
        for (const position of positionsB) {
          if (!byFrameB.has(position.frameId)) byFrameB.set(position.frameId, []);
          byFrameB.get(position.frameId).push(position);
        }
        const sharedFrames = [...byFrameA.keys()]
          .filter((frameId) => byFrameB.has(frameId))
          .map(Number)
          .filter(Number.isFinite)
          .sort((x, y) => x - y);
        const sameFrameSamples = sharedFrames.map((frameId) => {
          const ax = medianNumber(byFrameA.get(frameId).map((item) => Number(item.x)).filter(Number.isFinite));
          const ay = medianNumber(byFrameA.get(frameId).map((item) => Number(item.y)).filter(Number.isFinite));
          const bx = medianNumber(byFrameB.get(frameId).map((item) => Number(item.x)).filter(Number.isFinite));
          const by = medianNumber(byFrameB.get(frameId).map((item) => Number(item.y)).filter(Number.isFinite));
          const sampleDistance = [ax, ay, bx, by].every(Number.isFinite)
            ? Math.hypot(ax - bx, ay - by)
            : null;
          return {
            frameId,
            distance: Number.isFinite(sampleDistance) ? Number(sampleDistance.toFixed(4)) : null,
          };
        }).filter((item) => Number.isFinite(item.distance));
        const sameFrameDistances = sameFrameSamples.map((item) => item.distance);
        const sameFrameNearbyCount = sameFrameDistances.filter((value) => value <= .045).length;
        const overlapStart = Math.max(Number(a.firstSeenFrame || 0), Number(b.firstSeenFrame || 0));
        const overlapEnd = Math.min(Number(a.lastSeenFrame || 0), Number(b.lastSeenFrame || 0));
        const temporalOverlapFrameCount = overlapEnd >= overlapStart
          ? overlapEnd - overlapStart + 1
          : 0;
        const nearestDistances = positionsA.map((pa) => {
          let nearest = Infinity;
          for (const pb of positionsB) {
            const d = Math.hypot(Number(pa.x) - Number(pb.x), Number(pa.y) - Number(pb.y));
            if (Number.isFinite(d)) nearest = Math.min(nearest, d);
          }
          return nearest;
        }).filter(Number.isFinite);
        const bSubtype = sameFrameNearbyCount > 0
          ? "B1_SIMULTANEOUS_NEARBY"
          : distance <= .045
            ? "B2_TEMPORAL_MEDIAN_ONLY_NEARBY"
            : "B3_OTHER_NEARBY";
        nearbyPairDiagnostics.push({
          diagnosticIdA: a.diagnosticId,
          diagnosticIdB: b.diagnosticId,
          medianPairDistance: Number(distance.toFixed(4)),
          bSubtype,
          sameFrameCoexistenceCount: sharedFrames.length,
          sameFrameNearbyCount,
          sameFrameMinimumDistance: sameFrameDistances.length
            ? Number(Math.min(...sameFrameDistances).toFixed(4))
            : null,
          sameFrameMedianDistance: sameFrameDistances.length
            ? Number(medianNumber(sameFrameDistances).toFixed(4))
            : null,
          temporalOverlapFrameCount,
          firstSeenFrameA: a.firstSeenFrame,
          lastSeenFrameA: a.lastSeenFrame,
          firstSeenFrameB: b.firstSeenFrame,
          lastSeenFrameB: b.lastSeenFrame,
          positionSampleCountA: positionsA.length,
          positionSampleCountB: positionsB.length,
          trajectoryNearestDistanceMedian: nearestDistances.length
            ? Number(medianNumber(nearestDistances).toFixed(4))
            : null,
          pairwisePositionSamples: sameFrameSamples.slice(0, 8),
          medianOnlyNearby: sameFrameNearbyCount === 0,
          actualSimultaneousNearby: sameFrameNearbyCount > 0,
        });
        nearbyConflictIds.add(a.diagnosticId);
        nearbyConflictIds.add(b.diagnosticId);
        conflictIds.add(a.diagnosticId);
        conflictIds.add(b.diagnosticId);
      }
    }
  }

  for (const track of physicalLocatorUi?.tracks || []) {
    const history = Array.isArray(track.matchHistory) ? track.matchHistory : [];
    for (let i = 0; i < history.length; i += 1) {
      for (let j = i + 1; j < history.length; j += 1) {
        if (history[i].diagnosticId === history[j].diagnosticId) continue;
        if (Math.abs(Number(history[i].frameId) - Number(history[j].frameId)) <= 4) {
          locatorMultiDiagnosticConflictIds.add(history[i].diagnosticId);
          locatorMultiDiagnosticConflictIds.add(history[j].diagnosticId);
          conflictIds.add(history[i].diagnosticId);
          conflictIds.add(history[j].diagnosticId);
        }
      }
    }
  }

  for (const association of associations) {
    association.nearbyCanonicalConflict = nearbyConflictIds.has(association.diagnosticId);
    association.locatorTrackMultiDiagnosticConflict =
      locatorMultiDiagnosticConflictIds.has(association.diagnosticId);
    association.finalConflict = conflictIds.has(association.diagnosticId);

    const likelyTemporalMotion =
      association.finalConflict &&
      !association.sameFrameSpatialConflict &&
      (association.nearbyCanonicalConflict || association.locatorTrackMultiDiagnosticConflict) &&
      association.positionFrameCount >= 2 &&
      association.sessionPositionSpan >= .06;
    association.temporalCameraMotionFalseConflict = likelyTemporalMotion;

    const categories = [];
    if (association.sameFrameSpatialConflict) categories.push("A_SAME_FRAME_SPATIAL_CONFLICT");
    if (association.nearbyCanonicalConflict) categories.push("B_NEARBY_CANONICAL_CLUSTER_CONFLICT");
    if (association.locatorTrackMultiDiagnosticConflict) categories.push("C_LOCATOR_TRACK_MULTI_DIAGNOSTIC_CONFLICT");
    if (association.temporalCameraMotionFalseConflict) categories.push("D_TEMPORAL_CAMERA_MOTION_FALSE_CONFLICT");
    if (association.insufficientPositionSupport) categories.push("E_INSUFFICIENT_POSITION_SUPPORT");
    if (!categories.length && (!association.stableBase || association.finalConflict)) categories.push("F_OTHER");
    association.conflictCategories = categories;

    const dExemptionEligible =
      association.temporalCameraMotionFalseConflict &&
      !association.sameFrameSpatialConflict &&
      association.stableBase &&
      !association.insufficientPositionSupport;
    association.v2FinalConflict = association.finalConflict;
    association.rescuedByDExemption = Boolean(association.v2FinalConflict && dExemptionEligible);
    association.v3FinalConflict =
      association.v2FinalConflict && !association.rescuedByDExemption;
  }

  const stableAssociations = associations
    .filter((association) => association.stableBase && !conflictIds.has(association.diagnosticId))
    .sort((a, b) => (a.x ?? 999) - (b.x ?? 999) || (a.y ?? 999) - (b.y ?? 999));
  const unstableConfirmed = associations
    .filter((association) => !association.stableBase || conflictIds.has(association.diagnosticId));

  const sameCanonicalMultiplePhysicalPositionCandidate =
    associations.some((association) => association.sameFrameSpatialConflict);
  const multipleCanonicalSamePhysicalSlotCandidate =
    conflictIds.size > 0 &&
    !sameCanonicalMultiplePhysicalPositionCandidate;
  const duplicateIdentityWarning = conflictIds.size > 0;

  const confirmedCanonicalCount = confirmedCandidates.length;
  const canonicalWithStablePhysicalAssociationCount = stableAssociations.length;
  const canonicalWithoutStablePhysicalAssociationCount =
    Math.max(0, confirmedCanonicalCount - canonicalWithStablePhysicalAssociationCount);
  const sessionPersistedSlotCount = associations.filter((association) =>
    association.positionFrameCount > 0 || association.locatorMatchFrameCount > 0
  ).length;
  const unreadCount = expected == null ? 0 : Math.max(0, expected - confirmedCanonicalCount);
  const uncertainCount = canonicalWithoutStablePhysicalAssociationCount;
  const identityStable =
    expected != null &&
    confirmedCanonicalCount === expected &&
    stableAssociations.length === expected &&
    unreadCount === 0 &&
    uncertainCount === 0 &&
    !duplicateIdentityWarning;

  const slots = stableAssociations.map((association, index) => ({
    diagnosticId: association.diagnosticId,
    displayOrdinal: identityStable ? index + 1 : null,
    positionLabel: guide2DLabel(association.x, association.y),
    status: "読取済",
    confidence: "session-stable",
    x: Number(association.x.toFixed(4)),
    y: Number(association.y.toFixed(4)),
    firstSeenFrame: association.firstSeenFrame,
    lastSeenFrame: association.lastSeenFrame,
  }));

  for (const association of unstableConfirmed) {
    slots.push({
      diagnosticId: association.diagnosticId,
      displayOrdinal: null,
      positionLabel: "位置不確定",
      status: "位置不確定",
      confidence: "uncertain",
      x: Number.isFinite(association.x) ? Number(association.x.toFixed(4)) : null,
      y: Number.isFinite(association.y) ? Number(association.y.toFixed(4)) : null,
      firstSeenFrame: association.firstSeenFrame,
      lastSeenFrame: association.lastSeenFrame,
    });
  }

  const associatedIds = new Set(stableAssociations.map((association) => association.diagnosticId));
  const unreadTracks = currentTracks
    .filter((track) => {
      const id = track.lastMatchedDiagnosticId || track.matchedDiagnosticId || null;
      return !id || !associatedIds.has(id);
    })
    .sort((a, b) => b.confidenceScore - a.confidenceScore);

  for (let i = 0; i < unreadCount; i += 1) {
    const track = unreadTracks[i] || null;
    slots.push({
      diagnosticId: null,
      displayOrdinal: null,
      positionLabel: track ? guide2DLabel(track.x, track.y) : "位置不確定",
      status: "未読",
      confidence: track?.confidence || "unknown",
      x: track ? track.x : null,
      y: track ? track.y : null,
      firstSeenFrame: track?.firstSeenFrame ?? null,
      lastSeenFrame: track?.lastSeenFrame ?? null,
    });
  }

  const v3StableAssociations = associations
    .filter((association) => association.stableBase && !association.v3FinalConflict);
  const v3RemainingConflictCount = associations.filter((association) => association.v3FinalConflict).length;
  const v3RescuedByTemporalMotionExemptionCount =
    associations.filter((association) => association.rescuedByDExemption).length;
  const v3UncertainCount =
    Math.max(0, confirmedCanonicalCount - v3StableAssociations.length);

  const conflictCategoryCounts = {
    A_SAME_FRAME_SPATIAL_CONFLICT: associations.filter((item) => item.sameFrameSpatialConflict).length,
    B_NEARBY_CANONICAL_CLUSTER_CONFLICT: associations.filter((item) => item.nearbyCanonicalConflict).length,
    C_LOCATOR_TRACK_MULTI_DIAGNOSTIC_CONFLICT: associations.filter((item) => item.locatorTrackMultiDiagnosticConflict).length,
    D_TEMPORAL_CAMERA_MOTION_FALSE_CONFLICT: associations.filter((item) => item.temporalCameraMotionFalseConflict).length,
    E_INSUFFICIENT_POSITION_SUPPORT: associations.filter((item) => item.insufficientPositionSupport).length,
    F_OTHER: associations.filter((item) => item.conflictCategories.includes("F_OTHER")).length,
  };
  const conflictDiagnostics = associations.map((association) => ({
    diagnosticId: association.diagnosticId,
    stableBase: association.stableBase,
    positionFrameCount: association.positionFrameCount,
    locatorMatchFrameCount: association.locatorMatchFrameCount,
    medianX: Number.isFinite(association.x) ? Number(association.x.toFixed(4)) : null,
    medianY: Number.isFinite(association.y) ? Number(association.y.toFixed(4)) : null,
    sessionPositionSpan: Number.isFinite(association.sessionPositionSpan)
      ? Number(association.sessionPositionSpan.toFixed(4))
      : null,
    sameFrameSpatialConflict: association.sameFrameSpatialConflict,
    nearbyCanonicalConflict: association.nearbyCanonicalConflict,
    locatorTrackMultiDiagnosticConflict: association.locatorTrackMultiDiagnosticConflict,
    temporalCameraMotionFalseConflict: association.temporalCameraMotionFalseConflict,
    insufficientPositionSupport: association.insufficientPositionSupport,
    finalConflict: association.finalConflict,
    v2FinalConflict: association.v2FinalConflict,
    dFlag: association.temporalCameraMotionFalseConflict,
    v3FinalConflict: association.v3FinalConflict,
    rescuedByDExemption: association.rescuedByDExemption,
    conflictCategories: association.conflictCategories,
  }));

  return {
    slotCount: expected ?? confirmedCanonicalCount,
    physicalSlotDisplayCount: stableAssociations.length,
    readCount: stableAssociations.length,
    unreadCount,
    uncertainCount,
    identityStable,
    canonicalWithStablePhysicalAssociationCount,
    canonicalWithoutStablePhysicalAssociationCount,
    stablePhysicalSlotCount: stableAssociations.length,
    sessionPersistedSlotCount,
    currentFrameTrackCount: currentTracks.length,
    associationConflictCount: conflictIds.size,
    conflictCategoryCounts,
    conflictDiagnostics,
    nearbyConflictPairDiagnostics: nearbyPairDiagnostics,
    nearbyConflictSubtypeCounts: {
      B1_SIMULTANEOUS_NEARBY: nearbyPairDiagnostics.filter((item) => item.bSubtype === "B1_SIMULTANEOUS_NEARBY").length,
      B2_TEMPORAL_MEDIAN_ONLY_NEARBY: nearbyPairDiagnostics.filter((item) => item.bSubtype === "B2_TEMPORAL_MEDIAN_ONLY_NEARBY").length,
      B3_OTHER_NEARBY: nearbyPairDiagnostics.filter((item) => item.bSubtype === "B3_OTHER_NEARBY").length,
    },
    trackADiagnosticOnly: true,
    nearbyThresholdChanged: false,
    associationVariants: {
      V2_CURRENT_CONFLICT: {
        stablePhysicalSlotCount: stableAssociations.length,
        associationConflictCount: conflictIds.size,
        uncertainCount,
      },
      V3_D_EXEMPT_COUNTERFACTUAL: {
        stablePhysicalSlotCount: v3StableAssociations.length,
        remainingConflictCount: v3RemainingConflictCount,
        uncertainCount: v3UncertainCount,
        rescuedByTemporalMotionExemptionCount: v3RescuedByTemporalMotionExemptionCount,
        sameFrameConflictAlwaysHard: true,
        insufficientSupportNeverRescued: true,
        displayOnlyCounterfactual: true,
        currentV2UiChanged: false,
      },
    },
    conflictDecompositionDiagnosticOnly: true,
    conflictThresholdsChanged: false,
    finalConflictRuleChanged: false,
    sameCanonicalMultiplePhysicalPositionCandidate,
    multipleCanonicalSamePhysicalSlotCandidate,
    duplicateIdentityWarning,
    slots,
  };
}

function productionShapeCandidateSnapshot(state, evidenceMap, physicalLocatorUi, cameraStopSource = "none") {
  const separated = parserSeparationCounterfactualSnapshot(state, evidenceMap);
  const counting = countingIntegritySnapshot(state, evidenceMap, physicalLocatorUi);
  const recognizedKinds = new Set(
    [...evidenceMap.values()]
      .filter((entry) => entry.confirmed)
      .map((entry) => entry.parserSchemaClass)
      .filter((schema) => schema === "kei-slash" || schema === "registered-slash")
  );
  const kindAmbiguous = recognizedKinds.has("kei-slash") && recognizedKinds.has("registered-slash");
  const kind = kindAmbiguous
    ? "ambiguous"
    : recognizedKinds.has("kei-slash")
      ? "kei"
      : recognizedKinds.has("registered-slash")
        ? "registered"
        : "unknown";
  const expectedQrCount = kind === "kei" ? 6 : kind === "registered" ? 5 : null;
  const confirmedCanonicalCount = Number(separated.separatedConfirmedCount || 0);
  const accountingIntegrityPass = Boolean(separated.accountingIntegrityPass);
  const overCount = expectedQrCount != null && confirmedCanonicalCount > expectedQrCount;

  let qrAcquisitionState = "insufficient";
  if (!accountingIntegrityPass) qrAcquisitionState = "accounting-integrity-fail";
  else if (kindAmbiguous) qrAcquisitionState = "kind-ambiguous";
  else if (overCount) qrAcquisitionState = "over-count-review";
  else if (expectedQrCount != null && confirmedCanonicalCount === expectedQrCount) qrAcquisitionState = "matched";

  const qrAcquisitionComplete = qrAcquisitionState === "matched";

  const separatedCandidates = Array.isArray(separated.allCandidateDiagnostics)
    ? separated.allCandidateDiagnostics
    : [];
  const confirmedRecognizedCount = separatedCandidates.filter((candidate) =>
    candidate.genericConfirmationPass && candidate.parserSchemaRecognized
  ).length;
  const confirmedUnrecognizedSafeCount = separatedCandidates.filter((candidate) =>
    candidate.genericConfirmationPass && !candidate.parserSchemaRecognized
  ).length;
  const completionEvidencePartitionIntegrityPass =
    confirmedRecognizedCount + confirmedUnrecognizedSafeCount === confirmedCanonicalCount;

  const productionShapeStopConditionPass =
    qrAcquisitionState === "matched" &&
    kind !== "unknown" &&
    kind !== "ambiguous" &&
    expectedQrCount != null &&
    confirmedCanonicalCount === expectedQrCount &&
    accountingIntegrityPass &&
    completionEvidencePartitionIntegrityPass &&
    !overCount &&
    !kindAmbiguous;
  const proposedStopCandidate = productionShapeStopConditionPass;

  const recognizedCount = confirmedRecognizedCount;
  const unrecognizedSafeCount = confirmedUnrecognizedSafeCount;
  const interpretedPayloadCount = confirmedRecognizedCount;
  const payloadInterpretationComplete =
    qrAcquisitionComplete &&
    confirmedUnrecognizedSafeCount === 0 &&
    interpretedPayloadCount === confirmedCanonicalCount;

  const vehicleFieldState = {
    state: "partial",
    complete: false,
    fieldCompletenessEvaluated: false,
    missingFieldCount: null,
    reason: "live-eval-has-no-formal-required-field-extraction-map",
    futureEvidenceShape: {
      source: ["live-qr-recognized", "photo-qr-recognized", "ocr"],
      schemaClass: true,
      confidenceOrProvenance: true,
    },
  };

  const physicalSlotUi = buildPhysicalSlotUi(
    state,
    physicalLocatorUi,
    expectedQrCount,
    separated
  );

  return {
    qrAcquisitionState,
    qrAcquisitionComplete,
    payloadInterpretationComplete,
    vehicleFieldsComplete: vehicleFieldState.complete,
    confirmedCanonicalCount,
    physicalSlotDisplayCount: physicalSlotUi.physicalSlotDisplayCount,
    sameCanonicalMultiplePhysicalPositionCandidate: physicalSlotUi.sameCanonicalMultiplePhysicalPositionCandidate,
    multipleCanonicalSamePhysicalSlotCandidate: physicalSlotUi.multipleCanonicalSamePhysicalSlotCandidate,
    kind,
    kindSource: "recognized-schema-confirmed-current-evidence-only",
    expectedQrCount,
    accountingIntegrityPass,
    overCount,
    proposedStopCandidate,
    productionShapeStopConditionPass,
    cameraStopSource,
    confirmedRecognizedCount,
    confirmedUnrecognizedSafeCount,
    completionEvidencePartitionIntegrityPass,
    payloadInterpretationState: {
      state: payloadInterpretationComplete ? "complete" : "partial",
      complete: payloadInterpretationComplete,
      recognizedCount,
      unrecognizedSafeCount,
      interpretedPayloadCount,
      confirmedRecognizedCount,
      confirmedUnrecognizedSafeCount,
      completionEvidencePartitionIntegrityPass,
      unknownSafeUsedForKindOrExpected: false,
      unknownSafeUsedForFieldInference: false,
    },
    vehicleFieldState,
    fallbackState: {
      photoQrFallbackCandidate: qrAcquisitionState === "insufficient",
      photoQrReviewCandidate:
        qrAcquisitionState === "over-count-review" ||
        qrAcquisitionState === "kind-ambiguous" ||
        qrAcquisitionState === "accounting-integrity-fail",
      ocrMissingFieldsFallbackCandidate:
        qrAcquisitionComplete && !vehicleFieldState.complete,
      photoUnionImplemented: false,
      ocrFallbackImplemented: false,
    },
    physicalSlotUi,
    controlConnections: {
      currentCameraStopChanged: false,
      locatorUsedForCompletion: false,
      locatorUsedForExpected: false,
      locatorUsedForKind: false,
      locatorUsedForRescueControl: false,
      proposedStopCandidateObservationOnly: false,
      evaluationBranchProductionShapeStopEnabled: true,
      currentCompletionFunctionChanged: false,
    },
  };
}

function compactFrameList(values, maxItems = 24) {
  const frames = [...new Set((values || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  return {
    count: frames.length,
    frames: frames.length <= maxItems
      ? frames
      : [...frames.slice(0, Math.floor(maxItems / 2)), ...frames.slice(-Math.ceil(maxItems / 2))],
    truncated: frames.length > maxItems,
  };
}

function pointToNormalizedRoiDistance(x, y, roi) {
  if (![x, y, roi?.x, roi?.y, roi?.w, roi?.h].every(Number.isFinite)) return null;
  const left = roi.x;
  const right = roi.x + roi.w;
  const top = roi.y;
  const bottom = roi.y + roi.h;
  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return Math.hypot(dx, dy);
}

function normalizedRoiContainsPoint(roi, x, y) {
  return Boolean(
    roi &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(roi.x) &&
    Number.isFinite(roi.y) &&
    Number.isFinite(roi.w) &&
    Number.isFinite(roi.h) &&
    x >= roi.x &&
    x <= roi.x + roi.w &&
    y >= roi.y &&
    y <= roi.y + roi.h
  );
}

function nearestContainingSubRoi(x, y, preferredId = null) {
  const containing = SUB_ROIS.filter((roi) => normalizedRoiContainsPoint(roi, x, y));
  if (!containing.length) return null;
  const preferred = containing.find((roi) => roi.id === preferredId);
  if (preferred) return preferred;
  return containing
    .map((roi) => ({
      roi,
      distance: Math.hypot(
        x - (roi.x + roi.w / 2),
        y - (roi.y + roi.h / 2)
      ),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.roi || null;
}

function counterfactualAttemptCoverage(attempt, targetRoiId, candidateX, candidateY) {
  const target = SUB_ROIS.find((roi) => roi.id === targetRoiId) || null;
  const variant = LOCAL_RESCUE_VARIANTS.find((item) => item.id === attempt.variantId) || null;
  if (!target || !variant) {
    return {
      covered: false,
      distance: null,
      targetRoiId: targetRoiId || null,
      cropRoi: null,
    };
  }
  const cropRoi = rescueRoiFromVariant(target, variant);
  const distance = pointToNormalizedRoiDistance(candidateX, candidateY, cropRoi);
  return {
    covered: Number.isFinite(distance) ? distance === 0 : false,
    distance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : null,
    targetRoiId: target.id,
    cropRoi,
  };
}

function compressAttemptTargetTimeline(attempts = [], candidateX, candidateY) {
  const rows = [];
  let active = null;
  for (const attempt of attempts) {
    if (!active || active.targetRoiId !== attempt.targetRoiId) {
      active = {
        targetRoiId: attempt.targetRoiId || null,
        startFrame: Number(attempt.frameId),
        endFrame: Number(attempt.frameId),
        attemptCount: 0,
        coveredAttemptCount: 0,
        targetContainsCandidatePosition: normalizedRoiContainsPoint(
          SUB_ROIS.find((roi) => roi.id === attempt.targetRoiId) || null,
          candidateX,
          candidateY
        ),
      };
      rows.push(active);
    }
    active.endFrame = Number(attempt.frameId);
    active.attemptCount += 1;
    if (attempt.containsCandidatePosition === true) active.coveredAttemptCount += 1;
  }
  return rows;
}

function counterfactualCoverageSummary(
  attempts,
  candidateX,
  candidateY,
  targetResolver,
  lockStartFrame = null,
  lockEndFrame = null
) {
  const evaluated = attempts.map((attempt) => {
    const targetRoiId = targetResolver(attempt);
    const result = counterfactualAttemptCoverage(
      attempt,
      targetRoiId,
      candidateX,
      candidateY
    );
    return {
      frameId: Number(attempt.frameId),
      variantId: attempt.variantId,
      actualTargetRoiId: attempt.targetRoiId,
      counterfactualTargetRoiId: result.targetRoiId,
      covered: result.covered,
      distance: result.distance,
    };
  });
  const covered = evaluated.filter((item) => item.covered).length;
  const missed = evaluated.length - covered;
  const frameMap = new Map();
  for (const item of evaluated) {
    if (!frameMap.has(item.frameId)) frameMap.set(item.frameId, []);
    frameMap.get(item.frameId).push(item);
  }
  const outsideFrames = [...frameMap.entries()]
    .filter(([, items]) => items.length > 0 && items.every((item) => !item.covered))
    .map(([frameId]) => Number(frameId))
    .sort((a, b) => a - b);
  return {
    candidateLockStartFrame: lockStartFrame,
    candidateLockEndFrame: lockEndFrame,
    counterfactualCoveredAttemptCount: covered,
    counterfactualMissedAttemptCount: missed,
    counterfactualOutsideFrameCount: outsideFrames.length,
    outsideFrames: compactFrameList(outsideFrames, 24),
    targetUseCounts: Object.fromEntries(
      [...new Set(evaluated.map((item) => item.counterfactualTargetRoiId || "none"))]
        .map((targetId) => [
          targetId,
          evaluated.filter((item) => (item.counterfactualTargetRoiId || "none") === targetId).length,
        ])
    ),
    diagnosticOnly: true,
  };
}

function remainingOneLatencyDiagnostic(state, separated, rescueState) {
  const confirmed = (separated?.allCandidateDiagnostics || [])
    .filter((candidate) => candidate.genericConfirmationPass && Number.isFinite(candidate.genericConfirmationFrame))
    .sort((a, b) =>
      Number(a.genericConfirmationFrame) - Number(b.genericConfirmationFrame) ||
      Number(a.firstSeenFrame) - Number(b.firstSeenFrame)
    );
  const last = confirmed[confirmed.length - 1] || null;
  if (!last) {
    return {
      diagnosticOnly: true,
      lastConfirmedDiagnosticId: null,
      reason: "no-strict-confirmed-candidate",
    };
  }

  const raw = state?.rawCandidates?.get?.(last.diagnosticId) || null;
  const timeline = Array.isArray(raw?.hitTimeline) ? raw.hitTimeline : [];
  const confirmationFrame = Number(last.genericConfirmationFrame);
  const preConfirmation = timeline.filter((item) =>
    Number.isFinite(Number(item.frameId)) && Number(item.frameId) <= confirmationFrame
  );

  const firstDecodeIntegrityPassFrame = preConfirmation
    .filter((item) => item.decodeIntegrityPass)
    .map((item) => Number(item.frameId))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] ?? null;

  const firstRecognizedOrSafeFrame = preConfirmation
    .filter((item) =>
      item.decodeIntegrityPass &&
      ["kei-slash", "registered-slash", "unrecognized-safe"].includes(item.parserSchemaClass)
    )
    .map((item) => Number(item.frameId))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] ?? null;

  const decodeRejectHistogram = {};
  const structuralRejectHistogram = {};
  const combinedRejectHistogram = {};
  for (const item of preConfirmation) {
    if (!item.decodeIntegrityPass) {
      const reason = item.decodeIntegrityFailReason || "decode-integrity-unknown";
      decodeRejectHistogram[reason] = Number(decodeRejectHistogram[reason] || 0) + 1;
      const key = `decode-integrity:${reason}`;
      combinedRejectHistogram[key] = Number(combinedRejectHistogram[key] || 0) + 1;
    }
    if (!item.structuralPass) {
      const reason = item.structuralFailReason || "structural-unknown";
      structuralRejectHistogram[reason] = Number(structuralRejectHistogram[reason] || 0) + 1;
      const key = `current-structural:${reason}`;
      combinedRejectHistogram[key] = Number(combinedRejectHistogram[key] || 0) + 1;
    }
  }

  const positions = Array.isArray(raw?.positions) ? raw.positions : [];
  const px = positions.map((item) => Number(item.x)).filter(Number.isFinite);
  const py = positions.map((item) => Number(item.y)).filter(Number.isFinite);
  const medianX = px.length ? medianNumber(px) : null;
  const medianY = py.length ? medianNumber(py) : null;
  const guideRegion = Number.isFinite(medianX) && Number.isFinite(medianY)
    ? guide2DLabel(medianX, medianY)
    : null;
  const firstUnconfirmedSafeCandidateFrame = firstRecognizedOrSafeFrame;
  const firstSafePositions = positions.filter((item) =>
    Number(item.frameId) === Number(firstUnconfirmedSafeCandidateFrame)
  );
  const firstSafeXs = firstSafePositions.map((item) => Number(item.x)).filter(Number.isFinite);
  const firstSafeYs = firstSafePositions.map((item) => Number(item.y)).filter(Number.isFinite);
  const firstSafeX = firstSafeXs.length ? medianNumber(firstSafeXs) : medianX;
  const firstSafeY = firstSafeYs.length ? medianNumber(firstSafeYs) : medianY;
  const candidateGuidePositionAtFirstSeen = {
    x: Number.isFinite(firstSafeX) ? Number(firstSafeX.toFixed(4)) : null,
    y: Number.isFinite(firstSafeY) ? Number(firstSafeY.toFixed(4)) : null,
    region: Number.isFinite(firstSafeX) && Number.isFinite(firstSafeY)
      ? guide2DLabel(firstSafeX, firstSafeY)
      : null,
  };

  const normalFrames = compactFrameList([...(raw?.normalFrames || [])]);
  const rescueFrames = compactFrameList([...(raw?.rescueFrames || [])]);
  const jsqrFrames = compactFrameList([...(raw?.jsqrFrames || [])]);
  const zxingFrames = compactFrameList([...(raw?.zxingFrames || [])]);
  const bothEngineFrames = compactFrameList([...(raw?.bothEngineFrames || [])]);

  const firstSeenFrame = Number.isFinite(Number(last.firstSeenFrame)) ? Number(last.firstSeenFrame) : null;
  const rescueActivatedRaw = rescueState?.activatedFrame;
  const rescueActivatedFrame =
    rescueActivatedRaw == null
      ? null
      : Number.isFinite(Number(rescueActivatedRaw))
        ? Number(rescueActivatedRaw)
        : null;

  const rescueAttempts = Array.isArray(rescueState?.attemptLog) ? rescueState.attemptLog : [];
  const locatorTrackMatches = Array.isArray(raw?.locatorTrackMatches) ? raw.locatorTrackMatches : [];
  const locatorWidths = locatorTrackMatches.map((item) => Number(item.w)).filter(Number.isFinite);
  const locatorHeights = locatorTrackMatches.map((item) => Number(item.h)).filter(Number.isFinite);
  const locatorMedianW = locatorWidths.length ? medianNumber(locatorWidths) : null;
  const locatorMedianH = locatorHeights.length ? medianNumber(locatorHeights) : null;
  const candidateAttempts = rescueAttempts.map((attempt) => {
    const distance = pointToNormalizedRoiDistance(medianX, medianY, attempt.cropRoi);
    const containsCandidatePosition = Number.isFinite(distance) ? distance === 0 : null;
    const candidateHit = Array.isArray(attempt.hitDiagnosticIds) &&
      attempt.hitDiagnosticIds.includes(last.diagnosticId);
    const relativeX =
      Number.isFinite(medianX) && Number.isFinite(attempt.cropRoi?.x) && Number.isFinite(attempt.cropRoi?.w) && attempt.cropRoi.w > 0
        ? (medianX - attempt.cropRoi.x) / attempt.cropRoi.w
        : null;
    const relativeY =
      Number.isFinite(medianY) && Number.isFinite(attempt.cropRoi?.y) && Number.isFinite(attempt.cropRoi?.h) && attempt.cropRoi.h > 0
        ? (medianY - attempt.cropRoi.y) / attempt.cropRoi.h
        : null;
    const relativeWidth =
      Number.isFinite(locatorMedianW) && Number.isFinite(attempt.cropRoi?.w) && attempt.cropRoi.w > 0
        ? locatorMedianW / attempt.cropRoi.w
        : null;
    const relativeHeight =
      Number.isFinite(locatorMedianH) && Number.isFinite(attempt.cropRoi?.h) && attempt.cropRoi.h > 0
        ? locatorMedianH / attempt.cropRoi.h
        : null;
    return {
      attemptIndex: attempt.attemptIndex,
      frameId: attempt.frameId,
      targetRoiId: attempt.targetRoiId,
      variantId: attempt.variantId,
      subRoiId: attempt.subRoiId,
      engine: attempt.engine,
      guideRegion: attempt.guideRegion,
      cropRoi: attempt.cropRoi,
      cropPixelWidth: Number(attempt.cropPixelWidth || 0),
      cropPixelHeight: Number(attempt.cropPixelHeight || 0),
      upscaleScale: Number(attempt.upscaleScale || 1),
      grayscaleVariant: Boolean(attempt.grayscaleVariant),
      thresholdVariant: Boolean(attempt.thresholdVariant),
      quality: attempt.quality || null,
      zxingDecodeMs: Number.isFinite(Number(attempt.zxingDecodeMs)) ? Number(attempt.zxingDecodeMs) : null,
      candidateRelativePositionInCrop: {
        x: Number.isFinite(relativeX) ? Number(relativeX.toFixed(4)) : null,
        y: Number.isFinite(relativeY) ? Number(relativeY.toFixed(4)) : null,
      },
      candidateSizeRelativeToCropEstimate: {
        source: "physical-locator-track-size-estimate",
        width: Number.isFinite(relativeWidth) ? Number(relativeWidth.toFixed(4)) : null,
        height: Number.isFinite(relativeHeight) ? Number(relativeHeight.toFixed(4)) : null,
        available: Number.isFinite(relativeWidth) && Number.isFinite(relativeHeight),
      },
      containsCandidatePosition,
      candidatePositionToRoiDistance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : null,
      candidateHit,
      rawHitCount: Number(attempt.rawHitCount || 0),
    };
  });

  const attemptsContainingCandidate = candidateAttempts.filter((item) => item.containsCandidatePosition === true);
  const attemptsMissingCandidate = candidateAttempts.filter((item) => item.containsCandidatePosition === false);
  const candidateHitAttempts = candidateAttempts.filter((item) => item.candidateHit);
  const targetCounts = {};
  const variantCounts = {};
  const candidateHitsByVariant = {};
  for (const attempt of candidateAttempts) {
    targetCounts[attempt.targetRoiId || "unknown"] = Number(targetCounts[attempt.targetRoiId || "unknown"] || 0) + 1;
    variantCounts[attempt.variantId || "unknown"] = Number(variantCounts[attempt.variantId || "unknown"] || 0) + 1;
    if (attempt.candidateHit) {
      candidateHitsByVariant[attempt.variantId || "unknown"] =
        Number(candidateHitsByVariant[attempt.variantId || "unknown"] || 0) + 1;
    }
  }
  const targetCountValues = Object.values(targetCounts).map(Number).filter(Number.isFinite);
  const sameRegionRetryCount = Object.values(targetCounts)
    .map((count) => Math.max(0, Number(count || 0) - 1))
    .reduce((sum, count) => sum + count, 0);
  const candidateAttemptHitRate = candidateAttempts.length
    ? candidateHitAttempts.length / candidateAttempts.length
    : null;
  const candidateHitRateWhenCovered = attemptsContainingCandidate.length
    ? candidateHitAttempts.filter((item) => item.containsCandidatePosition === true).length /
      attemptsContainingCandidate.length
    : null;

  const attemptsAfterFirstSeen = candidateAttempts
    .filter((attempt) =>
      Number.isFinite(Number(firstUnconfirmedSafeCandidateFrame)) &&
      Number(attempt.frameId) >= Number(firstUnconfirmedSafeCandidateFrame)
    )
    .map((attempt) => {
      const firstSeenDistance = pointToNormalizedRoiDistance(
        firstSafeX,
        firstSafeY,
        attempt.cropRoi
      );
      return {
        ...attempt,
        sessionMedianContainsCandidatePosition: attempt.containsCandidatePosition,
        containsCandidatePosition: Number.isFinite(firstSeenDistance)
          ? firstSeenDistance === 0
          : null,
        candidatePositionToRoiDistance: Number.isFinite(firstSeenDistance)
          ? Number(firstSeenDistance.toFixed(4))
          : null,
        coverageReference: "candidate-guide-position-at-first-safe-seen",
      };
    });
  const actualTargetTimelineAfterFirstSeen = compressAttemptTargetTimeline(
    attemptsAfterFirstSeen,
    firstSafeX,
    firstSafeY
  );
  const actualCoveredAttemptsAfterFirstSeen = attemptsAfterFirstSeen
    .filter((attempt) => attempt.containsCandidatePosition === true).length;
  const actualMissedAttemptsAfterFirstSeen =
    attemptsAfterFirstSeen.length - actualCoveredAttemptsAfterFirstSeen;
  const actualFrameMapAfterFirstSeen = new Map();
  for (const attempt of attemptsAfterFirstSeen) {
    if (!actualFrameMapAfterFirstSeen.has(attempt.frameId)) actualFrameMapAfterFirstSeen.set(attempt.frameId, []);
    actualFrameMapAfterFirstSeen.get(attempt.frameId).push(attempt);
  }
  const actualOutsideFramesAfterFirstSeen = [...actualFrameMapAfterFirstSeen.entries()]
    .filter(([, items]) => items.length > 0 && items.every((item) => item.containsCandidatePosition !== true))
    .map(([frameId]) => Number(frameId))
    .sort((a, b) => a - b);

  let actualRetargetAwayCountAfterFirstSeen = 0;
  for (let i = 1; i < actualTargetTimelineAfterFirstSeen.length; i += 1) {
    const previous = actualTargetTimelineAfterFirstSeen[i - 1];
    const current = actualTargetTimelineAfterFirstSeen[i];
    if (
      previous.targetContainsCandidatePosition === true &&
      current.targetContainsCandidatePosition === false
    ) {
      actualRetargetAwayCountAfterFirstSeen += 1;
    }
  }

  const targetAtFirstSeenAttempt = attemptsAfterFirstSeen[0] || null;
  const targetAtFirstSeen = targetAtFirstSeenAttempt?.targetRoiId ||
    [...(rescueState?.targetHistory || [])]
      .filter((entry) => Number(entry.frameId) <= Number(firstUnconfirmedSafeCandidateFrame))
      .sort((a, b) => Number(b.frameId) - Number(a.frameId))[0]?.targetRoiId ||
    null;
  const targetAtFirstSeenRoi = SUB_ROIS.find((roi) => roi.id === targetAtFirstSeen) || null;
  const centerRoi = SUB_ROIS.find((roi) => roi.id === "center") || null;
  const candidateContainingFallback = nearestContainingSubRoi(firstSafeX, firstSafeY);
  const cf1LockedTargetRoi =
    normalizedRoiContainsPoint(targetAtFirstSeenRoi, firstSafeX, firstSafeY)
      ? targetAtFirstSeenRoi
      : normalizedRoiContainsPoint(centerRoi, firstSafeX, firstSafeY)
        ? centerRoi
        : candidateContainingFallback;
  const cf1LockedTarget = cf1LockedTargetRoi?.id || null;

  const cf0 = {
    candidateLockStartFrame: null,
    candidateLockEndFrame: null,
    counterfactualLockedTarget: null,
    counterfactualCoveredAttemptCount: actualCoveredAttemptsAfterFirstSeen,
    counterfactualMissedAttemptCount: actualMissedAttemptsAfterFirstSeen,
    counterfactualOutsideFrameCount: actualOutsideFramesAfterFirstSeen.length,
    outsideFrames: compactFrameList(actualOutsideFramesAfterFirstSeen, 24),
    targetUseCounts: Object.fromEntries(
      [...new Set(attemptsAfterFirstSeen.map((attempt) => attempt.targetRoiId || "none"))]
        .map((targetId) => [
          targetId,
          attemptsAfterFirstSeen.filter((attempt) => (attempt.targetRoiId || "none") === targetId).length,
        ])
    ),
    diagnosticOnly: true,
  };

  const cf1 = counterfactualCoverageSummary(
    attemptsAfterFirstSeen,
    firstSafeX,
    firstSafeY,
    () => cf1LockedTarget
  );
  cf1.counterfactualLockedTarget = cf1LockedTarget;

  const cf2 = counterfactualCoverageSummary(
    attemptsAfterFirstSeen,
    firstSafeX,
    firstSafeY,
    (attempt) => {
      const actual = SUB_ROIS.find((roi) => roi.id === attempt.targetRoiId) || null;
      if (normalizedRoiContainsPoint(actual, firstSafeX, firstSafeY)) return actual.id;
      return nearestContainingSubRoi(firstSafeX, firstSafeY, cf1LockedTarget)?.id || cf1LockedTarget;
    }
  );
  cf2.counterfactualLockedTarget = "containing-target-only";

  const cf3LockFrames = [6, 12, 18, 24];
  const cf3Sweep = cf3LockFrames.map((lockFrames) => {
    const lockStart = Number(firstUnconfirmedSafeCandidateFrame);
    const lockEnd = Number.isFinite(lockStart) ? lockStart + lockFrames - 1 : null;
    const summary = counterfactualCoverageSummary(
      attemptsAfterFirstSeen,
      firstSafeX,
      firstSafeY,
      (attempt) =>
        Number.isFinite(lockEnd) && Number(attempt.frameId) <= lockEnd
          ? cf1LockedTarget
          : attempt.targetRoiId,
      lockStart,
      lockEnd
    );
    return {
      lockFrames,
      counterfactualLockedTarget: cf1LockedTarget,
      ...summary,
    };
  });

  const applyAvoidance = (summary) => ({
    ...summary,
    avoidableMissedAttemptCount: Math.max(
      0,
      actualMissedAttemptsAfterFirstSeen - Number(summary.counterfactualMissedAttemptCount || 0)
    ),
    avoidableOutsideFrames: Math.max(
      0,
      actualOutsideFramesAfterFirstSeen.length - Number(summary.counterfactualOutsideFrameCount || 0)
    ),
  });

  const rescueOrRetargetActivity =
    candidateAttempts.length > 0 ||
    Number(rescueState?.retargetCount || 0) > 0;
  const postFirstSeenCoverageLoss =
    attemptsAfterFirstSeen.length > 0 &&
    (
      actualMissedAttemptsAfterFirstSeen > 0 ||
      actualOutsideFramesAfterFirstSeen.length > 0
    );
  const candidatePositionAvailable =
    Number.isFinite(firstSafeX) &&
    Number.isFinite(firstSafeY);
  const candidateLockCounterfactualEvaluable =
    rescueOrRetargetActivity &&
    postFirstSeenCoverageLoss &&
    candidatePositionAvailable;
  const candidateLockCounterfactualNotEvaluableReason =
    candidateLockCounterfactualEvaluable
      ? null
      : !rescueOrRetargetActivity
        ? "NO_RESCUE_OR_RETARGET_ACTIVITY"
        : !candidatePositionAvailable
          ? "NO_CANDIDATE_GUIDE_POSITION"
          : !postFirstSeenCoverageLoss
            ? "NO_POST_FIRST_SEEN_COVERAGE_LOSS"
            : "NOT_EVALUABLE";

  const candidateLockRetargetGuardCounterfactual = {
    diagnosticOnly: true,
    runtimeChanged: false,
    groundTruthUsed: false,
    payloadUsed: false,
    candidateLockCounterfactualEvaluable,
    candidateLockCounterfactualNotEvaluableReason,
    firstUnconfirmedSafeCandidateFrame,
    candidateGuidePositionAtFirstSeen,
    targetAtFirstSeen,
    actualTargetTimelineAfterFirstSeen,
    actualCoveredAttemptsAfterFirstSeen,
    actualMissedAttemptsAfterFirstSeen,
    actualRetargetAwayCountAfterFirstSeen,
    actualFramesSpentOutsideCandidateRegion: actualOutsideFramesAfterFirstSeen.length,
    actualOutsideFramesAfterFirstSeen: compactFrameList(actualOutsideFramesAfterFirstSeen, 24),
    candidateLockStartFrame: candidateLockCounterfactualEvaluable
      ? firstUnconfirmedSafeCandidateFrame
      : null,
    candidateLockEndFrame: candidateLockCounterfactualEvaluable
      ? confirmationFrame
      : null,
    confirmationFrame,
    CF0_CURRENT_SCHEDULED_RETARGET: candidateLockCounterfactualEvaluable
      ? applyAvoidance(cf0)
      : null,
    CF1_HOLD_FIRST_CONTAINING_TARGET: candidateLockCounterfactualEvaluable
      ? applyAvoidance(cf1)
      : null,
    CF2_CONTAINING_TARGETS_ONLY: candidateLockCounterfactualEvaluable
      ? applyAvoidance(cf2)
      : null,
    CF3_TEMPORARY_LOCK_SMALL_SWEEP: candidateLockCounterfactualEvaluable
      ? cf3Sweep.map(applyAvoidance)
      : null,
    cf3LockFrameSweep: cf3LockFrames,
    coverageReference: "candidate-guide-position-at-first-safe-seen",
    counterfactualCoverageOnly: true,
    decodeOutcomeCounterfactuallyInferred: false,
  };

  const variantEfficacy = Object.fromEntries(LOCAL_RESCUE_VARIANTS.map((variant) => {
    const rows = candidateAttempts.filter((attempt) => attempt.variantId === variant.id);
    const covered = rows.filter((attempt) => attempt.containsCandidatePosition === true);
    const hits = rows.filter((attempt) => attempt.candidateHit);
    const coveredHits = covered.filter((attempt) => attempt.candidateHit);
    const decodeTimes = rows.map((attempt) => attempt.zxingDecodeMs).filter(Number.isFinite);
    const cropWs = rows.map((attempt) => Number(attempt.cropRoi?.w)).filter(Number.isFinite);
    const cropHs = rows.map((attempt) => Number(attempt.cropRoi?.h)).filter(Number.isFinite);
    const cropPixelWs = rows.map((attempt) => attempt.cropPixelWidth).filter(Number.isFinite);
    const cropPixelHs = rows.map((attempt) => attempt.cropPixelHeight).filter(Number.isFinite);
    const relXs = covered.map((attempt) => attempt.candidateRelativePositionInCrop?.x).filter(Number.isFinite);
    const relYs = covered.map((attempt) => attempt.candidateRelativePositionInCrop?.y).filter(Number.isFinite);
    const relWs = covered.map((attempt) => attempt.candidateSizeRelativeToCropEstimate?.width).filter(Number.isFinite);
    const relHs = covered.map((attempt) => attempt.candidateSizeRelativeToCropEstimate?.height).filter(Number.isFinite);
    const edgeStrengths = rows.map((attempt) => Number(attempt.quality?.edgeStrength)).filter(Number.isFinite);
    const lapVars = rows.map((attempt) => Number(attempt.quality?.laplacianVariance)).filter(Number.isFinite);
    const contrastRanges = rows.map((attempt) => Number(attempt.quality?.contrastRange)).filter(Number.isFinite);
    const lumaStdDevs = rows.map((attempt) => Number(attempt.quality?.lumaStdDev)).filter(Number.isFinite);
    return [variant.id, {
      attemptCount: rows.length,
      candidateCoveredAttemptCount: covered.length,
      candidateHitCount: hits.length,
      candidateHitWhenCoveredCount: coveredHits.length,
      hitRateWhenCovered: covered.length ? Number((coveredHits.length / covered.length).toFixed(4)) : null,
      cropNormalizedWidthMedian: cropWs.length ? Number(medianNumber(cropWs).toFixed(4)) : null,
      cropNormalizedHeightMedian: cropHs.length ? Number(medianNumber(cropHs).toFixed(4)) : null,
      cropPixelWidthMedian: cropPixelWs.length ? Number(medianNumber(cropPixelWs).toFixed(1)) : null,
      cropPixelHeightMedian: cropPixelHs.length ? Number(medianNumber(cropPixelHs).toFixed(1)) : null,
      upscaleScale: Number(variant.scale || 1),
      candidateRelativePositionInCropMedian: {
        x: relXs.length ? Number(medianNumber(relXs).toFixed(4)) : null,
        y: relYs.length ? Number(medianNumber(relYs).toFixed(4)) : null,
      },
      candidateSizeRelativeToCropEstimateMedian: {
        source: "physical-locator-track-size-estimate",
        width: relWs.length ? Number(medianNumber(relWs).toFixed(4)) : null,
        height: relHs.length ? Number(medianNumber(relHs).toFixed(4)) : null,
        available: relWs.length > 0 && relHs.length > 0,
      },
      sharpnessProxyMedian: {
        edgeStrength: edgeStrengths.length ? Number(medianNumber(edgeStrengths).toFixed(2)) : null,
        laplacianVariance: lapVars.length ? Number(medianNumber(lapVars).toFixed(2)) : null,
      },
      contrastProxyMedian: {
        contrastRange: contrastRanges.length ? Number(medianNumber(contrastRanges).toFixed(2)) : null,
        lumaStdDev: lumaStdDevs.length ? Number(medianNumber(lumaStdDevs).toFixed(2)) : null,
      },
      grayscaleVariant: false,
      thresholdVariant: false,
      zxingDecodeMsMedian: decodeTimes.length ? Number(medianNumber(decodeTimes).toFixed(2)) : null,
      zxingDecodeMsMax: decodeTimes.length ? Number(Math.max(...decodeTimes).toFixed(2)) : null,
    }];
  }));

  const targetHistory = Array.isArray(rescueState?.targetHistory) ? rescueState.targetHistory : [];
  const targetSwitchDiagnostics = targetHistory.map((entry, index) => {
    const nextFrame = Number(targetHistory[index + 1]?.frameId);
    const targetAttempts = candidateAttempts.filter((attempt) =>
      attempt.targetRoiId === entry.targetRoiId &&
      Number(attempt.frameId) >= Number(entry.frameId) &&
      (!Number.isFinite(nextFrame) || Number(attempt.frameId) < nextFrame)
    );
    const firstAttempt = targetAttempts[0] || null;
    const coveredAttemptCount = targetAttempts.filter((attempt) => attempt.containsCandidatePosition === true).length;
    return {
      frameId: entry.frameId,
      nextTargetChangeFrame: Number.isFinite(nextFrame) ? nextFrame : null,
      targetRoiId: entry.targetRoiId,
      previousTargetRoiId: entry.previousTargetRoiId || null,
      reason: entry.reason,
      segmentAttemptCount: targetAttempts.length,
      segmentCoveredAttemptCount: coveredAttemptCount,
      firstAttemptContainsCandidatePosition: firstAttempt?.containsCandidatePosition ?? null,
      firstAttemptDistance: firstAttempt?.candidatePositionToRoiDistance ?? null,
    };
  });

  const coverageRatio = candidateAttempts.length
    ? attemptsContainingCandidate.length / candidateAttempts.length
    : null;
  let rescueAttemptPrimaryHypothesis = "UNDETERMINED";
  if (candidateAttempts.length) {
    if (Number(coverageRatio) < .35) rescueAttemptPrimaryHypothesis = "A_TARGET_COVERAGE_INSUFFICIENT";
    else if (Number(candidateHitRateWhenCovered) < .08) rescueAttemptPrimaryHypothesis = "B_COVERED_BUT_ZXING_REDECODE_LOW";
    else if (Object.keys(variantCounts).length > 1 &&
      Object.keys(candidateHitsByVariant).length <= 1) {
      rescueAttemptPrimaryHypothesis = "C_VARIANT_OR_ROI_SELECTION_INEFFICIENT";
    } else if (targetSwitchDiagnostics.some((item) =>
      item.previousTargetRoiId && item.firstAttemptContainsCandidatePosition === false
    )) {
      rescueAttemptPrimaryHypothesis = "D_RETARGET_MOVED_OFF_CANDIDATE";
    }
  }

  return {
    diagnosticOnly: true,
    lastConfirmedDiagnosticId: last.diagnosticId,
    firstSeenFrame,
    firstDecodeIntegrityPassFrame,
    firstRecognizedOrSafeFrame,
    genericConfirmationFrame: confirmationFrame,
    firstSeenToConfirmationFrames:
      Number.isFinite(firstSeenFrame) ? Math.max(0, confirmationFrame - firstSeenFrame) : null,
    decodeIntegrityPassToConfirmationFrames:
      Number.isFinite(firstDecodeIntegrityPassFrame)
        ? Math.max(0, confirmationFrame - firstDecodeIntegrityPassFrame)
        : null,
    normalDecodeHitFrames: normalFrames,
    rescueHitFrames: rescueFrames,
    jsQRHitFrames: jsqrFrames,
    zxingHitFrames: zxingFrames,
    sameFrameBothEngineFrames: bothEngineFrames,
    medianGuidePosition: {
      x: Number.isFinite(medianX) ? Number(medianX.toFixed(4)) : null,
      y: Number.isFinite(medianY) ? Number(medianY.toFixed(4)) : null,
      region: guideRegion,
    },
    remainingOneRescueActivatedFrame: rescueActivatedFrame,
    remainingOneRescueAttemptCount: Number(rescueState?.zxingAttemptCount || 0),
    remainingOneRescueFrameCount: Number(rescueState?.rescueFrameCount || 0),
    rescueAttemptDiagnostic: {
      diagnosticOnly: true,
      decoderChanged: false,
      rescueLogicChanged: false,
      evaluationOverheadPresent: true,
      timingComparableToNonDiagnosticRun: false,
      totalAttemptCount: candidateAttempts.length,
      zxingAttemptCount: candidateAttempts.filter((item) => item.engine === "zxing").length,
      jsQRAttemptCount: candidateAttempts.filter((item) => item.engine === "jsqr").length,
      attemptContainingCandidatePositionCount: attemptsContainingCandidate.length,
      attemptMissingCandidatePositionCount: attemptsMissingCandidate.length,
      candidateHitAttemptCount: candidateHitAttempts.length,
      candidateAttemptHitRate: Number.isFinite(candidateAttemptHitRate)
        ? Number(candidateAttemptHitRate.toFixed(4))
        : null,
      candidateHitRateWhenCovered: Number.isFinite(candidateHitRateWhenCovered)
        ? Number(candidateHitRateWhenCovered.toFixed(4))
        : null,
      targetRoiAttemptCounts: targetCounts,
      variantAttemptCounts: variantCounts,
      candidateHitsByVariant,
      variantEfficacy,
      physicalLocatorCandidateSizeEstimate: {
        width: Number.isFinite(locatorMedianW) ? Number(locatorMedianW.toFixed(4)) : null,
        height: Number.isFinite(locatorMedianH) ? Number(locatorMedianH.toFixed(4)) : null,
        matchCount: locatorTrackMatches.length,
        diagnosticOnly: true,
      },
      qualityProxySource: "frameQuality-on-rescue-crop-diagnostic-only",
      decodeTimingScope: "decodeZxing-call-only",
      preprocessingVariants: {
        grayscale: false,
        threshold: false,
      },
      candidateLockRetargetGuardCounterfactual,
      retargetCount: Number(rescueState?.retargetCount || 0),
      sameRegionRetryCount,
      maxSameTargetRoiAttempts: targetCountValues.length ? Math.max(...targetCountValues) : 0,
      targetSwitchDiagnostics: targetSwitchDiagnostics.slice(0, 16),
      primaryHypothesis: rescueAttemptPrimaryHypothesis,
      attempts: candidateAttempts.length <= 40
        ? candidateAttempts
        : [...candidateAttempts.slice(0, 20), ...candidateAttempts.slice(-20)],
      attemptsTruncated: candidateAttempts.length > 40,
    },
    candidateRescueHitFrameCount: rescueFrames.count,
    candidateNormalHitFrameCount: normalFrames.count,
    rescueStartToFinalConfirmationFrames:
      Number.isFinite(rescueActivatedFrame)
        ? Math.max(0, confirmationFrame - rescueActivatedFrame)
        : null,
    decodeIntegrityRejectReasonHistogramBeforeConfirmation: decodeRejectHistogram,
    currentStructuralRejectReasonHistogramBeforeConfirmation: structuralRejectHistogram,
    preConfirmationRejectionReasonHistogram: combinedRejectHistogram,
    decoderAcquisitionDelayCandidate:
      Number.isFinite(firstSeenFrame) &&
      Number.isFinite(separated?.acquisitionLatencyDiagnostic?.frameAtPenultimateConfirmed)
        ? Math.max(0, firstSeenFrame - separated.acquisitionLatencyDiagnostic.frameAtPenultimateConfirmed)
        : null,
    confirmationDelayAfterFirstSeen:
      Number.isFinite(firstSeenFrame) ? Math.max(0, confirmationFrame - firstSeenFrame) : null,
  };
}

function topHistogramEntry(histogram = {}) {
  return Object.entries(histogram || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || null;
}

function managementShortFromLiveFull(full, runtimeHead = null) {
  const counting = full?.countingIntegrityDiagnostic || {};
  const separated = full?.parserSeparatedEvaluation || full?.parserSeparationCounterfactual || {};
  const strict = full?.unknownSafeStrictEvaluation || {};
  const completion = full?.completion || {};
  const mainFail = topHistogramEntry(counting.failReasonHistogram);
  const structuralFails = (counting.rawCandidates || [])
    .filter((candidate) => candidate.structuralPass === false)
    .sort((a, b) => Number(b.frameHitCount || 0) - Number(a.frameHitCount || 0))
    .slice(0, 2)
    .map((candidate) => ({
      diagnosticId: candidate.diagnosticId,
      frameHitCount: candidate.frameHitCount,
      jsqrFrameCount: candidate.jsqrFrameCount,
      zxingFrameCount: candidate.zxingFrameCount,
      decodedTextLengthMedian: candidate.decodedTextLengthMedian,
      slashCountMedian: candidate.slashCountMedian,
      parserSchemaClasses: candidate.parserSchemaClasses,
      failReasonHistogram: candidate.structuralFailReasonHistogram,
      positionClusterCount: candidate.positionClusterCount,
    }));
  const unknownSafe = (separated.unrecognizedSafeCandidates || []).slice(0, 2).map((candidate) => ({
    diagnosticId: candidate.diagnosticId,
    frameHitCount: candidate.frameHitCount,
    jsqrFrameCount: candidate.jsqrFrameCount,
    zxingFrameCount: candidate.zxingFrameCount,
    bothEngineFrameCount: candidate.bothEngineFrameCount,
    payloadLength: candidate.payloadLength,
    parserSchemaClass: candidate.parserSchemaClass,
    confirmationSupport: candidate.confirmationSupport,
    positionClusterCount: candidate.positionClusterCount,
  }));
  const importantCandidates = [...structuralFails, ...unknownSafe].slice(0, 3);
  const h1Events = counting.sameCanonicalMultiplePhysicalPositionEvents || [];
  const h3Candidates = counting.unconfirmedStructuralPassCandidates || [];
  const h3Groups = counting.oneOffPatternGroups || [];
  let primaryCause = "D-undetermined-or-decoder-stage";
  if (Number(counting.structuralFailUniqueCount || 0) > 0) primaryCause = "H2-structural-parser-reject";
  else if (h3Candidates.length || h3Groups.length) primaryCause = "H3-unconfirmed-canonical-instability";
  else if (counting.duplicatePayloadPhysicalQrCandidateDetected) primaryCause = "H1-duplicate-payload-physical-candidate";
  const sourceRevision = full?.revision || "unknown";
  const sourceHeadMap = {
    "live-poc-v2-counting-integrity-diagnostic-1": "dbbb2a92c3842d9ffbe3b2b5a6cf55e9e66224e2",
  };
  const latencyFull = full?.remainingOneLatencyDiagnostic || null;
  const rescueAttemptFull = latencyFull?.rescueAttemptDiagnostic || null;
  const rescueAttemptRows = Array.isArray(rescueAttemptFull?.attempts) ? rescueAttemptFull.attempts : [];
  const representativeRescueAttempts = rescueAttemptRows.length <= 8
    ? rescueAttemptRows
    : [...rescueAttemptRows.slice(0, 4), ...rescueAttemptRows.slice(-4)];
  const latencyShort = latencyFull ? {
    diagnosticOnly: true,
    lastConfirmedDiagnosticId: latencyFull.lastConfirmedDiagnosticId,
    firstSeenFrame: latencyFull.firstSeenFrame,
    firstDecodeIntegrityPassFrame: latencyFull.firstDecodeIntegrityPassFrame,
    firstRecognizedOrSafeFrame: latencyFull.firstRecognizedOrSafeFrame,
    genericConfirmationFrame: latencyFull.genericConfirmationFrame,
    firstSeenToConfirmationFrames: latencyFull.firstSeenToConfirmationFrames,
    decodeIntegrityPassToConfirmationFrames: latencyFull.decodeIntegrityPassToConfirmationFrames,
    normalDecodeHitFrames: latencyFull.normalDecodeHitFrames,
    rescueHitFrames: latencyFull.rescueHitFrames,
    jsQRHitFrames: latencyFull.jsQRHitFrames,
    zxingHitFrames: latencyFull.zxingHitFrames,
    sameFrameBothEngineFrames: latencyFull.sameFrameBothEngineFrames,
    medianGuidePosition: latencyFull.medianGuidePosition,
    remainingOneRescueActivatedFrame: latencyFull.remainingOneRescueActivatedFrame,
    remainingOneRescueAttemptCount: latencyFull.remainingOneRescueAttemptCount,
    remainingOneRescueFrameCount: latencyFull.remainingOneRescueFrameCount,
    candidateRescueHitFrameCount: latencyFull.candidateRescueHitFrameCount,
    candidateNormalHitFrameCount: latencyFull.candidateNormalHitFrameCount,
    rescueStartToFinalConfirmationFrames: latencyFull.rescueStartToFinalConfirmationFrames,
    preConfirmationRejectionReasonHistogram: latencyFull.preConfirmationRejectionReasonHistogram,
    decoderAcquisitionDelayCandidate: latencyFull.decoderAcquisitionDelayCandidate,
    confirmationDelayAfterFirstSeen: latencyFull.confirmationDelayAfterFirstSeen,
    rescueAttemptDiagnostic: rescueAttemptFull ? {
      diagnosticOnly: true,
      totalAttemptCount: rescueAttemptFull.totalAttemptCount,
      zxingAttemptCount: rescueAttemptFull.zxingAttemptCount,
      jsQRAttemptCount: rescueAttemptFull.jsQRAttemptCount,
      attemptContainingCandidatePositionCount: rescueAttemptFull.attemptContainingCandidatePositionCount,
      attemptMissingCandidatePositionCount: rescueAttemptFull.attemptMissingCandidatePositionCount,
      candidateHitAttemptCount: rescueAttemptFull.candidateHitAttemptCount,
      candidateAttemptHitRate: rescueAttemptFull.candidateAttemptHitRate,
      candidateHitRateWhenCovered: rescueAttemptFull.candidateHitRateWhenCovered,
      targetRoiAttemptCounts: rescueAttemptFull.targetRoiAttemptCounts,
      variantAttemptCounts: rescueAttemptFull.variantAttemptCounts,
      candidateHitsByVariant: rescueAttemptFull.candidateHitsByVariant,
      variantEfficacy: rescueAttemptFull.variantEfficacy || null,
      physicalLocatorCandidateSizeEstimate: rescueAttemptFull.physicalLocatorCandidateSizeEstimate || null,
      qualityProxySource: rescueAttemptFull.qualityProxySource || null,
      decodeTimingScope: rescueAttemptFull.decodeTimingScope || null,
      preprocessingVariants: rescueAttemptFull.preprocessingVariants || null,
      candidateLockRetargetGuardCounterfactual: rescueAttemptFull.candidateLockRetargetGuardCounterfactual ? {
        diagnosticOnly: true,
        runtimeChanged: false,
        groundTruthUsed: false,
        payloadUsed: false,
        candidateLockCounterfactualEvaluable: Boolean(rescueAttemptFull.candidateLockRetargetGuardCounterfactual.candidateLockCounterfactualEvaluable),
        candidateLockCounterfactualNotEvaluableReason: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.candidateLockCounterfactualNotEvaluableReason || null,
        firstUnconfirmedSafeCandidateFrame: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.firstUnconfirmedSafeCandidateFrame,
        candidateGuidePositionAtFirstSeen: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.candidateGuidePositionAtFirstSeen,
        targetAtFirstSeen: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.targetAtFirstSeen,
        actualTargetTimelineAfterFirstSeen: (rescueAttemptFull.candidateLockRetargetGuardCounterfactual.actualTargetTimelineAfterFirstSeen || []).slice(0, 12),
        actualCoveredAttemptsAfterFirstSeen: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.actualCoveredAttemptsAfterFirstSeen,
        actualMissedAttemptsAfterFirstSeen: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.actualMissedAttemptsAfterFirstSeen,
        actualRetargetAwayCountAfterFirstSeen: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.actualRetargetAwayCountAfterFirstSeen,
        actualFramesSpentOutsideCandidateRegion: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.actualFramesSpentOutsideCandidateRegion,
        candidateLockStartFrame: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.candidateLockStartFrame,
        candidateLockEndFrame: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.candidateLockEndFrame,
        confirmationFrame: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.confirmationFrame,
        CF0_CURRENT_SCHEDULED_RETARGET: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.CF0_CURRENT_SCHEDULED_RETARGET,
        CF1_HOLD_FIRST_CONTAINING_TARGET: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.CF1_HOLD_FIRST_CONTAINING_TARGET,
        CF2_CONTAINING_TARGETS_ONLY: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.CF2_CONTAINING_TARGETS_ONLY,
        CF3_TEMPORARY_LOCK_SMALL_SWEEP: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.CF3_TEMPORARY_LOCK_SMALL_SWEEP,
        cf3LockFrameSweep: rescueAttemptFull.candidateLockRetargetGuardCounterfactual.cf3LockFrameSweep,
        counterfactualCoverageOnly: true,
        decodeOutcomeCounterfactuallyInferred: false,
      } : null,
      evaluationOverheadPresent: Boolean(rescueAttemptFull.evaluationOverheadPresent),
      timingComparableToNonDiagnosticRun: Boolean(rescueAttemptFull.timingComparableToNonDiagnosticRun),
      retargetCount: rescueAttemptFull.retargetCount,
      sameRegionRetryCount: rescueAttemptFull.sameRegionRetryCount,
      maxSameTargetRoiAttempts: rescueAttemptFull.maxSameTargetRoiAttempts,
      targetSwitchDiagnostics: (rescueAttemptFull.targetSwitchDiagnostics || []).slice(0, 8),
      primaryHypothesis: rescueAttemptFull.primaryHypothesis,
      representativeAttempts: representativeRescueAttempts,
      representativeAttemptsFromTotal: rescueAttemptRows.length,
    } : null,
  } : null;
  return {
    schema: MANAGEMENT_SHORT_SCHEMA,
    summaryVariant: "management-short",
    sourceSchema: full?.schema || null,
    revision: sourceRevision,
    evaluationBranch: full?.evaluation?.branch || EVALUATION_BRANCH,
    evaluationHead: full?.evaluation?.head || sourceHeadMap[sourceRevision] || runtimeHead || null,
    baseline: full?.evaluation?.baseline || LIVE_BASELINE_HEAD,
    majorResult: {
      processedFrames: full?.processedFrameCount ?? null,
      currentConfirmed: full?.confirmedQrCount ?? separated.currentConfirmedCount ?? null,
      expectedQrCount: completion.expectedQrCount ?? separated.currentCompletion?.expectedQrCount ?? null,
      currentComplete: Boolean(completion.complete ?? separated.currentCompletion?.complete),
      rawUnique: counting.rawUniqueDiagnosticCandidateCount ?? separated.rawUniqueCount ?? null,
      decodeIntegritySafeUnique: separated.decodeIntegritySafeUniqueCount ?? null,
      recognizedSchemaUnique: separated.recognizedSchemaUniqueCount ?? null,
      unrecognizedSafeUnique: separated.unrecognizedSafeUniqueCount ?? null,
      structuralFailUnique: counting.structuralFailUniqueCount ?? null,
      separatedConfirmed: separated.separatedConfirmedCount ?? separated.counterfactualConfirmedCount ?? null,
      separatedComplete: Boolean(separated.separatedCompletion?.complete ?? separated.counterfactualCompletion?.complete),
      normalOnlyCandidateCount: separated.normalOnlyCandidateCount ?? null,
      rescueInvolvedCandidateCount: separated.rescueInvolvedCandidateCount ?? null,
      currentConfirmedMissingFromSeparatedCount: separated.currentConfirmedMissingFromSeparatedCount ?? null,
      accountingIntegrityPass: separated.accountingIntegrityPass ?? null,
      frameAtPenultimateConfirmed: separated.acquisitionLatencyDiagnostic?.frameAtPenultimateConfirmed ?? null,
      frameAtFinalConfirmed: separated.acquisitionLatencyDiagnostic?.frameAtFinalConfirmed ?? null,
      finalQrWaitFrames: separated.acquisitionLatencyDiagnostic?.finalQrWaitFrames ?? null,
    },
    remainingOneLatencyDiagnostic: latencyShort,
    baselineReproduction: {
      normalDecodeControlChanged: Boolean(counting.normalDecodeControlChanged),
      dedupeChanged: Boolean(counting.dedupeChanged),
      completionRuleChanged: Boolean(counting.completionRuleChanged),
      rescueChanged: Boolean(counting.rescueChanged),
    },
    causeAggregate: {
      primaryCause,
      mainFailReason: mainFail ? { reason: mainFail[0], count: mainFail[1] } : null,
      h1DuplicatePayloadCandidate: Boolean(counting.duplicatePayloadPhysicalQrCandidateDetected),
      h1EventCount: h1Events.length,
      h2StructuralFailUnique: counting.structuralFailUniqueCount ?? 0,
      h3UnconfirmedStructuralPassCount: h3Candidates.length,
      h3OneOffPatternGroupCount: h3Groups.length,
      decoderStageMissingSupported: Number(counting.rawUniqueDiagnosticCandidateCount || 0) <= Number(counting.confirmedCanonicalCount || 0),
    },
    productionShapeCandidate: full?.productionShapeCandidate ? {
      qrAcquisitionState: full.productionShapeCandidate.qrAcquisitionState,
      confirmedCanonicalCount: full.productionShapeCandidate.confirmedCanonicalCount,
      kind: full.productionShapeCandidate.kind,
      expectedQrCount: full.productionShapeCandidate.expectedQrCount,
      accountingIntegrityPass: full.productionShapeCandidate.accountingIntegrityPass,
      overCount: full.productionShapeCandidate.overCount,
      proposedStopCandidate: full.productionShapeCandidate.proposedStopCandidate,
      productionShapeStopConditionPass: full.productionShapeCandidate.productionShapeStopConditionPass ?? false,
      cameraStopSource: full.productionShapeCandidate.cameraStopSource ?? "none",
      confirmedRecognizedCount: full.productionShapeCandidate.confirmedRecognizedCount ?? null,
      confirmedUnrecognizedSafeCount: full.productionShapeCandidate.confirmedUnrecognizedSafeCount ?? null,
      completionEvidencePartitionIntegrityPass: full.productionShapeCandidate.completionEvidencePartitionIntegrityPass ?? null,
      payloadInterpretationState: full.productionShapeCandidate.payloadInterpretationState,
      vehicleFieldState: {
        state: full.productionShapeCandidate.vehicleFieldState?.state ?? null,
        complete: full.productionShapeCandidate.vehicleFieldState?.complete ?? false,
        missingFieldCount: full.productionShapeCandidate.vehicleFieldState?.missingFieldCount ?? null,
        fieldCompletenessEvaluated: full.productionShapeCandidate.vehicleFieldState?.fieldCompletenessEvaluated ?? false,
      },
      physicalSlotUi: {
        slotCount: full.productionShapeCandidate.physicalSlotUi?.slotCount ?? null,
        readCount: full.productionShapeCandidate.physicalSlotUi?.readCount ?? null,
        uncertainCount: full.productionShapeCandidate.physicalSlotUi?.uncertainCount ?? null,
        canonicalWithStablePhysicalAssociationCount: full.productionShapeCandidate.physicalSlotUi?.canonicalWithStablePhysicalAssociationCount ?? null,
        canonicalWithoutStablePhysicalAssociationCount: full.productionShapeCandidate.physicalSlotUi?.canonicalWithoutStablePhysicalAssociationCount ?? null,
        stablePhysicalSlotCount: full.productionShapeCandidate.physicalSlotUi?.stablePhysicalSlotCount ?? null,
        sessionPersistedSlotCount: full.productionShapeCandidate.physicalSlotUi?.sessionPersistedSlotCount ?? null,
        currentFrameTrackCount: full.productionShapeCandidate.physicalSlotUi?.currentFrameTrackCount ?? null,
        associationConflictCount: full.productionShapeCandidate.physicalSlotUi?.associationConflictCount ?? null,
        conflictCategoryCounts: full.productionShapeCandidate.physicalSlotUi?.conflictCategoryCounts || null,
        associationVariants: full.productionShapeCandidate.physicalSlotUi?.associationVariants || null,
        nearbyConflictSubtypeCounts: full.productionShapeCandidate.physicalSlotUi?.nearbyConflictSubtypeCounts || null,
        nearbyConflictPairDiagnostics: (full.productionShapeCandidate.physicalSlotUi?.nearbyConflictPairDiagnostics || [])
          .slice(0, 4)
          .map((item) => ({
            diagnosticIdA: item.diagnosticIdA,
            diagnosticIdB: item.diagnosticIdB,
            medianPairDistance: item.medianPairDistance,
            bSubtype: item.bSubtype,
            sameFrameCoexistenceCount: item.sameFrameCoexistenceCount,
            sameFrameNearbyCount: item.sameFrameNearbyCount,
            sameFrameMinimumDistance: item.sameFrameMinimumDistance,
            sameFrameMedianDistance: item.sameFrameMedianDistance,
            temporalOverlapFrameCount: item.temporalOverlapFrameCount,
            trajectoryNearestDistanceMedian: item.trajectoryNearestDistanceMedian,
            medianOnlyNearby: item.medianOnlyNearby,
            actualSimultaneousNearby: item.actualSimultaneousNearby,
            pairwisePositionSamples: (item.pairwisePositionSamples || []).slice(0, 4),
          })),
        conflictDiagnostics: (full.productionShapeCandidate.physicalSlotUi?.conflictDiagnostics || []).slice(0, 8).map((item) => ({
          diagnosticId: item.diagnosticId,
          stableBase: item.stableBase,
          positionFrameCount: item.positionFrameCount,
          locatorMatchFrameCount: item.locatorMatchFrameCount,
          medianX: item.medianX,
          medianY: item.medianY,
          sameFrameSpatialConflict: item.sameFrameSpatialConflict,
          nearbyCanonicalConflict: item.nearbyCanonicalConflict,
          locatorTrackMultiDiagnosticConflict: item.locatorTrackMultiDiagnosticConflict,
          temporalCameraMotionFalseConflict: item.temporalCameraMotionFalseConflict,
          insufficientPositionSupport: item.insufficientPositionSupport,
          finalConflict: item.finalConflict,
          v2FinalConflict: item.v2FinalConflict,
          Dflag: item.dFlag,
          v3FinalConflict: item.v3FinalConflict,
          rescuedByDExemption: item.rescuedByDExemption,
          conflictCategories: item.conflictCategories,
        })),
        duplicateIdentityWarning: Boolean(full.productionShapeCandidate.physicalSlotUi?.duplicateIdentityWarning),
      },
    } : null,
    comparison: {
      currentConfirmedCount: separated.currentConfirmedCount ?? full?.confirmedQrCount ?? null,
      separatedConfirmedCount: separated.separatedConfirmedCount ?? separated.counterfactualConfirmedCount ?? null,
      expectedQrCount: separated.separatedCompletion?.expectedQrCount ?? separated.counterfactualCompletion?.expectedQrCount ?? completion.expectedQrCount ?? null,
      currentComplete: Boolean(separated.currentCompletion?.complete ?? completion.complete),
      separatedComplete: Boolean(separated.separatedCompletion?.complete ?? separated.counterfactualCompletion?.complete),
      currentConfirmedMissingFromSeparatedCount: separated.currentConfirmedMissingFromSeparatedCount ?? null,
      currentConfirmedMissingFromSeparatedDiagnosticIds: separated.currentConfirmedMissingFromSeparatedDiagnosticIds || [],
      accountingIntegrityPass: separated.accountingIntegrityPass ?? null,
    },
    unknownSafeStrict: {
      recognizedConfirmedCount: strict.recognizedConfirmedCount ?? null,
      eligibleUnknownSafeCount: strict.eligibleUnknownSafeCount ?? null,
      totalCandidateConfirmed: strict.totalCandidateConfirmed ?? null,
      expectedQrCount: strict.expectedQrCount ?? null,
      exactExpected: strict.exactExpected ?? null,
      completionEligible: strict.completionEligible ?? null,
      overflow: strict.overflow ?? null,
      underflow: strict.underflow ?? null,
      duplicateIntegrityPass: strict.duplicateIntegrityPass ?? null,
      currentRegression: strict.currentRegression ?? null,
      holdReasons: strict.holdReasons || [],
      rejectReasonCounts: strict.rejectReasonCounts || {},
      payloadIncluded: false,
    },
    importantCases: importantCandidates,
    evaluationPolicy: {
      currentVariant: "CURRENT",
      separatedVariant: "PARSER_SEPARATED",
      gtUsedInRuntimeOrControl: false,
      locatorUsedForCompletionExpectedOrRescueControl: false,
      timingComparableToBaseline: false,
    },
    changes: {
      recognitionLogicChanged: false,
      frozenChanged: false,
      productionChanged: false,
      mainChanged: false,
      supabaseChanged: false,
    },
    privacy: {
      payloadIncluded: false,
      imageIncluded: false,
    },
  };
}

function cropSubRoi(source, roi) {
  const sx = Math.max(0, Math.round(source.width * roi.x));
  const sy = Math.max(0, Math.round(source.height * roi.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * roi.w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * roi.h)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function guidePositionFromHit(hit, roi) {
  if (!hit?.localPosition) return null;
  return {
    nx: Number((roi.x + hit.localPosition.nx * roi.w).toFixed(4)),
    ny: Number((roi.y + hit.localPosition.ny * roi.h).toFixed(4)),
  };
}

function rescueRoiFromVariant(baseRoi, variant) {
  const minW = .14;
  const minH = .42;
  let x = Number(baseRoi.x) + Number(variant.dx || 0);
  let y = Number(baseRoi.y) + Number(variant.dy || 0);
  let w = Math.max(minW, Number(baseRoi.w) + Number(variant.dw || 0));
  let h = Math.max(minH, Number(baseRoi.h) + Number(variant.dh || 0));
  x = Math.max(0, Math.min(1 - minW, x));
  y = Math.max(0, Math.min(1 - minH, y));
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  return { x, y, w, h };
}

function cropRescueRoi(source, roi, scale = 1) {
  const sx = Math.max(0, Math.round(source.width * roi.x));
  const sy = Math.max(0, Math.round(source.height * roi.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * roi.w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * roi.h)));
  const safeScale = Math.max(1, Math.min(1.35, Number(scale || 1)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * safeScale));
  canvas.height = Math.max(1, Math.round(sh * safeScale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createLocalRescueState() {
  return {
    active: false,
    activatedFrame: null,
    targetRoiId: null,
    triggerCount: 0,
    rescueFrameCount: 0,
    variantCursor: 0,
    zxingAttemptCount: 0,
    rawSuccessCount: 0,
    structuralSuccessCount: 0,
    novelCanonicalCount: 0,
    lastRescueFrame: null,
    lastNovelRescueFrame: null,
    attemptLog: [],
    targetHistory: [],
    retargetCount: 0,
    variantStats: Object.fromEntries(LOCAL_RESCUE_VARIANTS.map((variant) => [
      variant.id,
      { attempts: 0, rawSuccesses: 0, structuralSuccesses: 0, novelCanonicalCount: 0 },
    ])),
  };
}

function localRescueSnapshot(state) {
  return {
    active: Boolean(state?.active),
    activatedFrame: Number.isFinite(state?.activatedFrame) ? state.activatedFrame : null,
    targetRoiId: state?.targetRoiId || null,
    triggerCount: Number(state?.triggerCount || 0),
    rescueFrameCount: Number(state?.rescueFrameCount || 0),
    zxingAttemptCount: Number(state?.zxingAttemptCount || 0),
    rawSuccessCount: Number(state?.rawSuccessCount || 0),
    structuralSuccessCount: Number(state?.structuralSuccessCount || 0),
    novelCanonicalCount: Number(state?.novelCanonicalCount || 0),
    lastRescueFrame: Number.isFinite(state?.lastRescueFrame) ? state.lastRescueFrame : null,
    lastNovelRescueFrame: Number.isFinite(state?.lastNovelRescueFrame) ? state.lastNovelRescueFrame : null,
    attemptLogCount: Array.isArray(state?.attemptLog) ? state.attemptLog.length : 0,
    targetHistory: Array.isArray(state?.targetHistory) ? state.targetHistory.slice(-24) : [],
    retargetCount: Number(state?.retargetCount || 0),
    variantStats: state?.variantStats || {},
  };
}

function lastNovelCanonicalFrame(evidenceMap) {
  let last = 0;
  for (const entry of evidenceMap.values()) {
    last = Math.max(last, Number(entry?.firstSeenFrame || 0));
  }
  return last;
}

function createSubRoiStats() {
  return new Map(SUB_ROIS.map((roi) => [roi.id, {
    id: roi.id,
    frameAttempts: 0,
    jsqrAttempts: 0,
    zxingAttempts: 0,
    jsqrRawSuccesses: 0,
    zxingRawSuccesses: 0,
    structuralSuccesses: 0,
    novelCanonicalCount: 0,
    confirmedExistingCanonicalHits: 0,
    confirmedOnlyStreak: 0,
    lastAttemptFrame: 0,
    lastNovelFrame: 0,
  }]));
}

function medianNumber(values = []) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function confirmedGuideXs(evidenceMap) {
  const out = [];
  for (const entry of evidenceMap.values()) {
    if (!entry.confirmed) continue;
    const x = medianNumber((entry.guidePositions || []).map((position) => Number(position?.nx)));
    if (Number.isFinite(x)) out.push(x);
  }
  return out;
}

function selectSubRois(frameId, evidenceMap, statsMap) {
  const confirmedXs = confirmedGuideXs(evidenceMap);
  return SUB_ROIS.map((roi, index) => {
    const stats = statsMap.get(roi.id);
    const starvation = Math.max(0, frameId - Number(stats?.lastAttemptFrame || 0));
    const confirmedOverlap = confirmedXs.filter((x) => x >= roi.x && x <= roi.x + roi.w).length;
    const unseenBoost = Number(stats?.structuralSuccesses || 0) === 0 ? 14 : 0;
    const novelBoost = Number(stats?.novelCanonicalCount || 0) === 0 ? 8 : 0;
    const score =
      starvation * 3 +
      unseenBoost +
      novelBoost -
      confirmedOverlap * 9 -
      Number(stats?.confirmedOnlyStreak || 0) * 4 -
      index * .001;
    return { roi, score, confirmedOverlap };
  }).sort((a, b) => b.score - a.score).slice(0, SUB_ROIS_PER_FRAME).map((item) => item.roi);
}

function subRoiGuideLabel(id) {
  return ({
    left: "左側",
    "left-mid": "左寄り",
    center: "中央",
    "right-mid": "右寄り",
    right: "右側",
  })[id] || "ガイド内";
}

function guideXLabel(x) {
  const value = Number(x);
  if (!Number.isFinite(value)) return "ガイド内";
  if (value < .16) return "左端付近";
  if (value < .36) return "左寄り";
  if (value < .64) return "中央付近";
  if (value < .84) return "右寄り";
  return "右端付近";
}

function recentGuideXFromEntry(entry, recentCount = 12) {
  const values = (entry?.guidePositions || [])
    .slice(-recentCount)
    .map((position) => Number(position?.nx))
    .filter(Number.isFinite);
  return medianNumber(values);
}

function fitMissingSlot(xs, expected, missingIndex) {
  const slotIndexes = Array.from({ length: expected }, (_, index) => index)
    .filter((index) => index !== missingIndex);
  if (xs.length !== slotIndexes.length || xs.length < 2) return null;

  const meanS = slotIndexes.reduce((sum, value) => sum + value, 0) / slotIndexes.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  let cov = 0;
  let varS = 0;
  for (let i = 0; i < xs.length; i += 1) {
    cov += (slotIndexes[i] - meanS) * (xs[i] - meanX);
    varS += (slotIndexes[i] - meanS) ** 2;
  }
  const spacing = varS > 0 ? cov / varS : 0;
  if (!(spacing > .015)) return null;
  const offset = meanX - spacing * meanS;
  const residuals = xs.map((x, index) => x - (offset + spacing * slotIndexes[index]));
  const rmse = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);
  const normalizedRmse = rmse / spacing;
  const missingX = offset + spacing * missingIndex;
  const outOfGuidePenalty = missingX < -.08 || missingX > 1.08
    ? .8 + Math.abs(missingX < 0 ? missingX : missingX - 1)
    : 0;

  return {
    missingIndex,
    missingX,
    offset,
    spacing,
    normalizedRmse,
    score: normalizedRmse + outOfGuidePenalty,
    slotXs: Array.from({ length: expected }, (_, index) => offset + spacing * index),
  };
}

function inferMissingPhysicalSlot(evidenceMap, expected) {
  if (!Number.isInteger(expected) || expected < 2) return null;
  const confirmed = [...evidenceMap.values()]
    .filter((entry) => entry.confirmed)
    .map((entry) => ({
      diagnosticId: entry.diagnosticId,
      x: recentGuideXFromEntry(entry),
    }))
    .filter((entry) => Number.isFinite(entry.x))
    .sort((a, b) => a.x - b.x);

  if (confirmed.length !== expected - 1) return null;

  const xs = confirmed.map((entry) => entry.x);
  const fits = Array.from({ length: expected }, (_, missingIndex) =>
    fitMissingSlot(xs, expected, missingIndex)
  ).filter(Boolean).sort((a, b) => a.score - b.score);

  if (!fits.length) return null;
  const best = fits[0];
  const second = fits[1] || null;
  const margin = second ? second.score - best.score : 1;
  let confidence = "low";
  if (best.normalizedRmse <= .18 && margin >= .12) confidence = "high";
  else if (best.normalizedRmse <= .32 && margin >= .05) confidence = "medium";

  const slotStates = Array.from({ length: expected }, (_, index) => ({
    index,
    state: index === best.missingIndex ? "missing-candidate" : "confirmed-order",
    predictedX: Number(best.slotXs[index].toFixed(4)),
  }));

  return {
    expected,
    confirmedCount: confirmed.length,
    missingIndex: best.missingIndex,
    missingX: Number(best.missingX.toFixed(4)),
    missingLabel: guideXLabel(best.missingX),
    confidence,
    normalizedRmse: Number(best.normalizedRmse.toFixed(4)),
    scoreMargin: Number(margin.toFixed(4)),
    slotStates,
    alternateMissingIndex: second && margin < .12 ? second.missingIndex : null,
    evidenceOrder: confirmed.map((entry) => entry.diagnosticId),
  };
}

function nearestSubRoiForGuideX(x) {
  const value = Number(x);
  if (!Number.isFinite(value)) return null;
  return [...SUB_ROIS].sort((a, b) => {
    const ac = a.x + a.w / 2;
    const bc = b.x + b.w / 2;
    return Math.abs(ac - value) - Math.abs(bc - value);
  })[0] || null;
}

function locatorOtsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (const value of gray) hist[value] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0, weightB = 0, bestVariance = -1, threshold = 128;
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

function locatorFinderRatioMatch(runs) {
  if (!Array.isArray(runs) || runs.length !== 5) return null;
  const total = runs.reduce((sum, value) => sum + value, 0);
  if (total < 7) return null;
  const module = total / 7;
  const expected = [1, 1, 3, 1, 1];
  let error = 0;
  for (let i = 0; i < 5; i += 1) error += Math.abs(runs[i] - expected[i] * module);
  const normalizedError = error / total;
  if (normalizedError > .36) return null;
  return { module, normalizedError };
}

function locatorScanFinderRuns(binary, width, height, horizontal = true) {
  const detections = [];
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  for (let o = 0; o < outer; o += 2) {
    const runs = [];
    let last = null, length = 0, start = 0;
    for (let i = 0; i <= inner; i += 1) {
      const value = i < inner ? binary[horizontal ? o * width + i : i * width + o] : -1;
      if (i === 0) {
        last = value; length = 1; start = 0; continue;
      }
      if (value === last && i < inner) {
        length += 1; continue;
      }
      runs.push({ color: last, length, start, end: i - 1 });
      last = value; length = 1; start = i;
    }
    for (let index = 0; index <= runs.length - 5; index += 1) {
      const seq = runs.slice(index, index + 5);
      if (seq[0].color !== 1 || seq[1].color !== 0 || seq[2].color !== 1 || seq[3].color !== 0 || seq[4].color !== 1) continue;
      const match = locatorFinderRatioMatch(seq.map((part) => part.length));
      if (!match) continue;
      const center = (seq[2].start + seq[2].end) / 2;
      detections.push(horizontal
        ? { x: center, y: o, module: match.module, error: match.normalizedError }
        : { x: o, y: center, module: match.module, error: match.normalizedError });
    }
  }
  return detections;
}

function locatorClusterFinderIntersections(horizontal, vertical) {
  const intersections = [];
  for (const h of horizontal) {
    for (const v of vertical) {
      const module = (h.module + v.module) / 2;
      if (module < 1.05) continue;
      if (Math.abs(h.x - v.x) > module * 3 || Math.abs(h.y - v.y) > module * 3) continue;
      const moduleRatio = Math.max(h.module, v.module) / Math.max(.1, Math.min(h.module, v.module));
      if (moduleRatio > 2.3) continue;
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
    const radius = Math.max(4, point.module * 3.2);
    const cluster = clusters.find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= radius);
    if (!cluster) {
      clusters.push({ x: point.x, y: point.y, module: point.module, score: point.score, count: 1 });
    } else {
      const weight = cluster.count;
      cluster.x = (cluster.x * weight + point.x) / (weight + 1);
      cluster.y = (cluster.y * weight + point.y) / (weight + 1);
      cluster.module = (cluster.module * weight + point.module) / (weight + 1);
      cluster.score += point.score;
      cluster.count += 1;
    }
  }
  return clusters
    .filter((item) => item.count >= 2)
    .map((item) => ({ ...item, score: item.score / item.count }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 28);
}

function locatorNearestQrDimension(estimate) {
  const clamped = Math.max(21, Math.min(177, Number(estimate) || 21));
  const version = Math.max(1, Math.min(40, Math.round((clamped - 17) / 4)));
  return 17 + 4 * version;
}

function locatePhysicalQrCandidates(sourceCanvas) {
  const scale = Math.min(1, PHYSICAL_LOCATOR_MAX_WIDTH / Math.max(1, sourceCanvas.width));
  const width = Math.max(120, Math.round(sourceCanvas.width * scale));
  const height = Math.max(80, Math.round(sourceCanvas.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  try {
    const image = ctx.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
    }
    const threshold = locatorOtsuThreshold(gray);
    const binary = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) binary[i] = gray[i] <= threshold ? 1 : 0;

    const horizontal = locatorScanFinderRuns(binary, width, height, true);
    const vertical = locatorScanFinderRuns(binary, width, height, false);
    const finders = locatorClusterFinderIntersections(horizontal, vertical);
    const raw = [];

    const points = finders.slice(0, 28);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = 0; j < points.length; j += 1) {
        if (j === i) continue;
        for (let k = j + 1; k < points.length; k += 1) {
          if (k === i) continue;
          const tl = points[i], a = points[j], b = points[k];
          const ux = a.x - tl.x, uy = a.y - tl.y;
          const vx = b.x - tl.x, vy = b.y - tl.y;
          const du = Math.hypot(ux, uy), dv = Math.hypot(vx, vy);
          if (du < 12 || dv < 12) continue;
          const cos = Math.abs((ux * vx + uy * vy) / Math.max(1, du * dv));
          if (cos > .50) continue;
          const legRatio = Math.max(du, dv) / Math.max(1, Math.min(du, dv));
          if (legRatio > 2.35) continue;
          const modules = [tl.module, a.module, b.module];
          const moduleRatio = Math.max(...modules) / Math.max(.1, Math.min(...modules));
          if (moduleRatio > 2.25) continue;

          const cross = ux * vy - uy * vx;
          const tr = cross >= 0 ? a : b;
          const bl = cross >= 0 ? b : a;
          const avgModule = (tl.module + tr.module + bl.module) / 3;
          const estimatedDimension = ((du + dv) / 2) / Math.max(.1, avgModule) + 7;
          const dimension = locatorNearestQrDimension(estimatedDimension);
          const dimensionResidual = Math.abs(estimatedDimension - dimension);
          if (dimensionResidual > 6) continue;

          const uModule = { x: (tr.x - tl.x) / Math.max(1, dimension - 7), y: (tr.y - tl.y) / Math.max(1, dimension - 7) };
          const vModule = { x: (bl.x - tl.x) / Math.max(1, dimension - 7), y: (bl.y - tl.y) / Math.max(1, dimension - 7) };
          const point = (u, v) => ({
            x: tl.x + uModule.x * u + vModule.x * v,
            y: tl.y + uModule.y * u + vModule.y * v,
          });
          const quad = [
            point(-3.5, -3.5),
            point(dimension - 3.5, -3.5),
            point(dimension - 3.5, dimension - 3.5),
            point(-3.5, dimension - 3.5),
          ];
          const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          const y0 = Math.min(...ys), y1 = Math.max(...ys);
          const boxW = x1 - x0, boxH = y1 - y0;
          if (boxW < 14 || boxH < 14) continue;
          if (x1 < -4 || y1 < -4 || x0 > width + 4 || y0 > height + 4) continue;
          const spread = Math.max(boxW, boxH) / Math.max(1, Math.min(boxW, boxH));
          if (spread > 2.7) continue;

          const finderScore = (tl.score + tr.score + bl.score) / 3;
          const orthogonality = Math.max(0, 1 - cos / .50);
          const legSupport = Math.max(0, 1 - (legRatio - 1) / 1.35);
          const moduleSupport = Math.max(0, 1 - (moduleRatio - 1) / 1.25);
          const dimensionSupport = 1 / (1 + dimensionResidual / 3);
          const confidenceScore = finderScore * orthogonality * legSupport * moduleSupport * dimensionSupport;
          const confidence = confidenceScore >= .42 ? "high" : confidenceScore >= .24 ? "medium" : "low";
          const centerX = (x0 + x1) / 2;
          const centerY = (y0 + y1) / 2;
          raw.push({
            x: centerX / width,
            y: centerY / height,
            w: boxW / width,
            h: boxH / height,
            confidence,
            confidenceScore,
            finderScore,
            dimensionResidual,
          });
        }
      }
    }

    raw.sort((a, b) => b.confidenceScore - a.confidenceScore);
    const kept = [];
    for (const candidate of raw) {
      const duplicate = kept.find((item) => {
        const distance = Math.hypot(candidate.x - item.x, candidate.y - item.y);
        const radius = Math.max(.035, Math.min(.14, Math.min(candidate.w + item.w, candidate.h + item.h) * .38));
        return distance <= radius;
      });
      if (!duplicate) kept.push(candidate);
      if (kept.length >= 12) break;
    }
    return {
      finderCount: finders.length,
      rawCandidateCount: raw.length,
      candidates: kept.map((item, index) => ({
        detectorId: `locator-${index + 1}`,
        x: Number(item.x.toFixed(4)),
        y: Number(item.y.toFixed(4)),
        w: Number(item.w.toFixed(4)),
        h: Number(item.h.toFixed(4)),
        confidence: item.confidence,
        confidenceScore: Number(item.confidenceScore.toFixed(4)),
      })),
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function createPhysicalLocatorUi() {
  return {
    runs: 0,
    lastFrame: null,
    lastLatencyMs: null,
    finderCount: 0,
    rawCandidateCount: 0,
    tracks: [],
  };
}

function guide2DLabel(x, y) {
  const horizontal = x < .34 ? "左" : x > .66 ? "右" : "中央";
  const vertical = y < .42 ? "上" : y > .58 ? "下" : "中央";
  if (horizontal === "中央" && vertical === "中央") return "中央付近";
  if (vertical === "中央") return `${horizontal}側付近`;
  if (horizontal === "中央") return `中央${vertical}付近`;
  return `${horizontal}${vertical}付近`;
}

function subRoiStatsSnapshot(statsMap) {
  return SUB_ROIS.map((roi) => {
    const stats = statsMap.get(roi.id) || {};
    return {
      subRoiId: roi.id,
      frameAttempts: Number(stats.frameAttempts || 0),
      jsqrAttempts: Number(stats.jsqrAttempts || 0),
      zxingAttempts: Number(stats.zxingAttempts || 0),
      jsqrRawSuccesses: Number(stats.jsqrRawSuccesses || 0),
      zxingRawSuccesses: Number(stats.zxingRawSuccesses || 0),
      structuralSuccesses: Number(stats.structuralSuccesses || 0),
      novelCanonicalCount: Number(stats.novelCanonicalCount || 0),
      confirmedExistingCanonicalHits: Number(stats.confirmedExistingCanonicalHits || 0),
      confirmedOnlyStreak: Number(stats.confirmedOnlyStreak || 0),
      lastAttemptFrame: Number(stats.lastAttemptFrame || 0),
      lastNovelFrame: Number(stats.lastNovelFrame || 0),
    };
  });
}

function median(values = []) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function distribution(records, key) {
  const values = records.map((item) => Number(item?.[key])).filter(Number.isFinite).sort((a, b) => a - b);
  const pick = (ratio) => {
    if (!values.length) return null;
    const index = (values.length - 1) * ratio;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    if (lo === hi) return values[lo];
    return values[lo] + (values[hi] - values[lo]) * (index - lo);
  };
  return {
    count: values.length,
    p25: values.length ? Number(pick(.25).toFixed(4)) : null,
    median: values.length ? Number(pick(.5).toFixed(4)) : null,
    p75: values.length ? Number(pick(.75).toFixed(4)) : null,
  };
}

function qualitySummary(records = []) {
  const keys = ["lumaMean", "lumaStdDev", "contrastRange", "edgeStrength", "laplacianVariance", "darkClipRatio", "brightClipRatio"];
  return Object.fromEntries(keys.map((key) => [key, distribution(records, key)]));
}

function completionFromEvidenceMap(map) {
  const confirmed=[...(map?.values?.()||[])].filter((entry)=>entry.confirmed);
  if(confirmed.some((entry)=>entry.parserSchemaClass==="kei-slash")){
    return {kind:"kei",expected:6,label:"軽6QR",confirmedCount:confirmed.length,complete:confirmed.length>=6};
  }
  if(confirmed.some((entry)=>entry.parserSchemaClass==="registered-slash")){
    return {kind:"registered",expected:5,label:"登録車5QR",confirmedCount:confirmed.length,complete:confirmed.length>=5};
  }
  return {kind:"unknown",expected:null,label:"車種判定待ち",confirmedCount:confirmed.length,complete:false};
}
function candidateView(entry) {
  const xs = (entry.guidePositions || []).map((position) => Number(position?.nx)).filter(Number.isFinite);
  const recentXs = (entry.guidePositions || []).slice(-12)
    .map((position) => Number(position?.nx)).filter(Number.isFinite);
  return {
    diagnosticId: entry.diagnosticId,
    fingerprint: entry.fingerprint,
    confirmed: Boolean(entry.confirmed),
    parserSchemaClass: entry.parserSchemaClass,
    payloadLength: entry.payloadLength,
    frameHitCount: entry.frameIds.size,
    jsqrFrameCount: entry.jsqrFrames.size,
    zxingFrameCount: entry.zxingFrames.size,
    bothEngineFrameCount: entry.bothEngineFrames.size,
    firstSeenFrame: entry.firstSeenFrame,
    lastSeenFrame: entry.lastSeenFrame,
    firstSeenSubRoiId: entry.firstSeenSubRoiId || null,
    firstSeenEngine: entry.firstSeenEngine || null,
    firstSeenGuideX: Number.isFinite(entry.firstSeenGuidePosition?.nx) ? entry.firstSeenGuidePosition.nx : null,
    medianGuideX: xs.length ? Number(medianNumber(xs).toFixed(4)) : null,
    recentMedianGuideX: recentXs.length ? Number(medianNumber(recentXs).toFixed(4)) : null,
    subRoiIds: [...entry.subRoiIds].sort(),
  };
}

export default function CertificateQrLiveScanPoc() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const jsQrRef = useRef(null);
  const runningRef = useRef(false);
  const processingRef = useRef(false);
  const lastProcessedRef = useRef(0);
  const frameSeqRef = useRef(0);
  const evidenceRef = useRef(new Map());
  const qualityFramesRef = useRef([]);
  const successQualityFramesRef = useRef([]);
  const subRoiStatsRef = useRef(createSubRoiStats());
  const localRescueRef = useRef(createLocalRescueState());
  const physicalLocatorTracksRef = useRef(new Map());
  const physicalLocatorSeqRef = useRef(0);
  const recentDecodedPositionsRef = useRef([]);
  const physicalLocatorStatsRef = useRef({ runs: 0, totalLatencyMs: 0 });
  const countingIntegrityRef = useRef(createCountingIntegrityState());
  const completionStoppedRef = useRef(false);
  const cameraStopSourceRef = useRef("none");
  const timersRef = useRef(new Set());

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("停止中");
  const [quality, setQuality] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [frameStats, setFrameStats] = useState({ processed: 0, decoded: 0, lastDecodeMs: null, subRoiFrameAttempts: 0 });
  const [subRoiStats, setSubRoiStats] = useState(subRoiStatsSnapshot(subRoiStatsRef.current));
  const [localRescueUi, setLocalRescueUi] = useState(localRescueSnapshot(localRescueRef.current));
  const [physicalLocatorUi, setPhysicalLocatorUi] = useState(createPhysicalLocatorUi());
  const [cameraInfo, setCameraInfo] = useState({ width: 0, height: 0 });
  const [fullJsonInput, setFullJsonInput] = useState("");
  const [convertedShort, setConvertedShort] = useState("");
  const [cameraStopSource, setCameraStopSource] = useState("none");

  const confirmedCount = useMemo(() => candidates.filter((item) => item.confirmed).length, [candidates]);
  const kindEvidence = useMemo(() => {
    if (candidates.some((item) => item.confirmed && item.parserSchemaClass === "kei-slash")) {
      return { kind: "kei", expected: 6, label: "軽6QR" };
    }
    if (candidates.some((item) => item.confirmed && item.parserSchemaClass === "registered-slash")) {
      return { kind: "registered", expected: 5, label: "登録車5QR" };
    }
    return { kind: "unknown", expected: null, label: "車種判定待ち" };
  }, [candidates]);
  const complete = kindEvidence.expected != null && confirmedCount >= kindEvidence.expected;

  const physicalSlotGuide = useMemo(() => {
    if (kindEvidence.expected == null) return null;
    return inferMissingPhysicalSlot(evidenceRef.current, kindEvidence.expected);
  }, [kindEvidence.expected, candidates]);

  const provisionalRemaining = kindEvidence.expected == null
    ? null
    : Math.max(0, kindEvidence.expected - confirmedCount);

  const locatorVisibleTracks = useMemo(() => physicalLocatorUi.tracks
    .filter((track) =>
      track.confidence !== "low" &&
      physicalLocatorUi.lastFrame != null &&
      track.lastSeenFrame === physicalLocatorUi.lastFrame
    ), [physicalLocatorUi]);

  const locatorUndecodedTracks = useMemo(() => locatorVisibleTracks
    .filter((track) => !track.everDecoded && !track.decoded)
    .sort((a, b) => {
      const rank = { high: 2, medium: 1, low: 0 };
      return (rank[b.confidence] - rank[a.confidence]) || (b.confidenceScore - a.confidenceScore);
    }), [locatorVisibleTracks]);

  const locatorPrimaryTarget = locatorUndecodedTracks[0] || null;
  const locatorOverlayTracks = useMemo(() => locatorVisibleTracks.filter((track, index, tracks) => {
    const diagnosticId = track.lastMatchedDiagnosticId || track.matchedDiagnosticId || null;
    if (!diagnosticId) return true;
    return index === tracks.findIndex((candidate) =>
      (candidate.lastMatchedDiagnosticId || candidate.matchedDiagnosticId || null) === diagnosticId
    );
  }), [locatorVisibleTracks]);

  const parserSeparationUi = useMemo(() => parserSeparationCounterfactualSnapshot(
    countingIntegrityRef.current,
    evidenceRef.current
  ), [frameStats.processed, candidates]);

  const unknownSafeStrictUi = useMemo(() => unknownSafeStrictSnapshot(
    countingIntegrityRef.current,
    evidenceRef.current
  ), [frameStats.processed, candidates]);

  const productionShapeUi = useMemo(() => productionShapeCandidateSnapshot(
    countingIntegrityRef.current,
    evidenceRef.current,
    physicalLocatorUi,
    cameraStopSource
  ), [frameStats.processed, candidates, physicalLocatorUi, cameraStopSource]);

  const clearTimers = () => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  };

  const stopStreamAndDecodeLoop = (nextStatus = "停止中") => {
    runningRef.current = false;
    processingRef.current = false;
    clearTimers();
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setRunning(false);
    setStatus(nextStatus);
  };

  const stopCamera = () => {
    stopStreamAndDecodeLoop("停止中");
  };

  const resetEvidence = () => {
    evidenceRef.current = new Map();
    qualityFramesRef.current = [];
    successQualityFramesRef.current = [];
    subRoiStatsRef.current = createSubRoiStats();
    localRescueRef.current = createLocalRescueState();
    physicalLocatorTracksRef.current = new Map();
    physicalLocatorSeqRef.current = 0;
    recentDecodedPositionsRef.current = [];
    physicalLocatorStatsRef.current = { runs: 0, totalLatencyMs: 0 };
    countingIntegrityRef.current = createCountingIntegrityState();
    completionStoppedRef.current = false;
    cameraStopSourceRef.current = "none";
    setCameraStopSource("none");
    frameSeqRef.current = 0;
    setCandidates([]);
    setQuality(null);
    setSubRoiStats(subRoiStatsSnapshot(subRoiStatsRef.current));
    setLocalRescueUi(localRescueSnapshot(localRescueRef.current));
    setPhysicalLocatorUi(createPhysicalLocatorUi());
    setFrameStats({ processed: 0, decoded: 0, lastDecodeMs: null, subRoiFrameAttempts: 0 });
    setStatus(runningRef.current ? "読取中" : "停止中");
  };

  const updateEvidence = (frameId, grouped, frameQualityMetrics, scannedRois) => {
    let structuralHit = false;
    const roiOutcomes = new Map(scannedRois.map((roi) => [roi.id, {
      structural: false,
      novel: false,
      confirmedExisting: false,
    }]));

    for (const [canonical, group] of grouped.entries()) {
      const structural = structuralValidation(canonical);
      if (!structural.pass) continue;
      structuralHit = true;
      const engines = group.engines;
      const prior = evidenceRef.current.get(canonical);
      const wasConfirmed = Boolean(prior?.confirmed);
      let entry = prior;
      const firstHit = group.hits.find((hit) => hit.guidePosition) || group.hits[0] || null;
      const firstNewRoiId = !prior ? firstHit?.subRoiId || null : null;

      if (!entry) {
        entry = {
          canonical,
          diagnosticId: `qr-${String(evidenceRef.current.size + 1).padStart(2, "0")}`,
          fingerprint: nonPiiFingerprint(canonical),
          parserSchemaClass: structural.parserSchemaClass,
          payloadLength: structural.payloadLength,
          frameIds: new Set(),
          jsqrFrames: new Set(),
          zxingFrames: new Set(),
          bothEngineFrames: new Set(),
          firstSeenFrame: frameId,
          lastSeenFrame: frameId,
          firstSeenSubRoiId: firstHit?.subRoiId || null,
          firstSeenEngine: firstHit?.engine || null,
          firstSeenGuidePosition: firstHit?.guidePosition || null,
          guidePositions: [],
          subRoiIds: new Set(),
          confirmed: false,
        };
        evidenceRef.current.set(canonical, entry);
      }

      entry.frameIds.add(frameId);
      if (engines.has("jsqr")) entry.jsqrFrames.add(frameId);
      if (engines.has("zxing")) entry.zxingFrames.add(frameId);
      if (engines.has("jsqr") && engines.has("zxing")) entry.bothEngineFrames.add(frameId);
      for (const hit of group.hits) {
        if (hit.subRoiId) entry.subRoiIds.add(hit.subRoiId);
        if (hit.guidePosition && entry.guidePositions.length < 120) entry.guidePositions.push(hit.guidePosition);
        const outcome = roiOutcomes.get(hit.subRoiId);
        if (outcome) {
          outcome.structural = true;
          outcome.novel = outcome.novel || Boolean(firstNewRoiId && hit.subRoiId === firstNewRoiId);
          outcome.confirmedExisting = outcome.confirmedExisting || wasConfirmed;
        }
      }
      entry.lastSeenFrame = frameId;
      entry.confirmed = entry.bothEngineFrames.size > 0 || entry.frameIds.size >= 2;
    }

    for (const roi of scannedRois) {
      const stats = subRoiStatsRef.current.get(roi.id);
      const outcome = roiOutcomes.get(roi.id);
      if (!stats || !outcome) continue;
      if (outcome.structural) stats.structuralSuccesses += 1;
      if (outcome.novel) {
        stats.novelCanonicalCount += 1;
        stats.lastNovelFrame = frameId;
      }
      if (outcome.confirmedExisting) stats.confirmedExistingCanonicalHits += 1;
      if (outcome.structural && !outcome.novel && outcome.confirmedExisting) stats.confirmedOnlyStreak += 1;
      else if (outcome.novel) stats.confirmedOnlyStreak = 0;
      else stats.confirmedOnlyStreak = Math.max(0, stats.confirmedOnlyStreak - 1);
    }

    if (structuralHit) {
      successQualityFramesRef.current.push({ ...frameQualityMetrics });
      if (successQualityFramesRef.current.length > 100) successQualityFramesRef.current.shift();
    }
    setSubRoiStats(subRoiStatsSnapshot(subRoiStatsRef.current));
    setCandidates([...evidenceRef.current.values()].map(candidateView).sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
      return a.firstSeenFrame - b.firstSeenFrame;
    }));
    return {structuralHit,completion:completionFromEvidenceMap(evidenceRef.current)};
  };

  const runPhysicalLocator = (frameId, canvas) => {
    const started = performance.now();
    const detected = locatePhysicalQrCandidates(canvas);
    const tracks = physicalLocatorTracksRef.current;
    const matchedTrackIds = new Set();

    for (const candidate of detected.candidates.sort((a, b) => b.confidenceScore - a.confidenceScore)) {
      let bestTrack = null;
      let bestDistance = Infinity;
      for (const track of tracks.values()) {
        if (matchedTrackIds.has(track.trackId)) continue;
        if (frameId - track.lastSeenFrame > PHYSICAL_LOCATOR_TRACK_TTL_FRAMES) continue;
        const distance = Math.hypot(candidate.x - track.x, candidate.y - track.y);
        const gate = Math.max(.055, Math.min(.16, Math.max(candidate.w, candidate.h, track.w, track.h) * .95));
        if (distance <= gate && distance < bestDistance) {
          bestTrack = track;
          bestDistance = distance;
        }
      }
      if (!bestTrack) {
        physicalLocatorSeqRef.current += 1;
        bestTrack = {
          trackId: `physical-${String(physicalLocatorSeqRef.current).padStart(2, "0")}`,
          x: candidate.x,
          y: candidate.y,
          w: candidate.w,
          h: candidate.h,
          confidence: candidate.confidence,
          confidenceScore: candidate.confidenceScore,
          firstSeenFrame: frameId,
          lastSeenFrame: frameId,
          seenCount: 1,
          decodedThroughFrame: -1,
          matchedDiagnosticId: null,
          matchedDiagnosticIds: new Set(),
          matchHistory: [],
        };
        tracks.set(bestTrack.trackId, bestTrack);
      } else {
        const alpha = .65;
        bestTrack.x = bestTrack.x * (1 - alpha) + candidate.x * alpha;
        bestTrack.y = bestTrack.y * (1 - alpha) + candidate.y * alpha;
        bestTrack.w = bestTrack.w * (1 - alpha) + candidate.w * alpha;
        bestTrack.h = bestTrack.h * (1 - alpha) + candidate.h * alpha;
        bestTrack.confidence = candidate.confidence;
        bestTrack.confidenceScore = candidate.confidenceScore;
        bestTrack.lastSeenFrame = frameId;
        bestTrack.seenCount += 1;
      }
      matchedTrackIds.add(bestTrack.trackId);
    }

    for (const [trackId, track] of tracks.entries()) {
      if (frameId - track.lastSeenFrame > PHYSICAL_LOCATOR_TRACK_TTL_FRAMES) tracks.delete(trackId);
    }

    const recent = recentDecodedPositionsRef.current
      .filter((item) => frameId - item.frameId <= PHYSICAL_LOCATOR_DECODE_MATCH_WINDOW_FRAMES);
    recentDecodedPositionsRef.current = recent;

    const latestByDiagnostic = new Map();
    for (const item of recent) {
      const existing = latestByDiagnostic.get(item.diagnosticId);
      if (!existing || item.frameId > existing.frameId) {
        latestByDiagnostic.set(item.diagnosticId, { frameId: item.frameId, positions: [item] });
      } else if (item.frameId === existing.frameId) {
        existing.positions.push(item);
      }
    }
    const decodedPoints = [...latestByDiagnostic.entries()].map(([diagnosticId, group]) => ({
      diagnosticId,
      x: medianNumber(group.positions.map((item) => item.x)),
      y: medianNumber(group.positions.map((item) => item.y)),
      frameId: group.frameId,
    })).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));

    const pairs = [];
    for (const track of tracks.values()) {
      if (frameId - track.lastSeenFrame > PHYSICAL_LOCATOR_EVERY_FRAMES) continue;
      for (const point of decodedPoints) {
        const distance = Math.hypot(track.x - point.x, track.y - point.y);
        const gate = Math.max(.05, Math.min(.14, Math.max(track.w, track.h) * .8));
        if (distance <= gate) pairs.push({ track, point, distance });
      }
    }
    const usedTracks = new Set(), usedDiagnostics = new Set();
    for (const pair of pairs.sort((a, b) => a.distance - b.distance)) {
      if (usedTracks.has(pair.track.trackId) || usedDiagnostics.has(pair.point.diagnosticId)) continue;
      pair.track.decodedThroughFrame = frameId + PHYSICAL_LOCATOR_TRACK_TTL_FRAMES;
      pair.track.matchedDiagnosticId = pair.point.diagnosticId;
      if (!pair.track.matchedDiagnosticIds) pair.track.matchedDiagnosticIds = new Set();
      pair.track.matchedDiagnosticIds.add(pair.point.diagnosticId);
      if (!Array.isArray(pair.track.matchHistory)) pair.track.matchHistory = [];
      pair.track.matchHistory.push({
        frameId,
        diagnosticId: pair.point.diagnosticId,
      });
      if (pair.track.matchHistory.length > 48) pair.track.matchHistory = pair.track.matchHistory.slice(-48);
      const rawCandidate = countingIntegrityRef.current.rawCandidates.get(pair.point.diagnosticId);
      if (rawCandidate) {
        if (!Array.isArray(rawCandidate.locatorTrackMatches)) rawCandidate.locatorTrackMatches = [];
        rawCandidate.locatorTrackMatches.push({
          frameId,
          trackId: pair.track.trackId,
          x: pair.track.x,
          y: pair.track.y,
          w: pair.track.w,
          h: pair.track.h,
        });
        if (rawCandidate.locatorTrackMatches.length > 96) {
          rawCandidate.locatorTrackMatches = rawCandidate.locatorTrackMatches.slice(-96);
        }
      }
      usedTracks.add(pair.track.trackId);
      usedDiagnostics.add(pair.point.diagnosticId);
    }

    const latencyMs = Math.round(performance.now() - started);
    physicalLocatorStatsRef.current.runs += 1;
    physicalLocatorStatsRef.current.totalLatencyMs += latencyMs;
    const trackViews = [...tracks.values()]
      .filter((track) => frameId - track.lastSeenFrame <= PHYSICAL_LOCATOR_TRACK_TTL_FRAMES)
      .map((track) => ({
        trackId: track.trackId,
        x: Number(track.x.toFixed(4)),
        y: Number(track.y.toFixed(4)),
        w: Number(track.w.toFixed(4)),
        h: Number(track.h.toFixed(4)),
        confidence: track.confidence,
        confidenceScore: Number(track.confidenceScore.toFixed(4)),
        seenCount: track.seenCount,
        firstSeenFrame: track.firstSeenFrame,
        lastSeenFrame: track.lastSeenFrame,
        decoded: frameId <= Number(track.decodedThroughFrame || -1),
        everDecoded: Boolean(track.matchedDiagnosticId),
        matchedDiagnosticId: frameId <= Number(track.decodedThroughFrame || -1) ? track.matchedDiagnosticId : null,
        lastMatchedDiagnosticId: track.matchedDiagnosticId || null,
        matchedDiagnosticIds: [...(track.matchedDiagnosticIds || new Set())],
        matchHistory: (track.matchHistory || []).slice(-24),
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    setPhysicalLocatorUi({
      runs: physicalLocatorStatsRef.current.runs,
      lastFrame: frameId,
      lastLatencyMs: latencyMs,
      finderCount: detected.finderCount,
      rawCandidateCount: detected.rawCandidateCount,
      tracks: trackViews,
    });
  };

  const drawGuideRoi = (video, canvas) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.round(vw * GUIDE_ROI.x);
    const sy = Math.round(vh * GUIDE_ROI.y);
    const sw = Math.round(vw * GUIDE_ROI.w);
    const sh = Math.round(vh * GUIDE_ROI.h);
    const scale = Math.min(1, MAX_DECODE_DIMENSION / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  };

  const processFrame = async () => {
    if (!runningRef.current || processingRef.current) return;
    const now = performance.now();
    if (now - lastProcessedRef.current < FRAME_INTERVAL_MS) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    processingRef.current = true;
    lastProcessedRef.current = now;
    const frameId = ++frameSeqRef.current;
    const started = performance.now();
    try {
      drawGuideRoi(video, canvas);
      const q = frameQuality(canvas);
      setQuality(q);
      qualityFramesRef.current.push({ ...q });
      if (qualityFramesRef.current.length > 160) qualityFramesRef.current.shift();

      const selectedRois = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current);
      const allHits = [];
      for (const roi of selectedRois) {
        const stats = subRoiStatsRef.current.get(roi.id);
        stats.frameAttempts += 1;
        stats.lastAttemptFrame = frameId;
        const subCanvas = cropSubRoi(canvas, roi);
        try {
          stats.jsqrAttempts += 1;
          stats.zxingAttempts += 1;
          const [jsHits, zxHits] = await Promise.all([
            Promise.resolve(decodeJsMulti(jsQrRef.current, subCanvas, 3)),
            decodeZxing(readerRef.current, subCanvas),
          ]);
          const [diagnosticJsRaw, diagnosticZxRaw] = await Promise.all([
            Promise.resolve(diagnosticDecodeJsRaw(jsQrRef.current, subCanvas)),
            diagnosticDecodeZxingRaw(readerRef.current, subCanvas),
          ]);
          recordRawDiagnosticHits(
            countingIntegrityRef.current,
            frameId,
            roi.id,
            roi,
            [...diagnosticJsRaw, ...diagnosticZxRaw]
          );
          stats.jsqrRawSuccesses += jsHits.length;
          stats.zxingRawSuccesses += zxHits.length;
          for (const hit of [...jsHits, ...zxHits]) {
            allHits.push({
              ...hit,
              subRoiId: roi.id,
              guidePosition: guidePositionFromHit(hit, roi),
            });
          }
        } finally {
          subCanvas.width = 1;
          subCanvas.height = 1;
        }
      }

      recordPreDedupeCanonicalHits(countingIntegrityRef.current, frameId, allHits);

      const grouped = new Map();
      for (const hit of allHits) {
        if (!hit.canonical) continue;
        if (!grouped.has(hit.canonical)) grouped.set(hit.canonical, { engines: new Set(), hits: [] });
        grouped.get(hit.canonical).engines.add(hit.engine);
        grouped.get(hit.canonical).hits.push(hit);
      }

      const completionBeforeRescue = completionFromEvidenceMap(evidenceRef.current);
      const remainingOne =
        completionBeforeRescue.expected != null &&
        completionBeforeRescue.confirmedCount === completionBeforeRescue.expected - 1;
      const lastNovelFrame = lastNovelCanonicalFrame(evidenceRef.current);
      const stalledFrames = Math.max(0, frameId - lastNovelFrame);
      const normalNovelStructural = [...grouped.keys()].some((canonical) =>
        !evidenceRef.current.has(canonical) && structuralValidation(canonical).pass
      );
      const rescueState = localRescueRef.current;

      if (
        !rescueState.active &&
        remainingOne &&
        !normalNovelStructural &&
        stalledFrames >= LOCAL_RESCUE_STALL_FRAMES
      ) {
        const target = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
        if (target) {
          rescueState.active = true;
          rescueState.activatedFrame = frameId;
          rescueState.targetRoiId = target.id;
          rescueState.triggerCount += 1;
          rescueState.variantCursor = 0;
          if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
          rescueState.targetHistory.push({
            frameId,
            targetRoiId: target.id,
            reason: "activation",
          });
        }
      }

      if (rescueState.active && remainingOne) {
        if (
          rescueState.rescueFrameCount > 0 &&
          rescueState.rescueFrameCount % LOCAL_RESCUE_RETARGET_EVERY_FRAMES === 0
        ) {
          const retarget = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
          if (retarget) {
            const previousTargetRoiId = rescueState.targetRoiId;
            rescueState.targetRoiId = retarget.id;
            if (previousTargetRoiId !== retarget.id) {
              rescueState.retargetCount = Number(rescueState.retargetCount || 0) + 1;
              if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
              rescueState.targetHistory.push({
                frameId,
                targetRoiId: retarget.id,
                previousTargetRoiId,
                reason: "scheduled-retarget",
              });
              if (rescueState.targetHistory.length > 96) rescueState.targetHistory = rescueState.targetHistory.slice(-96);
            }
          }
        }

        const target = SUB_ROIS.find((roi) => roi.id === rescueState.targetRoiId) || null;
        if (target) {
          const variants = [];
          for (let i = 0; i < LOCAL_RESCUE_VARIANTS_PER_FRAME; i += 1) {
            variants.push(LOCAL_RESCUE_VARIANTS[
              (rescueState.variantCursor + i) % LOCAL_RESCUE_VARIANTS.length
            ]);
          }
          rescueState.variantCursor =
            (rescueState.variantCursor + LOCAL_RESCUE_VARIANTS_PER_FRAME) %
            LOCAL_RESCUE_VARIANTS.length;
          rescueState.rescueFrameCount += 1;
          rescueState.lastRescueFrame = frameId;

          for (const variant of variants) {
            const cropRoi = rescueRoiFromVariant(target, variant);
            const rescueCanvas = cropRescueRoi(canvas, cropRoi, variant.scale);
            const variantStats = rescueState.variantStats[variant.id];
            rescueState.zxingAttemptCount += 1;
            variantStats.attempts += 1;
            const rescueAttempt = {
              attemptIndex: rescueState.zxingAttemptCount,
              frameId,
              targetRoiId: target.id,
              variantId: variant.id,
              subRoiId: `rescue-${target.id}-${variant.id}`,
              engine: "zxing",
              cropRoi: {
                x: Number(cropRoi.x.toFixed(4)),
                y: Number(cropRoi.y.toFixed(4)),
                w: Number(cropRoi.w.toFixed(4)),
                h: Number(cropRoi.h.toFixed(4)),
              },
              cropPixelWidth: rescueCanvas.width,
              cropPixelHeight: rescueCanvas.height,
              upscaleScale: Number(variant.scale || 1),
              grayscaleVariant: false,
              thresholdVariant: false,
              quality: frameQuality(rescueCanvas),
              zxingDecodeMs: null,
              guideRegion: guide2DLabel(
                cropRoi.x + cropRoi.w / 2,
                cropRoi.y + cropRoi.h / 2
              ),
              rawHitCount: 0,
              hitDiagnosticIds: [],
            };
            try {
              const decodeStartedAt = performance.now();
              const zxHits = await decodeZxing(readerRef.current, rescueCanvas);
              rescueAttempt.zxingDecodeMs = Number((performance.now() - decodeStartedAt).toFixed(2));
              rescueAttempt.rawHitCount = zxHits.length;
              rescueState.rawSuccessCount += zxHits.length;
              variantStats.rawSuccesses += zxHits.length;
              for (const hit of zxHits) {
                if (hit.canonical) {
                  rescueAttempt.hitDiagnosticIds.push(
                    countingDiagnosticId(countingIntegrityRef.current, hit.canonical)
                  );
                }
                if (!hit.canonical) continue;
                const rescueSubRoiId = `rescue-${target.id}-${variant.id}`;
                const rescueDiagnosticMetrics = rawDiagnosticMetrics(hit.canonical, []);
                recordRawDiagnosticHits(
                  countingIntegrityRef.current,
                  frameId,
                  rescueSubRoiId,
                  cropRoi,
                  [{
                    engine: "zxing",
                    localPosition: hit.localPosition,
                    ...rescueDiagnosticMetrics,
                  }],
                  "rescue"
                );
                const structural = structuralValidation(hit.canonical);
                if (structural.pass) {
                  rescueState.structuralSuccessCount += 1;
                  variantStats.structuralSuccesses += 1;
                }
                const alreadyKnown = evidenceRef.current.has(hit.canonical);
                const alreadyNormalThisFrame = grouped.has(hit.canonical);
                if (structural.pass && !alreadyKnown && !alreadyNormalThisFrame) {
                  rescueState.novelCanonicalCount += 1;
                  rescueState.lastNovelRescueFrame = frameId;
                  variantStats.novelCanonicalCount += 1;
                }
                if (!grouped.has(hit.canonical)) {
                  grouped.set(hit.canonical, { engines: new Set(), hits: [] });
                }
                grouped.get(hit.canonical).engines.add(hit.engine);
                grouped.get(hit.canonical).hits.push({
                  ...hit,
                  subRoiId: rescueSubRoiId,
                  guidePosition: guidePositionFromHit(hit, cropRoi),
                });
              }
            } finally {
              if (!Array.isArray(rescueState.attemptLog)) rescueState.attemptLog = [];
              rescueAttempt.hitDiagnosticIds = [...new Set(rescueAttempt.hitDiagnosticIds)];
              rescueState.attemptLog.push(rescueAttempt);
              if (rescueState.attemptLog.length > 600) rescueState.attemptLog = rescueState.attemptLog.slice(-600);
              rescueCanvas.width = 1;
              rescueCanvas.height = 1;
            }
          }
        }
      } else if (!remainingOne) {
        rescueState.active = false;
        rescueState.targetRoiId = null;
      }

      setLocalRescueUi(localRescueSnapshot(rescueState));

      const evidenceUpdate = updateEvidence(frameId, grouped, q, selectedRois);

      for (const [canonical, group] of grouped.entries()) {
        const evidence = evidenceRef.current.get(canonical);
        if (!evidence?.confirmed) continue;
        for (const hit of group.hits) {
          if (!hit.guidePosition) continue;
          const rawDiagnosticId =
            countingIntegrityRef.current.diagnosticIdByDecoded.get(canonical) ||
            countingDiagnosticId(countingIntegrityRef.current, canonical);
          recentDecodedPositionsRef.current.push({
            diagnosticId: rawDiagnosticId,
            x: Number(hit.guidePosition.nx),
            y: Number(hit.guidePosition.ny),
            frameId,
          });
        }
      }
      if (recentDecodedPositionsRef.current.length > 240) {
        recentDecodedPositionsRef.current = recentDecodedPositionsRef.current.slice(-240);
      }

      if (!evidenceUpdate.completion.complete && frameId % PHYSICAL_LOCATOR_EVERY_FRAMES === 0) {
        runPhysicalLocator(frameId, canvas);
      }

      const structuralHit = Boolean(evidenceUpdate.structuralHit);
      const decodeMs = Math.round(performance.now() - started);
      setFrameStats((prev) => ({
        processed: prev.processed + 1,
        decoded: prev.decoded + (structuralHit ? 1 : 0),
        lastDecodeMs: decodeMs,
        subRoiFrameAttempts: prev.subRoiFrameAttempts + selectedRois.length,
      }));
      const productionShapeAfterFrame = productionShapeCandidateSnapshot(
        countingIntegrityRef.current,
        evidenceRef.current,
        physicalLocatorUi,
        cameraStopSourceRef.current
      );
      if (evidenceUpdate.completion.complete) {
        if (!completionStoppedRef.current) {
          completionStoppedRef.current = true;
          cameraStopSourceRef.current = "current-completion";
          setCameraStopSource("current-completion");
          stopStreamAndDecodeLoop("QR取得完了");
        }
      } else if (productionShapeAfterFrame.productionShapeStopConditionPass) {
        if (!completionStoppedRef.current) {
          completionStoppedRef.current = true;
          cameraStopSourceRef.current = "production-shape-matched";
          setCameraStopSource("production-shape-matched");
          stopStreamAndDecodeLoop("QR取得完了");
        }
      } else if (localRescueRef.current.active) setStatus("残り1件：局所探索中");
      else if (structuralHit) setStatus("QR取得・蓄積中");
      else if (q.label === "soft") setStatus("読取中：もう少しピントを合わせる");
      else if (q.label === "dark") setStatus("読取中：明るい位置へ");
      else if (q.label === "bright") setStatus("読取中：反射を避ける");
      else setStatus("読取中");
    } catch (error) {
      setStatus(`decode error: ${error?.message || error}`);
    } finally {
      processingRef.current = false;
    }
  };

  const scheduleLoop = () => {
    if (!runningRef.current) return;
    const video = videoRef.current;
    if (video?.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(async () => {
        await processFrame();
        scheduleLoop();
      });
      return;
    }
    const id = setTimeout(async () => {
      timersRef.current.delete(id);
      await processFrame();
      scheduleLoop();
    }, 100);
    timersRef.current.add(id);
  };

  const startCamera = async () => {
    if (runningRef.current) return;
    completionStoppedRef.current = false;
    setStatus("カメラ起動中");
    try {
      const [reader, jsMod] = await Promise.all([makeReader(), import("jsqr")]);
      readerRef.current = reader;
      jsQrRef.current = jsMod.default || jsMod;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setCameraInfo({ width: video.videoWidth || 0, height: video.videoHeight || 0 });
      runningRef.current = true;
      setRunning(true);
      setStatus("読取中");
      lastProcessedRef.current = 0;
      scheduleLoop();
    } catch (error) {
      stopCamera();
      setStatus(`カメラ起動失敗: ${error?.message || error}`);
    }
  };

  const restartScan = async () => {
    resetEvidence();
    await startCamera();
  };

  const buildDiagnosticSnapshot = () => {
    let runtimeHead = null;
    try {
      runtimeHead = new URLSearchParams(window.location.search).get("head");
    } catch {}
    return {
      schema: "icb-certificate-qr-live-scan-poc-v2",
      revision: LIVE_SCAN_REVISION,
      evaluation: {
        branch: EVALUATION_BRANCH,
        head: runtimeHead,
        baseline: LIVE_BASELINE_HEAD,
      },
      route: "/eval/certificate-qr-live-scan",
      privacy: {
        browserMemoryOnly: true,
        payloadIncluded: false,
        imageIncluded: false,
        externalUpload: false,
      },
      camera: cameraInfo,
      frameIntervalMs: FRAME_INTERVAL_MS,
      guideRoiNormalized: GUIDE_ROI,
      spatialSearch: {
        strategy: "five-overlapping-horizontal-sub-rois-priority-rotated",
        subRoisPerProcessedFrame: SUB_ROIS_PER_FRAME,
        subRois: SUB_ROIS,
        confirmedRegionPolicy: "deprioritize-not-exclude",
        starvationProtection: true,
      },
      physicalSlotGuidanceDiagnosticOnly: physicalSlotGuide,
      countingIntegrityDiagnostic: countingIntegritySnapshot(
        countingIntegrityRef.current,
        evidenceRef.current,
        physicalLocatorUi
      ),
      parserSeparatedEvaluation: parserSeparationCounterfactualSnapshot(
        countingIntegrityRef.current,
        evidenceRef.current
      ),
      unknownSafeStrictEvaluation: unknownSafeStrictSnapshot(
        countingIntegrityRef.current,
        evidenceRef.current
      ),
      productionShapeCandidate: productionShapeCandidateSnapshot(
        countingIntegrityRef.current,
        evidenceRef.current,
        physicalLocatorUi,
        cameraStopSourceRef.current
      ),
      physicalQrLocator: {
        mode: "finder-pattern-triplet-2d",
        decodeIndependent: true,
        guideRoiOnly: true,
        everyProcessedFrames: PHYSICAL_LOCATOR_EVERY_FRAMES,
        analysisMaxWidth: PHYSICAL_LOCATOR_MAX_WIDTH,
        trackTtlFrames: PHYSICAL_LOCATOR_TRACK_TTL_FRAMES,
        decodeMatchWindowFrames: PHYSICAL_LOCATOR_DECODE_MATCH_WINDOW_FRAMES,
        current: physicalLocatorUi,
        averageLatencyMs: physicalLocatorStatsRef.current.runs
          ? Number((physicalLocatorStatsRef.current.totalLatencyMs / physicalLocatorStatsRef.current.runs).toFixed(2))
          : null,
        payloadUsedForLocator: false,
      },
      remainingOneLatencyDiagnostic: remainingOneLatencyDiagnostic(
        countingIntegrityRef.current,
        parserSeparationCounterfactualSnapshot(
          countingIntegrityRef.current,
          evidenceRef.current
        ),
        localRescueRef.current
      ),
      remainingOneLocalRescue: {
        provisionalTrigger: true,
        triggerRule: "expected known AND confirmedCount = expected-1 AND no new structural canonical for >=16 processed frames",
        stallFrames: LOCAL_RESCUE_STALL_FRAMES,
        decoder: "zxing-priority-only",
        variantsPerRescueFrame: LOCAL_RESCUE_VARIANTS_PER_FRAME,
        retargetEveryRescueFrames: LOCAL_RESCUE_RETARGET_EVERY_FRAMES,
        variants: LOCAL_RESCUE_VARIANTS.map(({id,scale}) => ({id,scale})),
        diagnostics: localRescueSnapshot(localRescueRef.current),
        fullFramePreprocessingSweep: false,
        qualityHardGate: false,
      },
      processedFrameCount: frameStats.processed,
      structuralDecodeFrameCount: frameStats.decoded,
      subRoiFrameAttemptCount: frameStats.subRoiFrameAttempts,
      confirmedQrCount: confirmedCount,
      completion: {
        kind: kindEvidence.kind,
        expectedQrCount: kindEvidence.expected,
        complete,
      },
      evidence: candidates,
      subRoiDiagnostics: subRoiStatsSnapshot(subRoiStatsRef.current),
      latestFrameQuality: quality,
      qualityAllFrames: qualitySummary(qualityFramesRef.current),
      qualitySuccessfulFrames: qualitySummary(successQualityFramesRef.current),
      diagnosticPolicies: {
        decodeHardQualityGate: false,
        confirmationRule: "same-canonical both-engines in one frame OR same-canonical structural-pass in >=2 frames",
        dedupeRule: "exact canonical in browser memory",
        completionRuleStatus: "PoC provisional; registered=5 / kei=6 is not formal specification",
        gtUsedInDecodeOrControl: false,
      },
    };
  };

  const copyManagementShort = async () => {
    const full = buildDiagnosticSnapshot();
    const short = managementShortFromLiveFull(full, full?.evaluation?.head || null);
    await navigator.clipboard.writeText(JSON.stringify(short, null, 2));
    setStatus("総合管理用短縮summaryをコピーしました");
  };

  const copyDiagnostic = async () => {
    const snapshot = buildDiagnosticSnapshot();
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    setStatus("詳細診断JSONをコピーしました");
  };

  const convertExistingFullJson = () => {
    try {
      const parsed = JSON.parse(fullJsonInput);
      let runtimeHead = null;
      try {
        runtimeHead = new URLSearchParams(window.location.search).get("head");
      } catch {}
      const short = managementShortFromLiveFull(parsed, runtimeHead);
      setConvertedShort(JSON.stringify(short, null, 2));
      setStatus("既存Full JSONから短縮summaryを生成しました");
    } catch (error) {
      setConvertedShort("");
      setStatus(`JSON変換失敗: ${error?.message || error}`);
    }
  };

  const copyConvertedShort = async () => {
    if (!convertedShort) return;
    await navigator.clipboard.writeText(convertedShort);
    setStatus("変換済み短縮summaryをコピーしました");
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>車検証 Guided Live QR Scan PoC v2</h1>
      <p style={{ margin: "0 0 8px", color: "#555", fontSize: 14 }}>
        decode-integrity / parser-schema分離評価専用。CURRENTのdecode/dedupe/completionは変更していません。
      </p>
      <div style={{ marginBottom: 12, padding: 9, borderRadius: 9, background: "#fff4d6", fontSize: 12, lineHeight: 1.5 }}>
        評価専用です。slash schemaはCurrent側では従来通り必須のままです。
        PARSER_SEPARATED側だけdecode integrityとparser schemaを分離します。payload本文・画像はsummaryへ出しません。
      </div>
      <section style={{
        marginBottom: 12,
        padding: "12px 14px",
        border: "1px solid #d8d8d8",
        borderRadius: 12,
        background: "#fafafa",
      }}>
        <div style={{ fontSize: 14, color: "#555" }}>QR取得状況</div>
        <div style={{ marginTop: 2, fontSize: 30, fontWeight: 950 }}>
          {productionShapeUi.confirmedCanonicalCount}
          {productionShapeUi.expectedQrCount != null ? ` / ${productionShapeUi.expectedQrCount}` : ""}
        </div>
        <div style={{ marginTop: 5, fontSize: 15, fontWeight: 800 }}>
          {productionShapeUi.qrAcquisitionState === "matched"
            ? "QR取得完了"
            : productionShapeUi.qrAcquisitionState === "over-count-review"
              ? "QR数を確認してください"
              : productionShapeUi.qrAcquisitionState === "kind-ambiguous"
                ? "車種判定を確認中"
                : productionShapeUi.qrAcquisitionState === "accounting-integrity-fail"
                  ? "読取集計を確認中"
                  : "QRを読み取り中"}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: "#666" }}>
          {productionShapeUi.payloadInterpretationState.complete
            ? "QR内容の解釈完了"
            : productionShapeUi.qrAcquisitionComplete
              ? "車検証情報を確認中"
              : "残りのQRをガイド内へ入れてください"}
        </div>
      </section>

      <section style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#111", aspectRatio: "4 / 3" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "4%",
            top: "43%",
            width: "92%",
            height: "44%",
            border: "3px solid rgba(52,199,89,.95)",
            borderRadius: 12,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        >
          {locatorOverlayTracks.map((track) => {
            const displayRead = Boolean(track.everDecoded || track.decoded);
            const matchedDiagnosticId = track.lastMatchedDiagnosticId || track.matchedDiagnosticId || null;
            const matchedSlot = productionShapeUi.physicalSlotUi.slots.find((slot) =>
              slot.diagnosticId && slot.diagnosticId === matchedDiagnosticId
            );
            const slotOrdinal = matchedSlot?.displayOrdinal ?? null;
            const undecoded = !displayRead;
            const border = displayRead
              ? "3px solid rgba(52,199,89,.98)"
              : track.confidence === "high"
                ? "3px solid rgba(255,193,7,.98)"
                : "2px dashed rgba(255,193,7,.92)";
            return (
              <div
                key={track.trackId}
                style={{
                  position: "absolute",
                  left: `${Math.max(0, (track.x - track.w / 2) * 100)}%`,
                  top: `${Math.max(0, (track.y - track.h / 2) * 100)}%`,
                  width: `${Math.min(100, track.w * 100)}%`,
                  height: `${Math.min(100, track.h * 100)}%`,
                  boxSizing: "border-box",
                  border,
                  borderRadius: 7,
                  background: displayRead ? "rgba(52,199,89,.08)" : "rgba(255,193,7,.10)",
                }}
              >
                <div style={{
                  position: "absolute",
                  right: -9,
                  top: -13,
                  minWidth: 24,
                  height: 24,
                  padding: "0 5px",
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  background: displayRead ? "rgba(52,199,89,.98)" : "rgba(255,193,7,.98)",
                  color: displayRead ? "#fff" : "#3b2a00",
                  fontSize: displayRead ? 16 : 10,
                  fontWeight: 950,
                  boxShadow: "0 1px 4px rgba(0,0,0,.35)",
                }}>
                  {displayRead
                    ? `${slotOrdinal != null ? ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩"][slotOrdinal - 1] || "" : ""}✓`
                    : undecoded ? "読取中" : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{
          position: "absolute",
          left: 10,
          top: 10,
          padding: "6px 9px",
          borderRadius: 8,
          background: "rgba(0,0,0,.68)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 13,
        }}>
          {status}
        </div>
        {running && !complete && (
          <div style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10,
            padding: "9px 11px",
            borderRadius: 10,
            background: "rgba(0,0,0,.76)",
            color: "#fff",
            textAlign: "center",
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.45,
          }}>
            <div>
              {productionShapeUi.expectedQrCount != null
                ? `${productionShapeUi.confirmedCanonicalCount} / ${productionShapeUi.expectedQrCount} QR取得証拠`
                : `${productionShapeUi.confirmedCanonicalCount}件 QR取得証拠`}
            </div>
            {locatorPrimaryTarget ? (
              <>
                <div style={{ marginTop: 2, color: "#ffd54f" }}>
                  {guide2DLabel(locatorPrimaryTarget.x, locatorPrimaryTarget.y)}に
                  未decodeのQR候補があります。そこをガイドへ合わせてください
                </div>
                <div style={{ marginTop: 1, fontSize: 11, fontWeight: 600, color: "#ddd" }}>
                  黄色枠は現在frame上のphysical QR候補です。
                  {locatorPrimaryTarget.confidence === "high" ? "確信度 高" : "確信度 中"}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 2, fontSize: 12, color: "#ddd" }}>
                2D QR候補を検出中です。緑枠＋✓は取得済みcandidateです。
              </div>
            )}
          </div>
        )}
      </section>

      <canvas ref={canvasRef} style={{ display: "none" }} />

      <section style={{
        marginTop: 12,
        padding: "11px 12px",
        border: "1px solid #ddd",
        borderRadius: 12,
        background: "#fafafa",
      }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>QR位置</div>
        <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
          {productionShapeUi.physicalSlotUi.slots.length ? productionShapeUi.physicalSlotUi.slots.map((slot, index) => {
            const ordinals = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩"];
            return (
              <div key={`${slot.trackId || "uncertain"}-${index}`} style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "9px 10px",
                borderRadius: 9,
                border: slot.status === "読取済" ? "1px solid #9bd5a8" : slot.status === "未読" ? "1px solid #e6c35b" : "1px solid #ccc",
                background: slot.status === "読取済" ? "#f2fbf4" : slot.status === "未読" ? "#fff9e6" : "#f5f5f5",
              }}>
                <span style={{ fontWeight: 800 }}>
                  {slot.displayOrdinal != null ? `${ordinals[slot.displayOrdinal - 1] || ""} ` : ""}
                  {slot.positionLabel}
                </span>
                <span>{slot.status === "読取済" ? "✓ 読取済" : slot.status}</span>
              </div>
            );
          }) : (
            <div style={{ color: "#666" }}>QR位置を確認中です。</div>
          )}
        </div>
        {productionShapeUi.physicalSlotUi.duplicateIdentityWarning && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#8a5a00" }}>
            physical位置のidentityに重複候補があります。番号は確定表示しません。
          </div>
        )}
        {!productionShapeUi.physicalSlotUi.identityStable && productionShapeUi.physicalSlotUi.uncertainCount > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            位置が不安定なQRは「位置不確定」と表示しています。
          </div>
        )}
      </section>

      {(complete || productionShapeUi.qrAcquisitionComplete) ? (
        <section style={{
          marginTop: 14,
          padding: "22px 16px",
          border: "2px solid #2e7d32",
          borderRadius: 14,
          textAlign: "center",
          background: "#f3fbf4",
        }}>
          <div style={{ fontSize: 30, fontWeight: 950 }}>
            {productionShapeUi.qrAcquisitionComplete ? "✓ QR取得完了" : "QR取得を確認中"}
          </div>
          <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800 }}>
            {productionShapeUi.payloadInterpretationState.complete
              ? "QR内容の解釈完了"
              : "車検証情報を確認中"}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>
            CURRENT制御によりカメラとQR解析は停止しています。
            Vehicle Field StateはこのPoCではまだ正式評価していません。
          </div>
          <button onClick={restartScan} style={{ marginTop: 16, padding: "11px 18px", fontWeight: 900 }}>
            もう一度読み取る
          </button>
        </section>
      ) : (
        <section style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={startCamera} disabled={running} style={{ padding: "10px 14px", fontWeight: 800 }}>
            カメラ開始
          </button>
          <button onClick={stopCamera} disabled={!running} style={{ padding: "10px 14px", fontWeight: 800 }}>
            停止
          </button>
          <button onClick={resetEvidence} style={{ padding: "10px 14px", fontWeight: 800 }}>
            読取リセット
          </button>
        </section>
      )}
      <section style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button onClick={copyManagementShort} style={{ padding: "11px 15px", fontWeight: 900 }}>
          総合管理用短縮summaryをコピー
        </button>
        <button onClick={copyDiagnostic} style={{ padding: "9px 13px", fontWeight: 650 }}>
          詳細診断JSONをコピー
        </button>
      </section>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>既存Full JSONから短縮summary生成</summary>
        <div style={{ marginTop: 8 }}>
          <textarea
            value={fullJsonInput}
            onChange={(event) => setFullJsonInput(event.target.value)}
            placeholder="既存のFull Diagnostic JSONをここへ貼り付け"
            style={{ width: "100%", minHeight: 120, boxSizing: "border-box", fontFamily: "monospace", fontSize: 11 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 7 }}>
            <button onClick={convertExistingFullJson} disabled={!fullJsonInput.trim()} style={{ padding: "8px 12px", fontWeight: 700 }}>
              短縮summary生成
            </button>
            <button onClick={copyConvertedShort} disabled={!convertedShort} style={{ padding: "8px 12px", fontWeight: 700 }}>
              生成した短縮summaryをコピー
            </button>
          </div>
          {convertedShort && (
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 10, maxHeight: 260, overflow: "auto", background: "#f7f7f7", padding: 8 }}>
              {convertedShort}
            </pre>
          )}
        </div>
      </details>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800, padding: "10px 0" }}>診断詳細を表示</summary>
        <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontWeight: 900 }}>CURRENT vs PARSER_SEPARATED</div>
          <div style={{ marginTop: 8, padding: 9, borderRadius: 9, background: "#eef7ff", fontSize: 13, lineHeight: 1.6 }}>
            <strong>UNKNOWN_SAFE_STRICT</strong>
            {" ／ "}recognized {unknownSafeStrictUi.recognizedConfirmedCount}
            {" ／ "}eligible unknown {unknownSafeStrictUi.eligibleUnknownSafeCount}
            {" ／ "}total {unknownSafeStrictUi.totalCandidateConfirmed}/{unknownSafeStrictUi.expectedQrCount ?? "?"}
            {" ／ "}exact {unknownSafeStrictUi.exactExpected ? "YES" : "NO"}
            {" ／ "}completion {unknownSafeStrictUi.completionEligible ? "PASS" : "HOLD"}
            {" ／ "}overflow {unknownSafeStrictUi.overflow ? "YES" : "NO"}
            {" ／ "}underflow {unknownSafeStrictUi.underflow ? "YES" : "NO"}
            {" ／ "}duplicate {unknownSafeStrictUi.duplicateIntegrityPass ? "PASS" : "FAIL"}
            {" ／ "}current regression {unknownSafeStrictUi.currentRegression ? "YES" : "NO"}
            <div>holdReasons: {(unknownSafeStrictUi.holdReasons || []).join(", ") || "none"}</div>
            <div>rejectReasons: {JSON.stringify(unknownSafeStrictUi.rejectReasonCounts || {})}</div>
          </div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            CURRENT {parserSeparationUi.currentConfirmedCount}/{parserSeparationUi.currentCompletion.expectedQrCount ?? "?"}
            {" ／ "}PARSER_SEPARATED {parserSeparationUi.separatedConfirmedCount}/{parserSeparationUi.separatedCompletion.expectedQrCount ?? "?"}
            {" ／ "}raw {parserSeparationUi.rawUniqueCount}
            {" ／ "}integrity-safe {parserSeparationUi.decodeIntegritySafeUniqueCount}
            {" ／ "}recognized {parserSeparationUi.recognizedSchemaUniqueCount}
            {" ／ "}unrecognized-safe {parserSeparationUi.unrecognizedSafeUniqueCount}
            {" ／ "}accounting {parserSeparationUi.accountingIntegrityPass ? "PASS" : "FAIL"}
          </div>
        </section>
        <section style={{ marginTop: 10, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>
          {complete ? "CURRENT取得完了" : "CURRENT読取中"}：{confirmedCount} / {kindEvidence.expected ?? "?"}
        </div>
        <div style={{ marginTop: 4, fontSize: 14 }}>
          判定：{kindEvidence.label} ／ 処理frame {frameStats.processed} ／ QR検出frame {frameStats.decoded}
          ／ sub-ROI試行 {frameStats.subRoiFrameAttempts}
          {frameStats.lastDecodeMs != null ? ` ／ 直近 ${frameStats.lastDecodeMs}ms` : ""}
        </div>
        {quality && (
          <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
            quality={quality.label} ／ edge={quality.edgeStrength} ／ lap={quality.laplacianVariance} ／
            luma={quality.lumaMean} ／ std={quality.lumaStdDev}
          </div>
        )}
      </section>

      <section style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>sub-ROI diagnostic</h2>
        <div style={{ display: "grid", gap: 6 }}>
          {subRoiStats.map((item) => (
            <div key={item.subRoiId} style={{ fontSize: 12, padding: 8, border: "1px solid #e1e1e1", borderRadius: 8 }}>
              <b>{item.subRoiId}</b> ／ frame {item.frameAttempts} ／ ZXing {item.zxingRawSuccesses}/{item.zxingAttempts}
              ／ jsQR {item.jsqrRawSuccesses}/{item.jsqrAttempts} ／ structural {item.structuralSuccesses}
              ／ novel {item.novelCanonicalCount}
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>蓄積QR（payload非表示）</h2>
        {candidates.length === 0 ? (
          <div style={{ color: "#666" }}>まだQR evidenceはありません。</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {candidates.map((item) => (
              <div key={item.diagnosticId} style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  {item.diagnosticId} ／ {item.confirmed ? "confirmed" : "candidate"} ／ {item.parserSchemaClass}
                </div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 3 }}>
                  {item.fingerprint} ／ length {item.payloadLength} ／ frames {item.frameHitCount} ／
                  jsQR {item.jsqrFrameCount} ／ ZXing {item.zxingFrameCount} ／ both {item.bothEngineFrameCount}
                  ／ first {item.firstSeenSubRoiId || "?"}/{item.firstSeenEngine || "?"}/f{item.firstSeenFrame}
                  {item.medianGuideX != null ? ` ／ x≈${item.medianGuideX}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: 16, padding: 12, background: "#f7f7f7", borderRadius: 12, fontSize: 13, lineHeight: 1.6 }}>
        <strong>PoCルール</strong><br />
        ・QR列を5つのoverlap sub-ROIへ分割し、未取得regionを優先探索<br />
        ・confirmed済み位置は優先度を下げるが除外しない<br />
        ・同一canonicalはbrowser-memory内でdedupe<br />
        ・同一frameで両engine一致、または2frame以上で同一canonical再現するとconfirmed<br />
        ・品質値はhard gateに使わず、decode成功条件の分析用に記録<br />
        ・画像/payloadを外部送信しない<br />
        ・Ground Truthをdecode/control flowに使用しない
      </section>
      </details>
    </main>
  );
}
