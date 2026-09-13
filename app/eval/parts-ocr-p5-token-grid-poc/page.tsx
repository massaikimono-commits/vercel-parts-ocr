/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { runP5TokenGridBrowser, type P5BrowserResult } from "../../ocr/bakeoff/p5-token-grid-browser";

type CaptureResult = {
  id: string;
  name: string;
  previewUrl: string;
  selectionOrder: number;
  imageWidth: number | null;
  imageHeight: number | null;
  result: P5BrowserResult | null;
  error: string | null;
};

const RESULT_SCHEMA = "icb.parts-ocr.p5-real-photo-poc.v1";
const RESULT_REVISION = "p5-browser-output-contract-copy-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";

function canonicalId(name: string) {
  const match = name.match(/IMG[_-]?(\d{4})/i);
  return match?.[1] ? `IMG_${match[1]}` : name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function loadImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });
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
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard copy failed");
}

export default function P5TokenGridRealPhotoPocPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("まずは『黄色伝票が1枚主体の写真』を1枚選んでTechnical Gateを確認してください。IMG番号の厳密一致は不要です。");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => () => {
    for (const capture of captures) URL.revokeObjectURL(capture.previewUrl);
  }, [captures]);

  async function copyPayload(payload: unknown, label: string) {
    try {
      await copyText(JSON.stringify(payload, null, 2));
      setCopyStatus(`${label}：コピーしました`);
    } catch {
      setCopyStatus(`${label}：コピーできませんでした`);
    }
  }

  async function run(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = Array.from(files).slice(0, 3);
    setBusy(true);
    setCopyStatus("");
    for (const capture of captures) URL.revokeObjectURL(capture.previewUrl);

    const prepared = selected.map((file, index) => ({
      file,
      id: canonicalId(file.name),
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      selectionOrder: index + 1,
    }));
    const sizes = await Promise.all(prepared.map((item) => loadImageSize(item.previewUrl)));
    const initial: CaptureResult[] = prepared.map((item, index) => ({
      id: item.id,
      name: item.name,
      previewUrl: item.previewUrl,
      selectionOrder: item.selectionOrder,
      imageWidth: sizes[index].width || null,
      imageHeight: sizes[index].height || null,
      result: null,
      error: null,
    }));
    setCaptures(initial);

    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        const label = `選択${index + 1}`;
        setStatus(`${label}: page-level OCR → token-grid reconstruction 実行中 (${index + 1}/${selected.length})`);
        try {
          const result = await runP5TokenGridBrowser(file);
          setCaptures((current) => current.map((capture, captureIndex) => captureIndex === index ? { ...capture, result, error: null } : capture));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setCaptures((current) => current.map((capture, captureIndex) => captureIndex === index ? { ...capture, result: null, error: message } : capture));
        }
      }
      setStatus("完了。『診断結果をコピー』を押して、そのままChatGPTへ貼り付けてください。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const copyableResults = captures.map(buildPrivacySafeResult).filter((value): value is NonNullable<typeof value> => value !== null);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 12px 60px", color: "#172033", background: "#f7f9fc" }}>
      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>P5 Token-Grid 実写真Feasibility</h1>
        <p>Page OCRのtext + bounding boxを保持し、header anchor → row clustering → column assignment → 4-field reconstructionを観測します。</p>
        <p><b>画像はGitHub・Supabase・server・artifactへ保存/送信しません。GTはruntimeで使用しません。</b></p>
        <p>Stage 1のtable localizationは現P5 v0では独立実装せず、ページ全体をscopeとするため <b>PAGE_SCOPE_ONLY</b> と表示します。</p>
        <p><b>Browser OCR Output Contract診断：</b> 認識本文・TSV本文・raw OCR payloadはコピー対象に含めません。</p>
      </section>

      <section style={{ background: "#fff8df", border: "1px solid #f0cf70", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>写真の選び方</h2>
        <p style={{ marginBottom: 8 }}><b>今回のTechnical Gateは、まず「黄色伝票が1枚主体の写真」を1枚だけ選んでください。</b></p>
        <p style={{ margin: "6px 0" }}>IMG番号を覚えたり、以前と同じ番号へ厳密固定する必要はありません。</p>
        <p style={{ margin: "6px 0" }}>結果が出たら「診断結果をコピー」→そのままChatGPTへ貼り付ければ完了です。</p>
      </section>

      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void run(event.target.files)} />
        <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>
          {busy ? "P5実行中…" : "写真を選択（Technical Gateはまず1枚）"}
        </button>
        <div role="status" aria-live="polite" style={{ marginTop: 10 }}>{status}</div>
        {copyableResults.length > 1 ? <button onClick={() => void copyPayload({ schema: `${RESULT_SCHEMA}.batch`, revision: RESULT_REVISION, evaluationHead: EVALUATION_HEAD, results: copyableResults }, "全結果")} style={{ width: "100%", border: "1px solid #245fce", borderRadius: 12, padding: 12, marginTop: 10, background: "white", color: "#245fce", fontWeight: 900 }}>
          全結果をコピー
        </button> : null}
        {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus.includes("コピーしました") ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
      </section>

      {captures.map((capture) => {
        const result = capture.result;
        const headerComplete = result ? result.stageDiagnostics.mappedHeaderFieldCount === 4 : false;
        const diagnostic = result?.ocrOutputDiagnostic;
        const privacySafeResult = buildPrivacySafeResult(capture);
        return (
          <section key={`${capture.id}-${capture.name}-${capture.selectionOrder}`} style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ display: "inline-block", background: "#245fce", color: "white", borderRadius: 999, padding: "5px 10px", fontWeight: 900 }}>選択{capture.selectionOrder}</span>
              <strong style={{ overflowWrap: "anywhere" }}>{capture.name}</strong>
              <span style={{ color: "#5f6b7a" }}>{capture.imageWidth && capture.imageHeight ? `${capture.imageWidth} × ${capture.imageHeight}px` : "画像サイズ取得不可"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
              <img src={capture.previewUrl} alt={`選択${capture.selectionOrder} ${capture.name}`} style={{ width: "100%", maxHeight: 460, objectFit: "contain", background: "#eef2f7", borderRadius: 10, border: "2px solid #dbe2ec" }} />
              {capture.error ? <div style={{ color: "#a11" }}>ERROR: {capture.error}</div> : null}
              {result ? <>
                {privacySafeResult ? <button onClick={() => void copyPayload(privacySafeResult, `選択${capture.selectionOrder}`)} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: "#176b34", color: "white", fontWeight: 900 }}>
                  診断結果をコピー
                </button> : null}

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr><th align="left">Page OCR token count</th><td><b>{result.ocrTokenCount}</b></td></tr>
                      <tr><th align="left">Header anchor status</th><td>{headerComplete ? "COMPLETE" : `INCOMPLETE (${result.stageDiagnostics.mappedHeaderFieldCount}/4)`}</td></tr>
                      <tr><th align="left">Row cluster count</th><td>{result.stageDiagnostics.clusteredRowCount}</td></tr>
                      <tr><th align="left">Column assignment count</th><td>{result.assignedTokenCount}</td></tr>
                      <tr><th align="left">Reconstructed row count</th><td>{result.stageDiagnostics.reconstructedRowCount}</td></tr>
                      <tr><th align="left">manualReviewRequired</th><td>{String(result.manualReviewRequired)}</td></tr>
                      <tr><th align="left">abstain reason</th><td>{result.abstainReason}</td></tr>
                      <tr><th align="left">OCR processing time</th><td>{result.ocrProcessingTimeMs} ms</td></tr>
                    </tbody>
                  </table>
                </div>

                {diagnostic ? <div style={{ overflowX: "auto" }}>
                  <b>Browser OCR Output Contract（非PII）</b>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                    <tbody>
                      <tr><th align="left">recognize succeeded</th><td>{String(diagnostic.recognizeSucceeded)}</td></tr>
                      <tr><th align="left">recognized.data keys</th><td>{diagnostic.recognizedDataKeys.join(", ") || "(none)"}</td></tr>
                      <tr><th align="left">typeof data.tsv / length</th><td>{diagnostic.tsvType} / {diagnostic.tsvLength}</td></tr>
                      <tr><th align="left">TSV parsed token count</th><td>{diagnostic.tsvParsedTokenCount}</td></tr>
                      <tr><th align="left">typeof data.text / length</th><td>{diagnostic.textType} / {diagnostic.textLength}</td></tr>
                      <tr><th align="left">blocks present / block count</th><td>{String(diagnostic.blocksPresent)} / {diagnostic.blockCount}</td></tr>
                      <tr><th align="left">blocks word count</th><td>{diagnostic.blockWordCount}</td></tr>
                      <tr><th align="left">selected token source</th><td>{diagnostic.tokenSource}</td></tr>
                    </tbody>
                  </table>
                </div> : null}

                <div style={{ display: "grid", gap: 8 }}>
                  <b>Stage diagnostics</b>
                  <div>Stage 1 document/table localization: {result.tableLocalizationStatus}</div>
                  <div>Stage 2 row clustering: {result.stageDiagnostics.clusteredRowCount} clusters</div>
                  <div>Stage 3 column assignment: {result.assignedTokenCount} assigned tokens</div>
                  <div>Stage 4 token OCR: {result.ocrTokenCount} page tokens</div>
                  <div>Stage 5 4-field reconstructed row: {result.stageDiagnostics.reconstructedRowCount} rows</div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th>row</th><th>name</th><th>qty</th><th>retail</th><th>cost</th><th>source tokens</th></tr></thead>
                    <tbody>
                      {result.rows.map((row) => <tr key={row.rowId}>
                        <td>{row.rowId}</td><td>{row.fields.name}</td><td>{row.fields.qty}</td><td>{row.fields.retail}</td><td>{row.fields.cost}</td><td>{row.sourceTokenCount}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              </> : null}
            </div>
          </section>
        );
      })}
    </main>
  );
}
