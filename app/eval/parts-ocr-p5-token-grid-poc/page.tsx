/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { runP5TokenGridBrowser, type P5BrowserResult } from "../../ocr/bakeoff/p5-token-grid-browser";

type CaptureResult = {
  id: string;
  name: string;
  previewUrl: string;
  result: P5BrowserResult | null;
  error: string | null;
};

function canonicalId(name: string) {
  const match = name.match(/IMG[_-]?(\d{4})/i);
  return match?.[1] ? `IMG_${match[1]}` : name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export default function P5TokenGridRealPhotoPocPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("既存の部品伝票写真を最大3枚選択してください。画像はbrowser memory内だけで処理し、保存・送信しません。");

  useEffect(() => () => {
    for (const capture of captures) URL.revokeObjectURL(capture.previewUrl);
  }, [captures]);

  async function run(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = Array.from(files).slice(0, 3);
    setBusy(true);
    for (const capture of captures) URL.revokeObjectURL(capture.previewUrl);
    const initial = selected.map((file) => ({
      id: canonicalId(file.name),
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      result: null,
      error: null,
    }));
    setCaptures(initial);
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        const id = canonicalId(file.name);
        setStatus(`${id}: page-level OCR → token-grid reconstruction 実行中 (${index + 1}/${selected.length})`);
        try {
          const result = await runP5TokenGridBrowser(file);
          setCaptures((current) => current.map((capture, captureIndex) => captureIndex === index ? { ...capture, result, error: null } : capture));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setCaptures((current) => current.map((capture, captureIndex) => captureIndex === index ? { ...capture, result: null, error: message } : capture));
        }
      }
      setStatus("完了。まずBrowser OCR Output Contractを確認し、token count > 0 の場合のみP5 architecture段階を評価してください。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 12px 60px", color: "#172033", background: "#f7f9fc" }}>
      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>P5 Token-Grid 実写真Feasibility</h1>
        <p>Page OCRのtext + bounding boxを保持し、header anchor → row clustering → column assignment → 4-field reconstructionを観測します。</p>
        <p><b>画像はGitHub・Supabase・server・artifactへ保存/送信しません。GTはruntimeで使用しません。</b></p>
        <p>Stage 1のtable localizationは現P5 v0では独立実装せず、ページ全体をscopeとするため <b>PAGE_SCOPE_ONLY</b> と表示します。</p>
        <p><b>Browser OCR Output Contract診断：</b> 認識本文は表示せず、data key・型・length・件数だけを表示します。</p>
      </section>

      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void run(event.target.files)} />
        <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>
          {busy ? "P5実行中…" : "既存写真を選択（最大3枚）"}
        </button>
        <div role="status" aria-live="polite" style={{ marginTop: 10 }}>{status}</div>
      </section>

      {captures.map((capture) => {
        const result = capture.result;
        const headerComplete = result ? result.stageDiagnostics.mappedHeaderFieldCount === 4 : false;
        const diagnostic = result?.ocrOutputDiagnostic;
        return (
          <section key={`${capture.id}-${capture.name}`} style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 14 }}>
            <h2 style={{ marginTop: 0 }}>{capture.id}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
              <img src={capture.previewUrl} alt={`${capture.id} selected source`} style={{ width: "100%", maxHeight: 460, objectFit: "contain", background: "#eef2f7", borderRadius: 10 }} />
              {capture.error ? <div style={{ color: "#a11" }}>ERROR: {capture.error}</div> : null}
              {result ? <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr><th align="left">Page OCR token count</th><td>{result.ocrTokenCount}</td></tr>
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

                <details><summary>Non-image diagnostic JSON</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 420, overflow: "auto", fontSize: 11 }}>{JSON.stringify({
                  imageId: capture.id,
                  candidateId: result.candidateId,
                  candidateVersion: result.candidateVersion,
                  architecture: result.architecture,
                  sourceWidth: result.sourceWidth,
                  sourceHeight: result.sourceHeight,
                  rotated: result.rotated,
                  stageDiagnostics: result.stageDiagnostics,
                  assignedTokenCount: result.assignedTokenCount,
                  manualReviewRequired: result.manualReviewRequired,
                  abstainReason: result.abstainReason,
                  wrongAutoConfirm: result.wrongAutoConfirm,
                  gtIncluded: result.gtIncluded,
                  ocrProcessingTimeMs: result.ocrProcessingTimeMs,
                  ocrOutputDiagnostic: result.ocrOutputDiagnostic,
                  rows: result.rows,
                }, null, 2)}</pre></details>
              </> : null}
            </div>
          </section>
        );
      })}
    </main>
  );
}
