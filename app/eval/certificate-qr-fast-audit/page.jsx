"use client";

import { useMemo, useRef, useState } from "react";

const REQUIRED_NAMES = Array.from({ length: 8 }, (_, i) => `IMG_${String(940 + i).padStart(4, "0")}.jpeg`);
const PATHNAME = "/vehicle-workflow-v2";
const FAST_WAIT_MS = 12000;
const INTEGRATION_WAIT_MS = 70000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function safeName(file) {
  return String(file?.name || "").replace(/[^A-Za-z0-9._-]/g, "_");
}
function normalizeFixedFileName(file) {
  const original = String(file?.name || "").normalize("NFKC").trim();
  const leaf = original.split(/[\\/]/).pop() || "";
  const match = leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
  if (!match) return null;
  return `IMG_${match[1]}.jpeg`;
}
function safeRequest(url, method, type, base) {
  try {
    const u = new URL(String(url || ""), base);
    return { method: String(method || "GET").toUpperCase(), host: u.host, path: u.pathname, type };
  } catch {
    return { method: String(method || "GET").toUpperCase(), host: "invalid", path: "invalid", type };
  }
}
function stageFromTag(tag = "") {
  const s = String(tag);
  if (s.includes("帯域/norm/y0.755/color/jsQR")) return "normalizedBandJsQR";
  if (s.includes("帯域/norm/y0.785/contrast/jsQR")) return "contrastBand";
  if (s.includes("個別/norm/")) return "normalizedZXing";
  if (s.includes("帯域/raw/y0.74/color/jsQR")) return "rawBandJsQR";
  if (s.includes("個別/raw/")) return "rawZXing";
  if (s.includes("帯域/raw/y0.755/binary/jsQR")) return "binaryBand";
  return "other";
}
function stageCounts(items = []) {
  const out = { normalizedBandJsQR: 0, contrastBand: 0, normalizedZXing: 0, rawBandJsQR: 0, rawZXing: 0, binaryBand: 0, other: 0 };
  for (const item of items) out[stageFromTag(item?.scanTag)] += 1;
  return out;
}
function nonPiiQr(items = []) {
  return items.map((item, index) => ({
    slot: Number.isFinite(Number(item?.slot)) ? Number(item.slot) + 1 : index + 1,
    xCenter: Number.isFinite(Number(item?.xCenter)) ? Number(Number(item.xCenter).toFixed(4)) : null,
    stage: stageFromTag(item?.scanTag),
  }));
}
function readVisibleFields(doc) {
  const values = {};
  for (const label of doc.querySelectorAll("section.card .grid label")) {
    const title = String(label.querySelector("span")?.textContent || label.childNodes?.[0]?.textContent || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const control = label.querySelector("input,select,textarea");
    if (!title || !control) continue;
    values[title] = String(control.value || "");
  }
  return values;
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
  const requests = [];
  const violations = [];
  const startMark = win.performance.now();
  const record = (url, method, type) => requests.push(safeRequest(url, method, type, win.location.href));
  const violate = (kind, url, method, binary = false) => {
    const entry = { kind, ...safeRequest(url, method, kind, win.location.href), binary };
    violations.push(entry);
    return entry;
  };

  const originalFetch = win.fetch.bind(win);
  win.fetch = (input, init = {}) => {
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const url = typeof input === "string" || input instanceof win.URL ? input : input?.url || "";
    record(url, method, "fetch");
    const binary = hasBinary(win, init?.body);
    if (binary) {
      violate("fetch", url, method, true);
      return Promise.reject(new Error("AUDIT_BLOCKED_BINARY_UPLOAD"));
    }
    if (MUTATING.has(method)) {
      violate("fetch", url, method, false);
      return Promise.reject(new Error(`AUDIT_BLOCKED_${method}`));
    }
    return originalFetch(input, init);
  };

  const originalOpen = win.XMLHttpRequest.prototype.open;
  const originalSend = win.XMLHttpRequest.prototype.send;
  win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__auditMethod = String(method || "GET").toUpperCase();
    this.__auditUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  win.XMLHttpRequest.prototype.send = function (body) {
    const method = this.__auditMethod || "GET";
    const url = this.__auditUrl || "";
    record(url, method, "xhr");
    const binary = hasBinary(win, body);
    if (binary) {
      violate("xhr", url, method, true);
      throw new Error("AUDIT_BLOCKED_BINARY_UPLOAD");
    }
    if (MUTATING.has(method)) {
      violate("xhr", url, method, false);
      throw new Error(`AUDIT_BLOCKED_${method}`);
    }
    return originalSend.call(this, body);
  };

  if (win.navigator?.sendBeacon) {
    win.navigator.sendBeacon = (url, data) => {
      record(url, "POST", "beacon");
      violate("beacon", url, "POST", hasBinary(win, data));
      return false;
    };
  }

  const OriginalWebSocket = win.WebSocket;
  win.WebSocket = function (url, protocols) {
    record(url, "GET", "websocket");
    violate("websocket", url, "GET", false);
    throw new Error("AUDIT_BLOCKED_WEBSOCKET");
  };
  win.WebSocket.prototype = OriginalWebSocket.prototype;

  const originalSubmit = win.HTMLFormElement.prototype.submit;
  const originalRequestSubmit = win.HTMLFormElement.prototype.requestSubmit;
  const blockForm = function (type) {
    const method = String(this.method || "GET").toUpperCase();
    const url = this.action || win.location.href;
    record(url, method, type);
    violate(type, url, method, false);
    throw new Error(`AUDIT_BLOCKED_${type.toUpperCase()}`);
  };
  win.HTMLFormElement.prototype.submit = function () { return blockForm.call(this, "form-submit"); };
  if (originalRequestSubmit) win.HTMLFormElement.prototype.requestSubmit = function () { return blockForm.call(this, "form-requestSubmit"); };
  const onSubmit = (event) => {
    event.preventDefault();
    const form = event.target;
    if (form instanceof win.HTMLFormElement) {
      const method = String(form.method || "GET").toUpperCase();
      const url = form.action || win.location.href;
      record(url, method, "form-event");
      violate("form-event", url, method, false);
    }
  };
  win.document.addEventListener("submit", onSubmit, true);

  let observer = null;
  try {
    observer = new win.PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.startTime < startMark) continue;
        record(e.name, "GET", e.initiatorType || "resource");
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {}

  return {
    requests,
    violations,
    finish() {
      try { observer?.disconnect(); } catch {}
      try { win.document.removeEventListener("submit", onSubmit, true); } catch {}
      return {
        requests: requests.slice(),
        violations: violations.slice(),
        binaryUploadAttempts: violations.filter((v) => v.binary).length,
        blockedMutationRequests: violations.filter((v) => MUTATING.has(v.method)).length,
      };
    },
  };
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForInput(frame) {
  const started = performance.now();
  while (performance.now() - started < 15000) {
    const doc = frame.contentDocument;
    const inputs = [...(doc?.querySelectorAll('input[type="file"]') || [])];
    const input = inputs.find((node) => node.closest("section.card")?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
    if (input) return input;
    await wait(150);
  }
  throw new Error("vehicle-workflow-v2 の車検証 file input を検出できませんでした");
}
async function waitForFastAuditReady(frame) {
  const started = performance.now();
  while (performance.now() - started < 10000) {
    const win = frame.contentWindow;
    if (win?.__certificateQrFastAuditReady === true) return;
    await wait(80);
  }
  throw new Error("CertificateQrFast audit listener の準備完了を確認できませんでした");
}
function scoreText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}
function truthImages(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return {};
  return root.images && typeof root.images === "object" && !Array.isArray(root.images) ? root.images : root;
}
function actualValueForKey(result, key) {
  const wanted = scoreText(key);
  const sources = [result?.browserOnlyFieldValues || {}, result?.browserOnlyQrPriorityValues || {}];
  for (const source of sources) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    for (const [candidate, value] of Object.entries(source)) {
      const got = scoreText(candidate);
      if (got === wanted || got.startsWith(wanted) || wanted.startsWith(got)) return value;
    }
  }
  return "";
}
function scoreResult(result, truthRoot) {
  const images = truthImages(truthRoot);
  const name = result?.normalizedFileName || result?.fileName || "";
  const truth = images?.[name];
  if (!truth || typeof truth !== "object" || Array.isArray(truth)) {
    return { available: false, itemTotalCount: 0, itemCorrectCount: 0, itemWrongCount: 0, itemBlankCount: 0 };
  }
  const entries = Object.entries(truth);
  let correct = 0, wrong = 0, blank = 0;
  for (const [key, expected] of entries) {
    const actual = actualValueForKey(result, key);
    if (!scoreText(actual)) blank += 1;
    else if (scoreText(actual) === scoreText(expected)) correct += 1;
    else wrong += 1;
  }
  return {
    available: entries.length === 9,
    itemTotalCount: entries.length,
    itemCorrectCount: correct,
    itemWrongCount: wrong,
    itemBlankCount: blank,
  };
}
function summarizeTrace(trace = {}) {
  const events = Array.isArray(trace.events) ? trace.events : [];
  const jsqr = events.filter((e) => e.type === "jsqr-result");
  const zxing = events.filter((e) => e.type === "zxing-result");
  const dedupe = events.filter((e) => e.type === "dedupe" || e.type === "final-dedupe");
  const centerScans = events.filter((e) => e.type === "center-scan");
  const budgetStops = events.filter((e) => e.type === "budget-stop");
  return {
    jsqrAttempts: jsqr.length,
    jsqrSuccesses: jsqr.filter((e) => e.success).length,
    jsqrFailures: jsqr.filter((e) => !e.success).length,
    jsqrByStage: Object.fromEntries([...new Set(jsqr.map((e) => e.stage))].map((stage) => [stage, { success: jsqr.filter((e) => e.stage === stage && e.success).length, failure: jsqr.filter((e) => e.stage === stage && !e.success).length }])),
    zxingAttempts: zxing.length,
    zxingSuccesses: zxing.filter((e) => e.success).length,
    zxingFailures: zxing.filter((e) => !e.success).length,
    zxingCentersFailed: zxing.filter((e) => !e.success).map((e) => e.center),
    scannedCenters: centerScans.map((e) => e.center),
    dedupeDroppedCount: dedupe.reduce((sum, e) => sum + Number(e.droppedCount || 0), 0),
    dedupeEvents: dedupe.map((e) => ({ stage: e.stage || "final", before: e.orderedUniqueBeforeCount, after: e.orderedUniqueAfterCount, dropped: e.droppedCount || 0 })),
    budgetStops: budgetStops.map((e) => ({ stage: e.stage, center: e.center })),
  };
}
async function runOne(frame, file, index, phase = "fast") {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) throw new Error("iframeへアクセスできません");
  const guard = installNetworkGuard(win);
  const jsErrors = [];
  const onError = (event) => jsErrors.push(String(event?.message || "window error"));
  const onRejection = (event) => jsErrors.push(String(event?.reason?.message || event?.reason || "unhandled rejection"));
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  let fastEvent = null;
  let applyEventCount = 0;
  let applyKeys = [];
  const onFast = (event) => { fastEvent = event?.detail || null; };
  const onApply = (event) => {
    applyEventCount += 1;
    applyKeys = [...new Set([...applyKeys, ...Object.keys(event?.detail || {})])].sort();
  };
  win.addEventListener("vehicle-certificate-qr-fast-ready", onFast);
  win.addEventListener("vehicle-certificate-authoritative", onApply);

  const started = performance.now();
  try {
    const input = await waitForInput(frame);
    await waitForFastAuditReady(frame);
    const dt = new win.DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", { configurable: true, value: dt.files });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));

    let timedOut = false;
    const waitLimit = phase === "fast" ? FAST_WAIT_MS : INTEGRATION_WAIT_MS;
    while (performance.now() - started < waitLimit) {
      const state = win.__vehicleCertificateQrFastState;
      if (phase === "fast") {
        if (fastEvent || state?.running === false) { await wait(80); break; }
      } else {
        const progress = doc.querySelector(".progress");
        const rescue = doc.getElementById("certificate-qr-rescue-status");
        const apply = doc.getElementById("certificate-qr-applied-fixed");
        if (state?.running === false && !progress && rescue && apply) { await wait(1200); break; }
      }
      await wait(phase === "fast" ? 80 : 200);
    }
    if (performance.now() - started >= waitLimit) timedOut = true;

    const state = win.__vehicleCertificateQrFastState || {};
    const qr = Array.isArray(win.__vehicleCertificateQr) ? win.__vehicleCertificateQr : [];
    const expected = Number(state.expected || fastEvent?.expected?.count || 0) || null;
    const fields = readVisibleFields(doc);
    const qrPriority = win.__vehicleCertificateQrPriority || {};
    const fieldNames = Object.keys(qrPriority).sort();
    const rescueText = String(doc.getElementById("certificate-qr-rescue-status")?.textContent || "");
    const applyText = String(doc.getElementById("certificate-qr-applied-fixed")?.textContent || "");
    const missing = expected ? Math.max(0, expected - qr.length) : null;
    const trace = summarizeTrace(win.__certificateQrFastAuditTrace || {});
    const density = Array.isArray(state.densityCenters) ? state.densityCenters.map((x) => Number(Number(x).toFixed(4))) : [];
    const missingDensityCenters = density.filter((center) => !qr.some((item) => Math.abs(Number(item?.xCenter) - center) < .045));
    const failureClass = [];
    if (missing > 0 && density.length < expected) failureClass.push("A");
    if (missing > 0 && trace.jsqrFailures > 0) failureClass.push("B");
    if (missing > 0 && trace.zxingFailures > 0) failureClass.push("C");
    if (missing > 0 && (trace.budgetStops.length > 0 || Number(state.elapsed || 0) >= 4600)) failureClass.push("D");
    if (missing > 0 && trace.dedupeDroppedCount > 0) failureClass.push("E");
    if (qr.length > 0 && fieldNames.length === 0) failureClass.push("F");

    const network = guard.finish();
    const privacyFail = network.binaryUploadAttempts > 0;
    return {
      imageIndex: index + 1,
      fileName: safeName(file),
      normalizedFileName: normalizeFixedFileName(file) || safeName(file),
      phase,
      pathname: win.location.pathname,
      fastFired: Boolean(fastEvent || state.token),
      expectedQrCount: expected,
      densityCentersCount: density.length,
      densityCentersX: density,
      stages: stageCounts(qr),
      finalUniqueQrCount: qr.length,
      qrPositions: nonPiiQr(qr),
      missingQrCount: missing,
      missingQrPositions: missingDensityCenters,
      budget4600Reached: Number(state.elapsed || 0) >= 4600 || trace.budgetStops.length > 0,
      fastElapsedMsDiagnostic: Number(state.elapsed || fastEvent?.elapsed || 0),
      totalElapsedMsDiagnostic: Math.round(performance.now() - started),
      timingNote: "観測フック付き診断環境測定値",
      rescueV2Fired: Boolean(rescueText),
      rescueStatus: rescueText ? rescueText.replace(/\d+\/\d+件/g, "<count>") : "",
      applyFixedFired: Boolean(applyEventCount || applyText),
      applyEventCount,
      applyFieldKeys: fieldNames.length ? fieldNames : applyKeys,
      ocrFallbackFieldLabels: Object.keys(fields).filter((label) => fields[label] && !fieldNames.some((k) => label.includes(k))),
      decodeAudit: trace,
      failureClassification: [...new Set(failureClass)],
      networkAudit: network,
      privacyFail,
      jsErrors: jsErrors.filter((x) => !x.includes("AUDIT_BLOCKED_")),
      timeout: timedOut,
      browserOnlyFieldValues: fields,
      browserOnlyQrPriorityValues: qrPriority,
    };
  } finally {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    win.removeEventListener("vehicle-certificate-qr-fast-ready", onFast);
    win.removeEventListener("vehicle-certificate-authoritative", onApply);
  }
}
function summaryResult(r, score = null) {
  return {
    imageIndex: r.imageIndex,
    fileName: r.fileName,
    normalizedFileName: r.normalizedFileName,
    phase: r.phase,
    pathname: r.pathname,
    fastFired: r.fastFired,
    expectedQrCount: r.expectedQrCount,
    densityCentersCount: r.densityCentersCount,
    densityCentersX: r.densityCentersX,
    stages: r.stages,
    finalUniqueQrCount: r.finalUniqueQrCount,
    missingQrCount: r.missingQrCount,
    missingQrPositions: r.missingQrPositions,
    budget4600Reached: r.budget4600Reached,
    fastElapsedMsDiagnostic: r.fastElapsedMsDiagnostic,
    totalElapsedMsDiagnostic: r.totalElapsedMsDiagnostic,
    rescueV2Fired: r.rescueV2Fired,
    applyFixedFired: r.applyFixedFired,
    applyFieldKeys: r.applyFieldKeys,
    ocrFallbackFieldLabels: r.ocrFallbackFieldLabels,
    decodeAudit: r.decodeAudit,
    failureClassification: r.failureClassification,
    networkAudit: r.networkAudit,
    privacyFail: r.privacyFail,
    jsErrors: r.jsErrors,
    timeout: r.timeout,
    itemCorrectCount: score?.itemCorrectCount ?? null,
    itemTotalCount: score?.itemTotalCount ?? null,
    itemWrongCount: score?.itemWrongCount ?? null,
    itemBlankCount: score?.itemBlankCount ?? null,
    scoringAvailable: score?.available ?? false,
  };
}
export default function CertificateQrFastAuditPage() {
  const [files, setFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("固定8枚を選択してください。");
  const [results, setResults] = useState([]);
  const [integrationResults, setIntegrationResults] = useState([]);
  const [truthRoot, setTruthRoot] = useState(null);
  const [truthStatus, setTruthStatus] = useState("主要9項目の正解JSONは未読込です。");
  const frameRef = useRef(null);

  const normalizedSelectedNames = useMemo(() => files.map((f) => normalizeFixedFileName(f)), [files]);
  const normalizedNameSet = useMemo(() => new Set(normalizedSelectedNames.filter(Boolean)), [normalizedSelectedNames]);
  const exactSet =
    normalizedSelectedNames.length === 8 &&
    normalizedSelectedNames.every(Boolean) &&
    normalizedNameSet.size === 8 &&
    REQUIRED_NAMES.every((name) => normalizedNameSet.has(name));
  const validCount = files.length === 8 && exactSet;

  const reloadFrame = () => new Promise((resolve, reject) => {
    const frame = frameRef.current;
    if (!frame) return reject(new Error("iframeがありません"));
    const timeout = setTimeout(() => reject(new Error("iframe load timeout")), 20000);
    frame.onload = () => { clearTimeout(timeout); resolve(); };
    frame.src = `${PATHNAME}?certificateQrAudit=1&nonce=${Date.now()}`;
  });

  const runBatch = async (phase) => {
    if (!validCount || running) return;
    if (phase === "integration" && !truthRoot) {
      setStatus("OCR統合評価には端末ローカルの主要9項目正解JSONを先に読み込んでください。");
      return;
    }
    setRunning(true);
    if (phase === "fast") setResults([]);
    else setIntegrationResults([]);
    const ordered = [...files].sort((a, b) => String(normalizeFixedFileName(a) || safeName(a)).localeCompare(String(normalizeFixedFileName(b) || safeName(b))));
    const out = [];
    try {
      for (let i = 0; i < ordered.length; i += 1) {
        setStatus(`${i + 1}/8 ${safeName(ordered[i])} を${phase === "fast" ? "QR Fast" : "OCR統合"}評価中…`);
        await reloadFrame();
        const result = await runOne(frameRef.current, ordered[i], i, phase);
        out.push(result);
        if (phase === "fast") setResults([...out]);
        else setIntegrationResults([...out]);
        if (result.privacyFail) throw new Error(`${safeName(ordered[i])}: 画像/File/Blob送信試行を検出したためFAIL`);
      }
      setStatus(phase === "fast"
        ? "8枚のQR Fast評価が完了しました。Fast完了時点で確定しており、OCR完了待ちはしていません。"
        : "8枚のOCR統合評価が完了しました。共有summaryには正誤件数だけを含めます。");
    } catch (e) {
      setStatus(`評価停止: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  const loadTruth = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const images = truthImages(parsed);
      const counts = REQUIRED_NAMES.map((name) => Object.keys(images?.[name] || {}).length);
      const valid = REQUIRED_NAMES.every((name) => images?.[name] && typeof images[name] === "object" && !Array.isArray(images[name]) && Object.keys(images[name]).length === 9);
      setTruthRoot(parsed);
      setTruthStatus(valid
        ? "正解JSON: 8枚すべて9項目を確認しました（ブラウザメモリ内のみ）。"
        : `正解JSON読込済み。ただし各画像9項目ではありません: ${counts.join("/")}`);
    } catch (e) {
      setTruthRoot(null);
      setTruthStatus(`正解JSON読込エラー: ${e?.message || e}`);
    }
  };


  const summaryJson = JSON.stringify({
    schema: "icb-certificate-qr-fast-audit-summary-v2",
    generatedAt: new Date().toISOString(),
    pathname: PATHNAME,
    imageCount: results.length,
    privacy: { imageUpload: false, serverMutationBlocked: true, repositoryFixture: false, autoSaveVehicle: false, piiIncluded: false },
    results: results.map(summaryResult),
  }, null, 2);
  const integrationSummaryJson = JSON.stringify({
    schema: "icb-certificate-qr-fast-audit-integration-summary-v3",
    generatedAt: new Date().toISOString(),
    pathname: PATHNAME,
    imageCount: integrationResults.length,
    privacy: { imageUpload: false, truthUpload: false, piiIncluded: false, scoringCountsOnly: true },
    results: integrationResults.map((r) => summaryResult(r, scoreResult(r, truthRoot))),
    totals: integrationResults.reduce((acc, r) => {
      const s = scoreResult(r, truthRoot);
      acc.itemCorrectCount += s.itemCorrectCount;
      acc.itemTotalCount += s.itemTotalCount;
      acc.itemWrongCount += s.itemWrongCount;
      acc.itemBlankCount += s.itemBlankCount;
      return acc;
    }, { itemCorrectCount: 0, itemTotalCount: 0, itemWrongCount: 0, itemBlankCount: 0 }),
  }, null, 2);
  const detailJson = JSON.stringify({
    schema: "icb-certificate-qr-fast-audit-local-detail-v2",
    generatedAt: new Date().toISOString(),
    pathname: PATHNAME,
    imageCount: results.length,
    privacy: { localOnly: true, autoUpload: false, containsVehicleFieldValues: true },
    fastResults: results,
    integrationResults,
  }, null, 2);

  const copySummary = async () => {
    await navigator.clipboard.writeText(summaryJson);
    setStatus("共有可能な非PII summary JSONをコピーしました。");
  };
  const copyIntegrationSummary = async () => {
    await navigator.clipboard.writeText(integrationSummaryJson);
    setStatus("OCR統合評価の非PII正誤件数summaryをコピーしました。");
  };
  const downloadDetail = () => {
    const blob = new Blob([detailJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificate-qr-fast-audit-local-detail-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24 }}>車検証QR Fast 固定8枚評価</h1>
      <p>固定8枚はブラウザメモリ内だけで扱います。評価iframeではPOST / PUT / PATCH / DELETE、sendBeacon、WebSocket、form submitを遮断し、GET / HEADだけ許可します。</p>
      <p><b>正式経路:</b> {PATHNAME} → input[type=file] → CertificateQrFast → CertificateQrRescueV2 → CertificateQrApplyFixed → OCR fallback</p>
      <p><b>処理時間:</b> 表示値は観測フック付きの診断環境測定値です。</p>

      <section style={{ padding: 16, border: "1px solid #ccc", borderRadius: 12, marginTop: 16 }}>
        <input type="file" accept="image/*" multiple disabled={running} onChange={(e) => setFiles([...e.target.files].slice(0, 8))} />
        <div style={{ marginTop: 10, fontSize: 13 }}>{files.length}/8 選択</div>
        {files.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, overflowWrap: "anywhere" }}>
            正規化後: {normalizedSelectedNames.map((name) => name || "判定不可").join(" / ")}
          </div>
        )}
        {!exactSet && files.length > 0 && <div style={{ marginTop: 8 }}>固定セット IMG_0940.jpeg〜IMG_0947.jpeg の8枚を選択してください。</div>}
        <div style={{ marginTop: 12 }}>
          <button onClick={() => runBatch("fast")} disabled={!validCount || running} style={{ marginRight: 8, padding: "10px 18px", fontWeight: 700 }}>{running ? "評価中…" : "QR Fast評価開始"}</button>
          <button onClick={() => runBatch("integration")} disabled={!validCount || running || !truthRoot} style={{ padding: "10px 18px", fontWeight: 700 }}>OCR統合評価開始</button>
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #ddd" }}>
          <div style={{ fontWeight: 700 }}>主要9項目 正解JSON（端末ローカルのみ）</div>
          <input type="file" accept="application/json,.json" disabled={running} onChange={loadTruth} style={{ marginTop: 8 }} />
          <div style={{ marginTop: 6, fontSize: 12 }}>{truthStatus}</div>
          <div style={{ marginTop: 4, fontSize: 11 }}>形式: {"{ images: { \"IMG_0940.jpeg\": { \"UIラベルまたは内部キー\": \"正解値\", ...9項目 }, ... } }"}</div>
        </div>
        <div style={{ marginTop: 12, fontWeight: 700 }}>{status}</div>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>進捗</h2>
        {results.map((r) => <div key={r.fileName} style={{ padding: 10, borderBottom: "1px solid #ddd" }}>{r.imageIndex}/8 {r.fileName} — QR {r.finalUniqueQrCount}/{r.expectedQrCount ?? "?"} — Fast {r.fastElapsedMsDiagnostic}ms — {r.privacyFail ? "PRIVACY FAIL" : r.timeout ? "timeout" : "完了"}</div>)}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>OCR統合評価</h2>
        {integrationResults.map((r) => {
          const s = scoreResult(r, truthRoot);
          return <div key={r.fileName} style={{ padding: 10, borderBottom: "1px solid #ddd" }}>{r.imageIndex}/8 {r.fileName} — {s.itemCorrectCount}/{s.itemTotalCount} 正解 — 誤読 {s.itemWrongCount} — 空欄 {s.itemBlankCount} — {r.timeout ? "timeout" : "完了"}</div>;
        })}
      </section>

      <section style={{ marginTop: 18 }}>
        <button onClick={copySummary} disabled={!results.length} style={{ marginRight: 8, padding: "9px 14px" }}>QR Fast summaryをコピー</button>
        <button onClick={copyIntegrationSummary} disabled={!integrationResults.length} style={{ marginRight: 8, padding: "9px 14px" }}>OCR統合summaryをコピー</button>
        <button onClick={downloadDetail} disabled={!results.length && !integrationResults.length} style={{ padding: "9px 14px" }}>端末ローカル詳細を保存</button>
      </section>

      <iframe ref={frameRef} title="vehicle-workflow-v2 audit" style={{ width: "100%", height: 620, marginTop: 20, border: "1px solid #bbb" }} />
      <details style={{ marginTop: 16 }}><summary>共有用summary JSON確認</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{summaryJson}</pre></details>
    </main>
  );
}
