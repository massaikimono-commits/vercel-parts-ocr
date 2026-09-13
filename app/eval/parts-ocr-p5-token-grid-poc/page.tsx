/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runP5TokenGridBrowser, type P5BrowserResult } from "../../ocr/bakeoff/p5-token-grid-browser";

type RegisteredImage = {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  selectionOrder: number;
  imageWidth: number | null;
  imageHeight: number | null;
  fingerprint: string;
};

type CaptureResult = {
  id: string;
  name: string;
  previewUrl: string;
  selectionOrder: number;
  imageWidth: number | null;
  imageHeight: number | null;
  fingerprint: string;
  result: P5BrowserResult | null;
  error: string | null;
};

const RESULT_SCHEMA = "icb.parts-ocr.p5-real-photo-poc.v1";
const RESULT_REVISION = "p5-formal-12-auto-target-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
const FORMAL_IMAGE_IDS = Array.from({ length: 12 }, (_, index) => `IMG_${String(675 + index).padStart(4, "0")}`);
const DEFAULT_TARGET_IMAGE_ID = "IMG_0678";

function canonicalId(name: string) {
  const match = name.match(/IMG[_-]?(\d{4})/i);
  return match?.[1] ? `IMG_${match[1]}` : "UNMATCHED";
}

function loadImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });
}

async function safeFingerprint(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 10).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function buildPrivacySafeResult(capture: CaptureResult) {
  if (!capture.result) return null;
  const result = capture.result;
  const diagnostic = result.ocrOutputDiagnostic;
  const mappedHeaderFieldCount = result.stageDiagnostics.mappedHeaderFieldCount;
  return {
    schema: RESULT_SCHEMA,
    revision: RESULT_REVISION,
    evaluationHead: EVALUATION_HEAD,
    candidateId: result.candidateId,
    candidateVersion: result.candidateVersion,
    imageId: capture.id,
    safeImageFingerprint: capture.fingerprint,
    sourceWidth: result.sourceWidth,
    sourceHeight: result.sourceHeight,
    rotated: result.rotated,
    recognizeSucceeded: diagnostic?.recognizeSucceeded ?? false,
    recognizedDataKeys: diagnostic?.recognizedDataKeys ?? [],
    textType: diagnostic?.textType ?? "undefined",
    textLength: diagnostic?.textLength ?? 0,
    tsvType: diagnostic?.tsvType ?? "undefined",
    tsvLength: diagnostic?.tsvLength ?? 0,
    tsvParsedTokenCount: diagnostic?.tsvParsedTokenCount ?? 0,
    blocksAvailable: diagnostic?.blocksPresent ?? false,
    blockCount: diagnostic?.blockCount ?? 0,
    blocksWordCount: diagnostic?.blockWordCount ?? 0,
    tokenSource: diagnostic?.tokenSource ?? "none",
    pageOcrTokenCount: result.ocrTokenCount,
    headerAnchorStatus: mappedHeaderFieldCount === 4 ? "COMPLETE" : "INCOMPLETE",
    mappedHeaderFieldCount,
    rowClusterCount: result.stageDiagnostics.clusteredRowCount,
    columnAssignmentCount: result.assignedTokenCount,
    reconstructedRowCount: result.stageDiagnostics.reconstructedRowCount,
    manualReviewRequired: result.manualReviewRequired,
    abstainReason: result.abstainReason,
    wrongAutoConfirm: result.wrongAutoConfirm,
    gtIncluded: result.gtIncluded,
    ocrProcessingTimeMs: result.ocrProcessingTimeMs,
    stageDiagnostics: result.stageDiagnostics,
    rows: result.rows,
  };
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard copy failed");
}

export default function P5TokenGridRealPhotoPocPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [registered, setRegistered] = useState<RegisteredImage[]>([]);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正式12枚を一度登録してください。画像番号を探す必要はありません。");
  const [copyStatus, setCopyStatus] = useState("");
  const [targetImageId, setTargetImageId] = useState(DEFAULT_TARGET_IMAGE_ID);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("targetImageId");
    if (requested && FORMAL_IMAGE_IDS.includes(requested)) setTargetImageId(requested);
  }, []);

  useEffect(() => () => {
    for (const item of registered) URL.revokeObjectURL(item.previewUrl);
  }, [registered]);

  const registeredIds = useMemo(() => new Set(registered.map((item) => item.id)), [registered]);
  const missingIds = FORMAL_IMAGE_IDS.filter((id) => !registeredIds.has(id));
  const duplicateIds = registered.map((item) => item.id).filter((id, index, all) => id !== "UNMATCHED" && all.indexOf(id) !== index);
  const unmatchedCount = registered.filter((item) => item.id === "UNMATCHED").length;
  const formalReady = registered.length === 12 && missingIds.length === 0 && duplicateIds.length === 0 && unmatchedCount === 0;

  async function registerFormalSet(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = Array.from(files).slice(0, 12);
    setBusy(true);
    setCopyStatus("");
    setCapture(null);
    for (const item of registered) URL.revokeObjectURL(item.previewUrl);
    try {
      const base = selected.map((file, index) => ({
        file,
        id: canonicalId(file.name),
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        selectionOrder: index + 1,
      }));
      const [sizes, fingerprints] = await Promise.all([
        Promise.all(base.map((item) => loadImageSize(item.previewUrl))),
        Promise.all(base.map((item) => safeFingerprint(item.file))),
      ]);
      const next = base.map((item, index) => ({
        ...item,
        imageWidth: sizes[index].width || null,
        imageHeight: sizes[index].height || null,
        fingerprint: fingerprints[index],
      }));
      setRegistered(next);
      const ids = new Set(next.map((item) => item.id));
      const missing = FORMAL_IMAGE_IDS.filter((id) => !ids.has(id));
      const duplicates = next.map((item) => item.id).filter((id, index, all) => id !== "UNMATCHED" && all.indexOf(id) !== index);
      const unmatched = next.filter((item) => item.id === "UNMATCHED").length;
      if (next.length === 12 && missing.length === 0 && duplicates.length === 0 && unmatched === 0) {
        setStatus("正式セット READY。『自動診断開始』を押してください。対象写真は画面が自動選択します。");
      } else {
        setStatus(`正式セット未完了：登録${next.length}/12、不足${missing.length}、未照合${unmatched}、重複${duplicates.length}。12枚をまとめて選び直してください。`);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function runAutoDiagnostic() {
    if (!formalReady || busy) return;
    const target = registered.find((item) => item.id === targetImageId);
    if (!target) {
      setStatus("対象画像を登録済みmanifestから解決できませんでした。正式12枚を再登録してください。");
      return;
    }
    setBusy(true);
    setCopyStatus("");
    setStatus("OCR 0ケースを自動診断中です。写真を探す操作は不要です。");
    const initial: CaptureResult = { ...target, result: null, error: null };
    setCapture(initial);
    try {
      const result = await runP5TokenGridBrowser(target.file);
      setCapture({ ...initial, result, error: null });
      setStatus("自動診断完了。『診断結果をコピー』を1回押して、そのまま総合管理へ貼り付けてください。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCapture({ ...initial, result: null, error: message });
      setStatus(`自動診断エラー：${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyDiagnostic() {
    if (!capture) return;
    const payload = buildPrivacySafeResult(capture);
    if (!payload) return;
    try {
      await copyText(JSON.stringify(payload, null, 2));
      setCopyStatus("コピーしました");
    } catch {
      setCopyStatus("コピーできませんでした");
    }
  }

  const result = capture?.result ?? null;
  const diagnostic = result?.ocrOutputDiagnostic;
  const headerComplete = result ? result.stageDiagnostics.mappedHeaderFieldCount === 4 : false;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 12px 60px", color: "#172033", background: "#f7f9fc" }}>
      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>P5 正式12枚 自動診断</h1>
        <p><b>12枚を一度登録すれば、対象写真は画面が自動選択します。IMG番号を覚えたり探したりする必要はありません。</b></p>
        <p>画像本体はブラウザ内の評価セッションだけで保持し、server・GitHub・Supabase・artifactへ送信/保存しません。</p>
        <p>正式row数GTはこのruntimeの画像選択・OCR・停止条件・再構成制御には使用しません。</p>
      </section>

      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void registerFormalSet(event.target.files)} />
        <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>
          正式12枚を登録
        </button>
        <div style={{ marginTop: 10, fontWeight: 900, color: formalReady ? "#176b34" : "#8a5a00" }}>
          {formalReady ? "正式セット READY（12/12）" : `登録 ${registered.length}/12`}
        </div>
        <div role="status" aria-live="polite" style={{ marginTop: 8 }}>{status}</div>
        <button disabled={!formalReady || busy} onClick={() => void runAutoDiagnostic()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, marginTop: 12, background: !formalReady || busy ? "#94a3b8" : "#176b34", color: "white", fontWeight: 900 }}>
          {busy ? "処理中…" : "自動診断開始"}
        </button>
      </section>

      {registered.length > 0 ? <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>登録済み正式セット</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {registered.map((item) => <div key={`${item.selectionOrder}-${item.fingerprint}`} style={{ border: "1px solid #dbe2ec", borderRadius: 12, padding: 8 }}>
            <div style={{ fontWeight: 900 }}>登録 #{item.selectionOrder}</div>
            <img src={item.previewUrl} alt={`登録${item.selectionOrder}`} style={{ width: "100%", height: 110, objectFit: "contain", background: "#eef2f7", borderRadius: 8, margin: "6px 0" }} />
            <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>{item.name}</div>
            <div style={{ fontSize: 12 }}>{item.imageWidth && item.imageHeight ? `${item.imageWidth} × ${item.imageHeight}px` : "size unavailable"}</div>
            <div style={{ fontSize: 12 }}>識別: {item.id === "UNMATCHED" ? "未照合" : "登録済み"}</div>
            <div style={{ fontSize: 11, color: "#667085" }}>fp: {item.fingerprint}</div>
          </div>)}
        </div>
        {!formalReady ? <div style={{ marginTop: 10, color: "#8a1c1c" }}>不足: {missingIds.length} / 未照合: {unmatchedCount} / 重複: {duplicateIds.length}</div> : null}
      </section> : null}

      {capture ? <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>自動選択された診断対象</h2>
        <p style={{ marginTop: 0 }}>OCR 0ケースをmanifestから自動選択済みです。ユーザーによる画像番号指定は不要です。</p>
        <img src={capture.previewUrl} alt="自動診断対象" style={{ width: "100%", maxHeight: 460, objectFit: "contain", background: "#eef2f7", borderRadius: 10, border: "2px solid #dbe2ec" }} />
        <div style={{ marginTop: 8, fontSize: 12 }}>{capture.name} / {capture.imageWidth && capture.imageHeight ? `${capture.imageWidth} × ${capture.imageHeight}px` : "size unavailable"}</div>
        {capture.error ? <div style={{ color: "#a11", marginTop: 10 }}>ERROR: {capture.error}</div> : null}
        {result ? <>
          <button onClick={() => void copyDiagnostic()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, marginTop: 12, background: "#176b34", color: "white", fontWeight: 900 }}>診断結果をコピー</button>
          {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus === "コピーしました" ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
              <tr><th align="left">Page OCR token count</th><td><b>{result.ocrTokenCount}</b></td></tr>
              <tr><th align="left">Header anchor status</th><td>{headerComplete ? "COMPLETE" : `INCOMPLETE (${result.stageDiagnostics.mappedHeaderFieldCount}/4)`}</td></tr>
              <tr><th align="left">Row cluster count</th><td>{result.stageDiagnostics.clusteredRowCount}</td></tr>
              <tr><th align="left">Column assignment count</th><td>{result.assignedTokenCount}</td></tr>
              <tr><th align="left">Reconstructed row count</th><td>{result.stageDiagnostics.reconstructedRowCount}</td></tr>
              <tr><th align="left">manualReviewRequired</th><td>{String(result.manualReviewRequired)}</td></tr>
              <tr><th align="left">wrongAutoConfirm</th><td>{result.wrongAutoConfirm}</td></tr>
              <tr><th align="left">gtIncluded</th><td>{String(result.gtIncluded)}</td></tr>
              <tr><th align="left">OCR processing time</th><td>{result.ocrProcessingTimeMs} ms</td></tr>
            </tbody></table>
          </div>
          {diagnostic ? <details style={{ marginTop: 12 }}><summary>Privacy-safe diagnostic metadata</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 420, overflow: "auto", fontSize: 11 }}>{JSON.stringify(buildPrivacySafeResult(capture), null, 2)}</pre></details> : null}
        </> : null}
      </section> : null}
    </main>
  );
}
