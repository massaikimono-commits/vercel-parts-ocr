"use client";

import { useMemo, useRef, useState } from "react";
import { normalizeCertificateCanvas } from "../../lib/certificate-photo-normalize";
import { detectCertificateQrDensityCandidates2D } from "../../lib/certificate-qr-density-2d.mjs";

const REQUIRED_NAMES = Array.from({ length: 8 }, (_, i) => `IMG_${String(940 + i).padStart(4, "0")}.jpeg`);
const PATHNAME = "/vehicle-workflow-v2";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const GT_OPTIONS = [
  { value: "", label: "未設定", expected: null },
  { value: "kei", label: "軽6QR", expected: 6 },
  { value: "registered", label: "登録車5QR", expected: 5 },
  { value: "kei-legacy", label: "軽旧2QR", expected: 2 },
];
const CONFIGS = [
  { id: "norm-color-small-2x-nearest", source: "normalized", mode: "color", crop: "small", widthRel: .10, scale: 2, interpolation: "nearest" },
  { id: "norm-color-medium-2x-nearest", source: "normalized", mode: "color", crop: "medium", widthRel: .13, scale: 2, interpolation: "nearest" },
  { id: "norm-color-large-2x-nearest", source: "normalized", mode: "color", crop: "large", widthRel: .16, scale: 2, interpolation: "nearest" },
  { id: "raw-color-small-2x-nearest", source: "raw", mode: "color", crop: "small", widthRel: .10, scale: 2, interpolation: "nearest" },
  { id: "raw-color-medium-2x-nearest", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 2, interpolation: "nearest" },
  { id: "raw-color-large-2x-nearest", source: "raw", mode: "color", crop: "large", widthRel: .16, scale: 2, interpolation: "nearest" },
  { id: "raw-color-medium-1x-nearest", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 1, interpolation: "nearest" },
  { id: "raw-color-medium-3x-nearest", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 3, interpolation: "nearest" },
  { id: "raw-contrast-medium-2x-nearest", source: "raw", mode: "contrast", crop: "medium", widthRel: .13, scale: 2, interpolation: "nearest" },
  { id: "raw-binary-medium-2x-nearest", source: "raw", mode: "binary", crop: "medium", widthRel: .13, scale: 2, interpolation: "nearest" },
  { id: "raw-color-medium-2x-smooth", source: "raw", mode: "color", crop: "medium", widthRel: .13, scale: 2, interpolation: "smooth" },
];

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
function cropCandidate(source, pageBounds, candidate, config) {
  const b = pageBounds || { x: 0, y: 0, w: source.width, h: source.height };
  const cropW = Math.max(12, b.w * config.widthRel);
  const cropH = cropW;
  let sx = b.x + b.w * candidate.x - cropW / 2;
  let sy = b.y + b.h * candidate.y - cropH / 2;
  sx = Math.max(0, Math.min(source.width - cropW, sx));
  sy = Math.max(0, Math.min(source.height - cropH, sy));
  const sw = Math.max(1, Math.min(source.width - sx, cropW));
  const sh = Math.max(1, Math.min(source.height - sy, cropH));
  const scale = Math.max(.8, Math.min(3, Number(config.scale) || 1));
  const pad = Math.max(12, Math.round(Math.min(sw, sh) * scale * .08));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  canvas.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = config.interpolation === "smooth";
  if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);

  if (config.mode !== "color") {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      sum += g;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    }
    const avg = sum / Math.max(1, image.data.length / 4);
    const threshold = Math.max(90, Math.min(225, avg - 8));
    for (let p = 0; p < image.data.length; p += 4) {
      const g = image.data[p];
      const v = config.mode === "binary"
        ? (g < threshold ? 0 : 255)
        : Math.max(0, Math.min(255, Math.round((g - 128) * 2.05 + 150)));
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}
function decodeKeyFromJs(result) {
  if (!result) return "";
  const bytes = Array.from(result.binaryData || []);
  if (bytes.length) return "b:" + bytes.join(",");
  return result.data ? "t:" + result.data : "";
}
async function decodeJs(jsQR, canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    const key = decodeKeyFromJs(result);
    return key || null;
  } catch {
    return null;
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
    if (raw.length) return "b:" + raw.join(",");
    const text = result?.getText?.() || result?.text || "";
    return text ? "t:" + text : null;
  } catch {
    return null;
  }
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
async function runMatrix(file) {
  const started = performance.now();
  const raw = await sourceCanvas(file);
  const normalized = normalizeCertificateCanvas(raw, 1800);
  const norm = normalized.canvas;
  const normCtx = norm.getContext("2d", { willReadFrequently: true });
  const normImage = normCtx.getImageData(0, 0, norm.width, norm.height);
  const candidates = detectCertificateQrDensityCandidates2D(normImage.data, normImage.width, normImage.height, { maxCandidates: 8 });
  const [reader, jsMod] = await Promise.all([makeReader(), import("jsqr")]);
  const jsQR = jsMod.default || jsMod;

  const configs = Object.fromEntries(CONFIGS.map((c) => [c.id, {
    ...c,
    jsqrAttempts: 0,
    jsqrSuccesses: 0,
    zxingAttempts: 0,
    zxingSuccesses: 0,
    uniqueKeys: new Set(),
  }]));
  const union = new Set();
  const candidateDiagnostics = [];

  try {
    for (let ci = 0; ci < candidates.length; ci += 1) {
      const candidate = candidates[ci];
      const row = { index: ci + 1, ...candidate, attempts: [], successCount: 0 };
      for (const config of CONFIGS) {
        const source = config.source === "raw" ? raw : norm;
        const bounds = config.source === "raw"
          ? normalized.paper?.bounds
          : { x: 0, y: 0, w: norm.width, h: norm.height };
        const canvas = cropCandidate(source, bounds, candidate, config);
        try {
          const stat = configs[config.id];
          stat.jsqrAttempts += 1;
          const jk = await decodeJs(jsQR, canvas);
          if (jk) {
            stat.jsqrSuccesses += 1;
            stat.uniqueKeys.add(jk);
            union.add(jk);
          }
          stat.zxingAttempts += 1;
          const zk = await decodeZxing(reader, canvas);
          if (zk) {
            stat.zxingSuccesses += 1;
            stat.uniqueKeys.add(zk);
            union.add(zk);
          }
          const success = Boolean(jk || zk);
          if (success) row.successCount += 1;
          row.attempts.push({
            configId: config.id,
            jsqrSuccess: Boolean(jk),
            zxingSuccess: Boolean(zk),
          });
        } finally {
          canvas.width = 1;
          canvas.height = 1;
        }
        await wait(0);
      }
      candidateDiagnostics.push(row);
    }

    return {
      candidates,
      candidateDiagnostics,
      configs: Object.values(configs).map((s) => ({
        id: s.id,
        source: s.source,
        mode: s.mode,
        crop: s.crop,
        widthRel: s.widthRel,
        scale: s.scale,
        interpolation: s.interpolation,
        jsqrAttempts: s.jsqrAttempts,
        jsqrSuccesses: s.jsqrSuccesses,
        zxingAttempts: s.zxingAttempts,
        zxingSuccesses: s.zxingSuccesses,
        uniqueQrCount: s.uniqueKeys.size,
      })),
      matrixUnionQrCount: union.size,
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
function aggregateConfigs(results) {
  const map = new Map();
  for (const result of results) {
    for (const config of result?.matrix?.configs || []) {
      const prev = map.get(config.id) || {
        id: config.id, source: config.source, mode: config.mode, crop: config.crop,
        widthRel: config.widthRel, scale: config.scale, interpolation: config.interpolation,
        qrCountSum: 0, jsqrAttempts: 0, jsqrSuccesses: 0, zxingAttempts: 0, zxingSuccesses: 0,
      };
      prev.qrCountSum += Number(config.uniqueQrCount || 0);
      prev.jsqrAttempts += Number(config.jsqrAttempts || 0);
      prev.jsqrSuccesses += Number(config.jsqrSuccesses || 0);
      prev.zxingAttempts += Number(config.zxingAttempts || 0);
      prev.zxingSuccesses += Number(config.zxingSuccesses || 0);
      map.set(config.id, prev);
    }
  }
  return [...map.values()].sort((a, b) => b.qrCountSum - a.qrCountSum || b.zxingSuccesses - a.zxingSuccesses || b.jsqrSuccesses - a.jsqrSuccesses);
}
function publicResult(result) {
  return {
    fileName: result.fileName,
    groundTruthVehicleKind: result.groundTruthVehicleKind,
    groundTruthExpectedQrCount: result.groundTruthExpectedQrCount,
    baseline: {
      ...result.baseline,
      networkAudit: result.baseline.networkAudit,
      kindMismatch: result.groundTruthVehicleKind ? result.baseline.runtimeVehicleKind !== result.groundTruthVehicleKind : null,
    },
    matrix: result.matrix,
  };
}

export default function CertificateQrDecodeExperimentPage() {
  const [files, setFiles] = useState([]);
  const [groundTruth, setGroundTruth] = useState({});
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("固定8枚を選択してください。");
  const frameRef = useRef(null);

  const normalizedNames = useMemo(() => files.map(normalizeFixedFileName), [files]);
  const nameSet = useMemo(() => new Set(normalizedNames.filter(Boolean)), [normalizedNames]);
  const valid = files.length === 8 && normalizedNames.every(Boolean) && nameSet.size === 8 && REQUIRED_NAMES.every((n) => nameSet.has(n));

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
        const matrix = await runMatrix(file);
        const gt = groundTruth[name] || {};
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

  const aggregate = aggregateConfigs(results);
  const best = aggregate[0] || null;
  const gtReady = results.length === 8 && results.every((r) => Number.isFinite(r.groundTruthExpectedQrCount));
  const totals = gtReady ? results.reduce((acc, r) => {
    acc.expected += r.groundTruthExpectedQrCount;
    acc.baseline += r.baseline.qrCount;
    if (r.baseline.qrCount >= r.groundTruthExpectedQrCount) acc.baselineComplete += 1;
    const bestRow = r.matrix.configs.find((c) => c.id === best?.id);
    const q = Number(bestRow?.uniqueQrCount || 0);
    acc.candidate += q;
    if (q >= r.groundTruthExpectedQrCount) acc.candidateComplete += 1;
    return acc;
  }, { expected: 0, baseline: 0, candidate: 0, baselineComplete: 0, candidateComplete: 0 }) : null;

  const summary = JSON.stringify({
    schema: "icb-certificate-qr-decode-experiment-summary-v1",
    generatedAt: new Date().toISOString(),
    branchRole: "experimental-only",
    pathname: PATHNAME,
    privacy: { imageUpload: false, qrPayloadIncluded: false, browserMemoryOnly: true },
    groundTruth: {
      ready: gtReady,
      runtimeExpectedUsedAsGroundTruth: false,
    },
    bestGlobalConfig: best,
    totals: totals ? {
      ...totals,
      baselineQrRate: totals.expected ? Number((totals.baseline / totals.expected).toFixed(4)) : null,
      candidateQrRate: totals.expected ? Number((totals.candidate / totals.expected).toFixed(4)) : null,
    } : null,
    configAggregate: aggregate,
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
      <p>Baselineは実際の {PATHNAME} → CertificateQrFast。改善候補は同じ画像をブラウザ内だけで dynamic XY / raw vs normalized / crop / scale / interpolation matrix に通します。</p>
      <p><b>禁止:</b> QR payloadの表示・保存・送信。本ページのsummaryは座標・設定・成功/失敗・件数のみです。</p>

      <section style={{ border: "1px solid #ccc", borderRadius: 12, padding: 14 }}>
        <input type="file" accept="image/*" multiple disabled={running} onChange={(e) => setFiles([...e.target.files].slice(0, 8))} />
        <div style={{ marginTop: 8 }}>{files.length}/8 選択</div>
        <div style={{ marginTop: 6, fontSize: 12 }}>正規化後: {normalizedNames.map((n) => n || "判定不可").join(" / ")}</div>
        {valid && (
          <div style={{ marginTop: 12 }}>
            <b>QR Ground Truth（ユーザー確認後に設定）</b>
            {REQUIRED_NAMES.map((name) => (
              <label key={name} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <span style={{ minWidth: 120, fontFamily: "monospace" }}>{name}</span>
                <select value={groundTruth[name]?.vehicleKind || ""} disabled={running} onChange={(e) => setGt(name, e.target.value)}>
                  {GT_OPTIONS.map((o) => <option key={o.value || "unset"} value={o.value}>{o.label}</option>)}
                </select>
                <span style={{ fontSize: 12 }}>expected {groundTruth[name]?.expectedQrCount ?? "未設定"}</span>
              </label>
            ))}
          </div>
        )}
        <button disabled={!valid || running} onClick={start} style={{ marginTop: 14, padding: "10px 18px", fontWeight: 700 }}>
          {running ? "実験中…" : "固定8枚 A/B開始"}
        </button>
        <div style={{ marginTop: 10, fontWeight: 700 }}>{status}</div>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>画像別</h2>
        {results.map((r) => {
          const bestRow = r.matrix.configs.find((c) => c.id === best?.id);
          return (
            <div key={r.fileName} style={{ borderBottom: "1px solid #ddd", padding: "10px 0" }}>
              <b>{r.fileName}</b> — GT {r.groundTruthExpectedQrCount ?? "未設定"} —
              Baseline {r.baseline.qrCount} QR / jsQR {r.baseline.jsqrSuccesses}/{r.baseline.jsqrAttempts} / ZXing {r.baseline.zxingSuccesses}/{r.baseline.zxingAttempts} / {r.baseline.elapsedMs}ms —
              Dynamic candidates {r.matrix.candidates.length} — best-global {bestRow?.uniqueQrCount ?? "-"} QR — matrix union {r.matrix.matrixUnionQrCount} — matrix {r.matrix.elapsedMs}ms
            </div>
          );
        })}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>共通設定ランキング</h2>
        {aggregate.slice(0, 11).map((c, i) => (
          <div key={c.id} style={{ padding: 6, borderBottom: "1px solid #eee" }}>
            {i + 1}. {c.id} — QR count sum {c.qrCountSum} — jsQR {c.jsqrSuccesses}/{c.jsqrAttempts} — ZXing {c.zxingSuccesses}/{c.zxingAttempts}
          </div>
        ))}
      </section>

      <section style={{ marginTop: 18 }}>
        <button disabled={!results.length} onClick={copySummary} style={{ marginRight: 8, padding: "9px 14px" }}>非PII summaryをコピー</button>
        <button disabled={!results.length} onClick={downloadSummary} style={{ padding: "9px 14px" }}>summaryを端末保存</button>
      </section>

      <iframe ref={frameRef} title="baseline certificate QR Fast" style={{ width: "100%", height: 520, border: "1px solid #bbb", marginTop: 20 }} />
      <details style={{ marginTop: 16 }}><summary>非PII summary確認</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{summary}</pre></details>
    </main>
  );
}
