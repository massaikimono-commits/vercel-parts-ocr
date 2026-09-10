"use client";

import { useState } from "react";
import { runBrowserModelDiagnostics } from "./model-diagnostics";

const card: React.CSSProperties = { background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14, marginBottom: 12 };
const pre: React.CSSProperties = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f7f9fc", border: "1px solid #e2e7ef", borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, maxHeight: 680, overflow: "auto" };

export default function Client({ deployedHead }: { deployedHead: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("実写真を使わず、model / dictionary / decoder contractを検証できます。");
  const [result, setResult] = useState<any>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setStatus("ONNX model / dictionary / synthetic sanity check実行中…");
    try {
      const out = await runBrowserModelDiagnostics();
      setResult({ ...out, deployedHead });
      setStatus("synthetic/basic recognizer sanity check完了。実写真は使用していません。");
    } catch (e: any) {
      setStatus(`ERROR: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ maxWidth: 1040, margin: "0 auto", padding: "16px 12px 60px", background: "#f5f7fb", minHeight: "100vh", color: "#172033" }}>
    <section style={card}>
      <h1 style={{ margin: 0 }}>Stage A21 Cell-Crop / Recognizer Interface Root-Cause Isolation</h1>
      <p>精度調整ではなく、A20のcell crop・recognizer interface・decoder contractを分解監査します。</p>
      <div style={{ fontSize: 13 }}><strong>deployed commit:</strong> {deployedHead}</div>
    </section>

    <section style={card}>
      <h2>コード監査で確定した確認点</h2>
      <ul style={{ lineHeight: 1.7 }}>
        <li>A20 ONNX decoderは「class axis = output last dimension」「blank index = 0」「dictionary index offset = +1」「space = dictLength+1」を仮定。</li>
        <li>A20は完全blankのrecognition rowをengineRowsへ追加しないため、後続rowがGT indexに詰められる可能性がある。これはrecognizer精度とは別の<strong>評価alignment confound</strong>。</li>
        <li>A20 cropはA19_TABLE geometryを使うため、dynamic row不足とcrop/recognizer failureを別々に判定する必要がある。</li>
      </ul>
    </section>

    <section style={card}>
      <h2>Model / Decoder invariant</h2>
      <p>実写真なしで、実際のONNX modelとdictionaryをbrowser/WASMでloadし、output dims・class count・dictionary length・CTC index relationを実測します。</p>
      <button disabled={busy} onClick={run} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: busy ? "#aeb8c7" : "#2468df", color: "#fff", fontWeight: 800, fontSize: 16 }}>
        {busy ? "診断中…" : "実写真なしでmodel/decoder自己診断"}
      </button>
      <div style={{ marginTop: 10, fontSize: 13 }}>{status}</div>
      {result && <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>}
    </section>

    <section style={card}>
      <h2>Cell crop instrumentation</h2>
      <p style={{ lineHeight: 1.6 }}>実写真再run用instrumentationは、crop dimensions / dark occupancy / ink bbox / edge truncation / strong table-line混入 / centroid slope / raw recognizer output / normalized output / confidence / decoder metadataをbrowser内だけで記録できる構成です。</p>
      <div style={{ padding: 10, borderRadius: 8, background: "#fff4e5", fontWeight: 700 }}>実写真再run：HOLD。Stage A21診断結果から必要性を判定するまで画像選択UIは出しません。</div>
    </section>
  </main>;
}
