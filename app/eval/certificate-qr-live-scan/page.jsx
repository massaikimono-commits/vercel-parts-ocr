"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LIVE_SCAN_REVISION = "live-poc-v2-counting-integrity-diagnostic-1";
const COUNTING_INTEGRITY_SCHEMA = "icb-certificate-qr-live-counting-integrity-v1";
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
  return {
    decoded,
    rawByteLength: Array.from(bytes || []).length,
    decodedTextLength: length,
    slashCount,
    slashFieldCount,
    printableRatio: Number(printableRatio.toFixed(4)),
    replacementCount,
    controlCount,
    parserSchemaClass: parser.parserSchemaClass,
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

function recordRawDiagnosticHits(state, frameId, subRoiId, roi, hits = []) {
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
        positions: [],
        rawByteLengths: [],
        decodedTextLengths: [],
        slashCounts: [],
        slashFieldCounts: [],
        printableRatios: [],
        replacementCounts: [],
        controlCounts: [],
        parserSchemaClasses: new Set(),
        structuralPass: Boolean(hit.structuralPass),
        structuralFailReasons: new Map(),
      };
      state.rawCandidates.set(diagnosticId, candidate);
    }
    candidate.lastSeenFrame = frameId;
    candidate.frameIds.add(frameId);
    if (hit.engine === "jsqr") candidate.jsqrFrames.add(frameId);
    if (hit.engine === "zxing") candidate.zxingFrames.add(frameId);
    candidate.rawByteLengths.push(hit.rawByteLength);
    candidate.decodedTextLengths.push(hit.decodedTextLength);
    candidate.slashCounts.push(hit.slashCount);
    candidate.slashFieldCounts.push(hit.slashFieldCount);
    candidate.printableRatios.push(hit.printableRatio);
    candidate.replacementCounts.push(hit.replacementCount);
    candidate.controlCounts.push(hit.controlCount);
    candidate.parserSchemaClasses.add(hit.parserSchemaClass);
    candidate.structuralPass = candidate.structuralPass || Boolean(hit.structuralPass);
    candidate.structuralFailReasons.set(
      hit.structuralFailReason,
      Number(candidate.structuralFailReasons.get(hit.structuralFailReason) || 0) + 1
    );
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
      rawByteLengthMedian: medianNumber(candidate.rawByteLengths),
      decodedTextLengthMedian: medianNumber(candidate.decodedTextLengths),
      slashCountMedian: medianNumber(candidate.slashCounts),
      slashFieldCountMedian: medianNumber(candidate.slashFieldCounts),
      printableRatioMedian: medianNumber(candidate.printableRatios),
      replacementCountMax: candidate.replacementCounts.length ? Math.max(...candidate.replacementCounts) : 0,
      controlCountMax: candidate.controlCounts.length ? Math.max(...candidate.controlCounts) : 0,
      parserSchemaClasses: schemaClasses,
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
    .filter((track) => !track.decoded)
    .sort((a, b) => {
      const rank = { high: 2, medium: 1, low: 0 };
      return (rank[b.confidence] - rank[a.confidence]) || (b.confidenceScore - a.confidenceScore);
    }), [locatorVisibleTracks]);

  const locatorPrimaryTarget = locatorUndecodedTracks[0] || null;

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
        matchedDiagnosticId: frameId <= Number(track.decodedThroughFrame || -1) ? track.matchedDiagnosticId : null,
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
      const diagnosticRawHits = [];
      for (const roi of selectedRois) {
        const stats = subRoiStatsRef.current.get(roi.id);
        stats.frameAttempts += 1;
        stats.lastAttemptFrame = frameId;
        const subCanvas = cropSubRoi(canvas, roi);
        try {
          stats.jsqrAttempts += 1;
          stats.zxingAttempts += 1;
          const [jsHits, zxHits, diagnosticJsRaw, diagnosticZxRaw] = await Promise.all([
            Promise.resolve(decodeJsMulti(jsQrRef.current, subCanvas, 3)),
            decodeZxing(readerRef.current, subCanvas),
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
          diagnosticRawHits.push(...diagnosticJsRaw, ...diagnosticZxRaw);
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
        }
      }

      if (rescueState.active && remainingOne) {
        if (
          rescueState.rescueFrameCount > 0 &&
          rescueState.rescueFrameCount % LOCAL_RESCUE_RETARGET_EVERY_FRAMES === 0
        ) {
          const retarget = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
          if (retarget) rescueState.targetRoiId = retarget.id;
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
            try {
              const zxHits = await decodeZxing(readerRef.current, rescueCanvas);
              rescueState.rawSuccessCount += zxHits.length;
              variantStats.rawSuccesses += zxHits.length;
              for (const hit of zxHits) {
                if (!hit.canonical) continue;
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
                  subRoiId: `rescue-${target.id}-${variant.id}`,
                  guidePosition: guidePositionFromHit(hit, cropRoi),
                });
              }
            } finally {
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
          recentDecodedPositionsRef.current.push({
            diagnosticId: evidence.diagnosticId,
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
      if (evidenceUpdate.completion.complete) {
        if (!completionStoppedRef.current) {
          completionStoppedRef.current = true;
          stopStreamAndDecodeLoop("読み取り完了");
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

  const copyDiagnostic = async () => {
    const snapshot = {
      schema: "icb-certificate-qr-live-scan-poc-v2",
      revision: LIVE_SCAN_REVISION,
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
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    setStatus("診断summaryをコピーしました");
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>車検証 Guided Live QR Scan PoC v2</h1>
      <p style={{ margin: "0 0 8px", color: "#555", fontSize: 14 }}>
        6th QR counting-integrity評価専用。通常decode/dedupe/completionは変更していません。
      </p>
      <div style={{ marginBottom: 12, padding: 9, borderRadius: 9, background: "#fff4d6", fontSize: 12, lineHeight: 1.5 }}>
        このPreviewではH2観測用の並列raw diagnostic decodeを追加しているため、処理速度はbaseline比較に使用しません。
        payload本文・画像はsummaryへ出しません。
      </div>

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
          {locatorVisibleTracks.map((track) => {
            const undecoded = !track.decoded;
            const border = track.decoded
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
                  background: track.decoded ? "rgba(52,199,89,.08)" : "rgba(255,193,7,.10)",
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
                  background: track.decoded ? "rgba(52,199,89,.98)" : "rgba(255,193,7,.98)",
                  color: track.decoded ? "#fff" : "#3b2a00",
                  fontSize: track.decoded ? 16 : 10,
                  fontWeight: 950,
                  boxShadow: "0 1px 4px rgba(0,0,0,.35)",
                }}>
                  {track.decoded ? "✓" : undecoded ? "候補" : ""}
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
              {kindEvidence.expected != null
                ? `${confirmedCount} / ${kindEvidence.expected} 読み取り済み`
                : `${confirmedCount}件 読み取り済み`}
              {provisionalRemaining != null && provisionalRemaining > 0
                ? ` ／ PoC上あと${provisionalRemaining}件`
                : ""}
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

      {!complete && (
        <section style={{
          marginTop: 12,
          padding: "11px 12px",
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fafafa",
        }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>
            2D QR位置：{confirmedCount}{kindEvidence.expected != null ? ` / ${kindEvidence.expected}` : "件"} 読み取り済み
          </div>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: "#555" }}>
            緑枠＋✓＝decode済み候補 ／ 黄色枠＝physical QR候補だが未decode
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: "#666" }}>
            locator candidate {locatorVisibleTracks.length}件
            ／ 未decode候補 {locatorUndecodedTracks.length}件
            {physicalLocatorUi.lastLatencyMs != null ? ` ／ locator ${physicalLocatorUi.lastLatencyMs}ms` : ""}
          </div>
          {locatorPrimaryTarget && (
            <div style={{ marginTop: 7, fontSize: 13 }}>
              <b style={{ color: "#9a6500" }}>
                狙う候補：{guide2DLabel(locatorPrimaryTarget.x, locatorPrimaryTarget.y)}
              </b>
              <span style={{ color: "#666" }}>
                {" "}／ {locatorPrimaryTarget.confidence === "high" ? "確信度 高" : "確信度 中"}
              </span>
            </div>
          )}
        </section>
      )}

      {complete ? (
        <section style={{
          marginTop: 14,
          padding: "22px 16px",
          border: "2px solid #2e7d32",
          borderRadius: 14,
          textAlign: "center",
          background: "#f3fbf4",
        }}>
          <div style={{ fontSize: 30, fontWeight: 950 }}>✓ 読み取り完了</div>
          <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800 }}>
            {confirmedCount}件のQRを取得しました
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>
            カメラとQR解析は停止しています。
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
        <button onClick={copyDiagnostic} style={{ padding: "10px 14px", fontWeight: 800 }}>
          診断summaryをコピー
        </button>
      </section>

      <section style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>
          {complete ? "取得完了" : "読取中"}：{confirmedCount} / {kindEvidence.expected ?? "?"}
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
    </main>
  );
}
