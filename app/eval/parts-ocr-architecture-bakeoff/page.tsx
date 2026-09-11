/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useRef, useState } from "react";
import { runBrowserCandidates } from "../../ocr/bakeoff/browser-candidates";
import { BAKEOFF_CONTRACT_VERSION, fieldsFromRows, type BakeoffPrediction, type QualityMetrics } from "../../ocr/bakeoff/contract";
import { buildLocalHybrid } from "../../ocr/bakeoff/hybrid";
import { runP2Local } from "../../ocr/bakeoff/p2-client";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8765";

function canonicalId(name: string) {
  return name.match(/IMG[_-]?(\d{4})/i)?.[1] ? `IMG_${name.match(/IMG[_-]?(\d{4})/i)![1]}` : name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function failedP2(base: BakeoffPrediction, error: unknown): BakeoffPrediction {
  const message = error instanceof DOMException && error.name === "AbortError" ? "P2 timeout" : String((error as any)?.message || error);
  const quality: QualityMetrics = { ...base.qualityMetrics, accepted: false, rejectionReasons: [...base.qualityMetrics.rejectionReasons, "p2-unavailable"] };
  return {
    schema: BAKEOFF_CONTRACT_VERSION,
    runId: base.runId,
    candidateId: "P2",
    candidateVersion: "ppstructurev3-ppocrv5-server.v1",
    configHash: "sha256:99fa30b32b22d28310cae161a754343423918a90a13bb80c12b64ba0c80504ae",
    imageId: base.imageId,
    captureId: base.captureId,
    documentFamilyPrediction: { family: "unknown", confidence: null },
    documentRegions: [],
    qualityMetrics: quality,
    rowPredictions: [],
    fieldPredictions: fieldsFromRows([]),
    confidence: null,
    abstainReason: "p2-unavailable",
    manualReviewRequired: true,
    processingTimeMs: 0,
    modelLoadTimeMs: null,
    memoryBytes: null,
    timeout: message === "P2 timeout",
    error: message,
    gtIncluded: false,
  };
}

function download(results: BakeoffPrediction[]) {
  const payload = { schema: "icb.parts-ocr.bakeoff-export.v1", createdAt: new Date().toISOString(), gtIncluded: false, results };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `icb-parts-bakeoff-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PartsOcrArchitectureBakeoffPage() {
  const input = useRef<HTMLInputElement>(null);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("画像はbrowser memory内だけで処理します。P2 endpointを起動してから選択してください。");
  const [results, setResults] = useState<BakeoffPrediction[]>([]);
  const summary = useMemo(() => results.reduce<Record<string, { captures: number; rows: number; manual: number; errors: number; processingMs: number }>>((all, result) => {
    const current = all[result.candidateId] ?? { captures: 0, rows: 0, manual: 0, errors: 0, processingMs: 0 };
    current.captures += 1;
    current.rows += result.rowPredictions.length;
    current.manual += result.manualReviewRequired ? 1 : 0;
    current.errors += result.error ? 1 : 0;
    current.processingMs += result.processingTimeMs;
    all[result.candidateId] = current;
    return all;
  }, {}), [results]);

  async function run(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setResults([]);
    const output: BakeoffPrediction[] = [];
    try {
      for (const [index, file] of Array.from(files).entries()) {
        const imageId = canonicalId(file.name);
        const captureId = `${imageId}-capture-${String(index + 1).padStart(2, "0")}`;
        const browser = await runBrowserCandidates(file, imageId, captureId, setStatus);
        setStatus(`${imageId}: P2 local/private endpoint`);
        let p2: BakeoffPrediction;
        try {
          p2 = await runP2Local({ endpoint, file, runId: browser.p0.runId, imageId, captureId });
        } catch (error) {
          p2 = failedP2(browser.p1, error);
        }
        setStatus(`${imageId}: P4-L deterministic decision`);
        const p4 = buildLocalHybrid(browser.p1, p2);
        output.push(browser.p0, browser.p1, p2, p4);
        setResults([...output]);
      }
      setStatus(`完了：${files.length} captures × 4 candidates。これはpredictionのみで、GT採点は別工程です。`);
    } catch (error: any) {
      setStatus(`STOP: ${String(error?.message || error)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 12px 60px", color: "#172033" }}>
      <section style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>Parts OCR Architecture Bakeoff PoC</h1>
        <p>P0 Frozen adapter / P1 Guided known-template / P2 local PP-StructureV3 / P4-L deterministic hybridを同一contractで実行します。</p>
        <p><b>GTはruntimeに読み込みません。画像・predictionはserverへ永続保存せず、外部managed APIも使用しません。</b></p>
      </section>
      <section style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <label htmlFor="p2-endpoint" style={{ display: "block", fontWeight: 800 }}>P2 local endpoint</label>
        <input id="p2-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} style={{ width: "100%", padding: 11, margin: "7px 0 12px", border: "1px solid #ccd5e3", borderRadius: 9 }} />
        <input ref={input} hidden type="file" accept="image/*" multiple onChange={(event) => void run(event.target.files)} />
        <button disabled={busy} onClick={() => input.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>{busy ? "実行中…" : "Regression画像を選択"}</button>
        <div role="status" aria-live="polite" style={{ marginTop: 10 }}>{status}</div>
      </section>
      {results.length > 0 ? <section style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16 }}>
        <h2>Prediction summary（未採点）</h2>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th>候補</th><th>captures</th><th>rows</th><th>manual</th><th>errors</th><th>processing ms</th></tr></thead><tbody>{Object.entries(summary).map(([candidate, value]) => <tr key={candidate}><td>{candidate}</td><td>{value.captures}</td><td>{value.rows}</td><td>{value.manual}</td><td>{value.errors}</td><td>{value.processingMs}</td></tr>)}</tbody></table></div>
        <button onClick={() => download(results)} style={{ width: "100%", marginTop: 12, padding: 12, fontWeight: 900 }}>GTなしprediction JSONを保存</button>
        <details style={{ marginTop: 12 }}><summary>contract preview</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 500, overflow: "auto", fontSize: 11 }}>{JSON.stringify(results, null, 2)}</pre></details>
      </section> : null}
    </main>
  );
}
