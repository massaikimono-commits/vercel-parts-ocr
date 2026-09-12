/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { runBrowserCandidates } from "../../ocr/bakeoff/browser-candidates";
import { diagnoseBrowserGeometry } from "../../ocr/bakeoff/root-cause-diagnostics";
import { runP2Local } from "../../ocr/bakeoff/p2-client";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8765";

function canonicalId(name: string) {
  const match = name.match(/IMG[_-]?(\d{4})/i);
  return match?.[1] ? `IMG_${match[1]}` : name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RootCauseAuditPage() {
  const input = useRef<HTMLInputElement>(null);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("固定candidateのprediction logicは変更せず、count-only traceを収集します。");
  const [report, setReport] = useState<any>(null);

  async function run(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setReport(null);
    const captures: any[] = [];
    try {
      for (const [index, file] of Array.from(files).entries()) {
        const imageId = canonicalId(file.name);
        const captureId = `${imageId}-capture-${String(index + 1).padStart(2, "0")}`;
        setStatus(`${imageId}: browser geometry`);
        const geometry = await diagnoseBrowserGeometry(file);
        setStatus(`${imageId}: P0/P1 fixed candidate run`);
        const browser = await runBrowserCandidates(file, imageId, captureId, setStatus);
        setStatus(`${imageId}: P2 local/private`);
        const rawP2 = await runP2Local({ endpoint, file, runId: browser.p0.runId, imageId, captureId });
        const p2Diagnostic = (rawP2 as any).diagnostic ?? null;
        const { diagnostic: _ignored, ...p2 } = rawP2 as any;
        captures.push({
          imageId,
          captureId,
          browserGeometry: geometry,
          p0: {
            rowCount: browser.p0.rowPredictions.length,
            abstainReason: browser.p0.abstainReason,
            manualReviewRequired: browser.p0.manualReviewRequired,
            error: browser.p0.error,
          },
          p1: {
            rowCount: browser.p1.rowPredictions.length,
            abstainReason: browser.p1.abstainReason,
            manualReviewRequired: browser.p1.manualReviewRequired,
            error: browser.p1.error,
          },
          p2: {
            rowCount: p2.rowPredictions.length,
            abstainReason: p2.abstainReason,
            manualReviewRequired: p2.manualReviewRequired,
            error: p2.error,
            diagnostic: p2Diagnostic,
          },
        });
      }
      const finalReport = {
        schema: "icb.parts-ocr.bakeoff-root-cause-audit.v1",
        gtIncluded: false,
        captureCount: captures.length,
        captures,
      };
      setReport(finalReport);
      setStatus(`完了：${captures.length} captures。GTなしcount-only traceです。`);
    } catch (error: any) {
      setStatus(`STOP: ${String(error?.message || error)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "18px 12px 60px", color: "#172033" }}>
      <section style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>Parts OCR Bakeoff Root-Cause Audit</h1>
        <p>P1 geometry / P2 structure adapterの詰まり箇所を、GTをruntimeへ入れずに観測します。</p>
        <p><b>OCR candidateVersion/configHash、threshold、crop、parserのaccuracy logicは変更しません。</b></p>
      </section>
      <section style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16 }}>
        <label htmlFor="p2-root-endpoint" style={{ display: "block", fontWeight: 800 }}>P2 local endpoint</label>
        <input id="p2-root-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} style={{ width: "100%", padding: 11, margin: "7px 0 12px", border: "1px solid #ccd5e3", borderRadius: 9 }} />
        <input ref={input} hidden type="file" accept="image/*" multiple onChange={(event) => void run(event.target.files)} />
        <button disabled={busy} onClick={() => input.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>{busy ? "監査中…" : "固定Regression画像を選択"}</button>
        <div role="status" aria-live="polite" style={{ marginTop: 10 }}>{status}</div>
        {report ? <>
          <button onClick={() => downloadJson(`icb-parts-bakeoff-root-cause-${Date.now()}.json`, report)} style={{ width: "100%", marginTop: 12, padding: 12, fontWeight: 900 }}>診断JSONを保存</button>
          <details style={{ marginTop: 12 }}><summary>count-only trace</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 520, overflow: "auto", fontSize: 11 }}>{JSON.stringify(report, null, 2)}</pre></details>
        </> : null}
      </section>
    </main>
  );
}
