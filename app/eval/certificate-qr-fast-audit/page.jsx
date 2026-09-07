"use client";

import { useMemo, useRef, useState } from "react";

const REQUIRED_NAMES = Array.from({ length: 8 }, (_, i) => `IMG_${940 + i}.jpeg`);
const PATHNAME = "/vehicle-workflow-v2";
const MAX_WAIT_MS = 70000;

function safeName(file) {
  return String(file?.name || "").replace(/[^A-Za-z0-9._-]/g, "_");
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
  const out = {
    normalizedBandJsQR: 0,
    contrastBand: 0,
    normalizedZXing: 0,
    rawBandJsQR: 0,
    rawZXing: 0,
    binaryBand: 0,
    other: 0,
  };
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
    const title = String(label.querySelector("span")?.textContent || label.childNodes?.[0]?.textContent || "")
      .normalize("NFKC").replace(/\s+/g, " ").trim();
    const control = label.querySelector("input,select,textarea");
    if (!title || !control) continue;
    values[title] = String(control.value || "");
  }
  return values;
}

function blockBinaryUpload(win) {
  const hasBinary = (body) => {
    if (!body) return false;
    if (body instanceof win.Blob || body instanceof win.File) return true;
    if (body instanceof win.FormData) {
      for (const [, value] of body.entries()) if (value instanceof win.Blob || value instanceof win.File) return true;
    }
    return false;
  };

  const originalFetch = win.fetch.bind(win);
  win.fetch = (input, init = {}) => {
    if (hasBinary(init?.body)) return Promise.reject(new Error("AUDIT_BLOCKED_BINARY_UPLOAD"));
    return originalFetch(input, init);
  };

  const originalOpen = win.XMLHttpRequest.prototype.open;
  const originalSend = win.XMLHttpRequest.prototype.send;
  win.XMLHttpRequest.prototype.open = function (...args) {
    this.__auditUrl = String(args[1] || "");
    return originalOpen.apply(this, args);
  };
  win.XMLHttpRequest.prototype.send = function (body) {
    if (hasBinary(body)) throw new Error("AUDIT_BLOCKED_BINARY_UPLOAD");
    return originalSend.call(this, body);
  };

  if (win.navigator?.sendBeacon) {
    const originalBeacon = win.navigator.sendBeacon.bind(win.navigator);
    win.navigator.sendBeacon = (url, data) => {
      if (hasBinary(data)) return false;
      return originalBeacon(url, data);
    };
  }
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

async function runOne(frame, file, index) {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) throw new Error("iframeへアクセスできません");
  blockBinaryUpload(win);

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
    const dt = new win.DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, "files", { configurable: true, value: dt.files });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));

    let timedOut = false;
    while (performance.now() - started < MAX_WAIT_MS) {
      const state = win.__vehicleCertificateQrFastState;
      const progress = doc.querySelector(".progress");
      const rescue = doc.getElementById("certificate-qr-rescue-status");
      const apply = doc.getElementById("certificate-qr-applied-fixed");
      if (state?.running === false && !progress && rescue && apply) {
        await wait(1200);
        break;
      }
      await wait(200);
    }
    if (performance.now() - started >= MAX_WAIT_MS) timedOut = true;

    const state = win.__vehicleCertificateQrFastState || {};
    const qr = Array.isArray(win.__vehicleCertificateQr) ? win.__vehicleCertificateQr : [];
    const counts = stageCounts(qr);
    const expected = Number(state.expected || fastEvent?.expected?.count || 0) || null;
    const fields = readVisibleFields(doc);
    const qrPriority = win.__vehicleCertificateQrPriority || {};
    const fieldNames = Object.keys(qrPriority).sort();
    const rescueText = String(doc.getElementById("certificate-qr-rescue-status")?.textContent || "");
    const applyText = String(doc.getElementById("certificate-qr-applied-fixed")?.textContent || "");
    const budgetReached = Number(state.elapsed || 0) >= 4600;

    const missing = expected ? Math.max(0, expected - qr.length) : null;
    let failureClass = [];
    if (missing > 0) {
      if (!Array.isArray(state.densityCenters) || state.densityCenters.length === 0) failureClass.push("A");
      if (budgetReached) failureClass.push("D");
      if (!budgetReached && Array.isArray(state.densityCenters) && state.densityCenters.length > 0) failureClass.push("B/C");
    }
    if (qr.length > 0 && fieldNames.length === 0) failureClass.push("F");

    return {
      imageIndex: index + 1,
      fileName: safeName(file),
      pathname: win.location.pathname,
      fastFired: Boolean(fastEvent || state.token),
      expectedQrCount: expected,
      densityCentersCount: Array.isArray(state.densityCenters) ? state.densityCenters.length : 0,
      densityCentersX: Array.isArray(state.densityCenters) ? state.densityCenters.map((x) => Number(Number(x).toFixed(4))) : [],
      stages: counts,
      finalUniqueQrCount: qr.length,
      qrPositions: nonPiiQr(qr),
      missingQrCount: missing,
      missingQrPositions: missing ? "位置特定には追加観測ログが必要" : [],
      budget4600Reached: budgetReached,
      fastElapsedMs: Number(state.elapsed || fastEvent?.elapsed || 0),
      rescueV2Fired: Boolean(rescueText),
      rescueStatus: rescueText ? rescueText.replace(/\d+\/\d+件/g, "<count>") : "",
      applyFixedFired: Boolean(applyEventCount || applyText),
      applyEventCount,
      applyFieldKeys: fieldNames.length ? fieldNames : applyKeys,
      ocrFallbackFieldLabels: Object.keys(fields).filter((label) => fields[label] && !fieldNames.some((k) => label.includes(k))),
      failureClassification: failureClass,
      jsErrors: jsErrors.filter((x) => !x.includes("AUDIT_BLOCKED_BINARY_UPLOAD")),
      timeout: timedOut,
      totalElapsedMs: Math.round(performance.now() - started),
      browserOnlyFieldValues: fields,
      auditNotes: "QR raw data/車両実値はサーバー送信・console出力しない。browserOnlyFieldValuesはこの端末内JSONだけに含む。",
    };
  } finally {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    win.removeEventListener("vehicle-certificate-qr-fast-ready", onFast);
    win.removeEventListener("vehicle-certificate-authoritative", onApply);
  }
}

export default function CertificateQrFastAuditPage() {
  const [files, setFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("固定8枚を選択してください。");
  const [results, setResults] = useState([]);
  const frameRef = useRef(null);

  const fileSummary = useMemo(() => files.map((f) => safeName(f)).join(" / "), [files]);
  const validCount = files.length === 8;

  const reloadFrame = () => new Promise((resolve, reject) => {
    const frame = frameRef.current;
    if (!frame) return reject(new Error("iframeがありません"));
    const timeout = setTimeout(() => reject(new Error("iframe load timeout")), 20000);
    frame.onload = () => { clearTimeout(timeout); resolve(); };
    frame.src = `${PATHNAME}?certificateQrAudit=1&nonce=${Date.now()}`;
  });

  const start = async () => {
    if (!validCount || running) return;
    setRunning(true);
    setResults([]);
    const out = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        setStatus(`${i + 1}/8 ${safeName(files[i])} を評価中…`);
        await reloadFrame();
        const result = await runOne(frameRef.current, files[i], i);
        out.push(result);
        setResults([...out]);
      }
      setStatus("8枚の評価が完了しました。結果をコピーまたは端末へ保存してください。");
    } catch (e) {
      setStatus(`評価停止: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  const json = JSON.stringify({
    schema: "icb-certificate-qr-fast-audit-v1",
    generatedAt: new Date().toISOString(),
    pathname: PATHNAME,
    imageCount: results.length,
    privacy: {
      imageUpload: false,
      serverPost: false,
      repositoryFixture: false,
      autoSaveVehicle: false,
      piiConsoleLog: false,
    },
    results,
  }, null, 2);

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setStatus("結果JSONをクリップボードへコピーしました。");
  };
  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificate-qr-fast-audit-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24 }}>車検証QR Fast 固定8枚評価</h1>
      <p>画像はブラウザメモリ内だけで扱います。GitHub・Vercel Storage・Supabase・DBへ画像を保存せず、画像を含むfetch/XHR/sendBeacon送信は評価iframe内で遮断します。</p>
      <p><b>正式経路:</b> {PATHNAME} → input[type=file] → CertificateQrFast → CertificateQrRescueV2 → CertificateQrApplyFixed → OCR fallback</p>

      <section style={{ padding: 16, border: "1px solid #ccc", borderRadius: 12, marginTop: 16 }}>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={running}
          onChange={(e) => setFiles([...e.target.files].slice(0, 8))}
        />
        <div style={{ marginTop: 10, fontSize: 13 }}>{files.length}/8 選択 {fileSummary && `: ${fileSummary}`}</div>
        <button onClick={start} disabled={!validCount || running} style={{ marginTop: 14, padding: "10px 18px", fontWeight: 700 }}>
          {running ? "評価中…" : "評価開始"}
        </button>
        <div style={{ marginTop: 12, fontWeight: 700 }}>{status}</div>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>進捗</h2>
        {results.map((r) => (
          <div key={r.fileName} style={{ padding: 10, borderBottom: "1px solid #ddd" }}>
            {r.imageIndex}/8 {r.fileName} — QR {r.finalUniqueQrCount}/{r.expectedQrCount ?? "?"} — Fast {r.fastElapsedMs}ms — {r.timeout ? "timeout" : "完了"}
          </div>
        ))}
      </section>

      <section style={{ marginTop: 18 }}>
        <button onClick={copy} disabled={!results.length} style={{ marginRight: 8, padding: "9px 14px" }}>結果をコピー</button>
        <button onClick={download} disabled={!results.length} style={{ padding: "9px 14px" }}>結果を端末へ保存</button>
      </section>

      <iframe ref={frameRef} title="vehicle-workflow-v2 audit" style={{ width: "100%", height: 620, marginTop: 20, border: "1px solid #bbb" }} />
      <details style={{ marginTop: 16 }}>
        <summary>結果JSON確認</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{json}</pre>
      </details>
    </main>
  );
}
