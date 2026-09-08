"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LIVE_SCAN_REVISION = "live-poc-v2-spatial-subroi-search";
const FRAME_INTERVAL_MS = 250;
const MAX_DECODE_DIMENSION = 1280;
const GUIDE_ROI = Object.freeze({ x: .04, y: .43, w: .92, h: .44 });
const SUB_ROIS_PER_FRAME = 3;
const SUB_ROIS = Object.freeze([
  { id: "left", x: 0, y: 0, w: .30, h: 1 },
  { id: "left-mid", x: .175, y: 0, w: .30, h: 1 },
  { id: "center", x: .35, y: 0, w: .30, h: 1 },
  { id: "right-mid", x: .525, y: 0, w: .30, h: 1 },
  { id: "right", x: .70, y: 0, w: .30, h: 1 },
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
  const completionStoppedRef = useRef(false);
  const timersRef = useRef(new Set());

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("停止中");
  const [quality, setQuality] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [frameStats, setFrameStats] = useState({ processed: 0, decoded: 0, lastDecodeMs: null, subRoiFrameAttempts: 0 });
  const [subRoiStats, setSubRoiStats] = useState(subRoiStatsSnapshot(subRoiStatsRef.current));
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

  const confirmedGuideMarkers = useMemo(() => candidates
    .filter((item) => item.confirmed && Number.isFinite(Number(item.medianGuideX)))
    .map((item) => ({
      id: item.diagnosticId,
      x: Math.max(0, Math.min(1, Number(item.medianGuideX))),
    })), [candidates]);

  const guidedTarget = useMemo(() => {
    if (!running || complete) return null;
    const selected = selectSubRois(
      Number(frameStats.processed || 0) + 1,
      evidenceRef.current,
      subRoiStatsRef.current
    );
    const roi = selected[0] || null;
    if (!roi) return null;
    return {
      id: roi.id,
      label: subRoiGuideLabel(roi.id),
      x: roi.x,
      w: roi.w,
    };
  }, [running, complete, frameStats.processed, candidates, subRoiStats]);

  const provisionalRemaining = kindEvidence.expected == null
    ? null
    : Math.max(0, kindEvidence.expected - confirmedCount);

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
    completionStoppedRef.current = false;
    frameSeqRef.current = 0;
    setCandidates([]);
    setQuality(null);
    setSubRoiStats(subRoiStatsSnapshot(subRoiStatsRef.current));
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

      const grouped = new Map();
      for (const hit of allHits) {
        if (!hit.canonical) continue;
        if (!grouped.has(hit.canonical)) grouped.set(hit.canonical, { engines: new Set(), hits: [] });
        grouped.get(hit.canonical).engines.add(hit.engine);
        grouped.get(hit.canonical).hits.push(hit);
      }

      const evidenceUpdate = updateEvidence(frameId, grouped, q, selectedRois);
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
      } else if (structuralHit) setStatus("QR取得・蓄積中");
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
      <p style={{ margin: "0 0 12px", color: "#555", fontSize: 14 }}>
        QR固有spatial search検証用。最終UIではありません。QR列全体をガイド枠内へ入れてください。
      </p>

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
          {running && !complete && guidedTarget && (
            <div
              style={{
                position: "absolute",
                left: `${guidedTarget.x * 100}%`,
                top: 0,
                width: `${guidedTarget.w * 100}%`,
                height: "100%",
                boxSizing: "border-box",
                border: "2px dashed rgba(255,193,7,.95)",
                background: "rgba(255,193,7,.12)",
                borderRadius: 8,
              }}
            />
          )}
          {confirmedGuideMarkers.map((marker) => (
            <div
              key={marker.id}
              style={{
                position: "absolute",
                left: `${marker.x * 100}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "rgba(52,199,89,.96)",
                color: "#fff",
                fontSize: 17,
                fontWeight: 950,
                boxShadow: "0 1px 5px rgba(0,0,0,.35)",
              }}
            >
              ✓
            </div>
          ))}
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
        {running && !complete && guidedTarget && (
          <div style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10,
            padding: "9px 11px",
            borderRadius: 10,
            background: "rgba(0,0,0,.74)",
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
            <div style={{ marginTop: 2, color: "#ffd54f" }}>
              次は{guidedTarget.label}をガイドへ合わせてください
            </div>
            <div style={{ marginTop: 1, fontSize: 11, fontWeight: 600, color: "#ddd" }}>
              黄色は現在の探索優先エリアです。未読QR位置を断定する表示ではありません。
            </div>
          </div>
        )}
      </section>

      <canvas ref={canvasRef} style={{ display: "none" }} />

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
