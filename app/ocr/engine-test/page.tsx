/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import {
  createDocumentRecognitionSession,
  createSharedTesseractWorker,
  recognizeWholeDocument,
} from "../../lib/document-recognition-v2";

type ResultView = {
  quality: string[];
  geometry: string;
  consensus: string;
  confidence: string;
  support: number;
  raw: string;
};

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto", padding: "18px 14px 60px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16, boxShadow: "0 8px 30px #1a28400d" },
  title: { fontSize: 30, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.7 },
  primary: { width: "100%", border: 0, borderRadius: 14, padding: "17px 14px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 18, marginTop: 10 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 14, padding: "15px 14px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 17, marginTop: 10 },
  notice: { padding: "13px 15px", background: "#e9f7ef", border: "1px solid #bfe6ce", borderRadius: 12, lineHeight: 1.6 },
  debug: { width: "100%", minHeight: 360, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" },
};

export default function OcrEngineTestPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("車検証・部品伝票どちらでも、共通OCR V2そのものの認識結果を確認できます。");
  const [result, setResult] = useState<ResultView | null>(null);

  async function run(file: File) {
    setBusy(true);
    setProgress(1);
    setResult(null);
    setMessage("共通OCR V2を解析しています…");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      const session = await createDocumentRecognitionSession(file, {
        maxSide: 3800,
        cropPaper: true,
        minPaperConfidence: 0.45,
      });
      setProgress(10);
      const created = await createSharedTesseractWorker({
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setProgress(Math.max(10, Math.min(94, Math.round((m.progress || 0) * 78) + 12)));
          }
        },
      });
      worker = created.worker;
      const recognition = await recognizeWholeDocument(session, worker, {
        profile: "japanese",
        variants: ["original", "contrast", "adaptiveBinary", "binaryDark"],
        psms: ["11", "6"],
        minSimilarity: 0.50,
        minSupport: 2,
        minConfidence: 0.48,
      });

      const raw = (recognition.observations || []).map((obs: any, index: number) => [
        `--- observation ${index + 1} ---`,
        `variant=${obs.variant || ""} / psm=${obs.psm || ""} / OCR confidence=${Number(obs.confidence || 0).toFixed(1)}`,
        String(obs.text || "").trim(),
      ].join("\n")).join("\n\n");

      setResult({
        quality: session.qualityWarnings.length ? session.qualityWarnings : ["大きな画像品質警告なし"],
        geometry: session.geometry.deskewApplied
          ? `傾き補正あり: ${session.geometry.deskewAngle.toFixed(2)}° / confidence=${session.geometry.deskewConfidence.toFixed(2)}`
          : `傾き補正なし: angle=${session.geometry.deskewAngle.toFixed(2)}° / confidence=${session.geometry.deskewConfidence.toFixed(2)}`,
        consensus: recognition.value || "保留（全文を1つに確定せず、生OCRを比較）",
        confidence: recognition.confidence.toFixed(2),
        support: recognition.support,
        raw,
      });
      setProgress(100);
      setMessage("解析完了。原画像・コントラスト・影対応・通常二値化の生OCRを比較できます。");
    } catch (error) {
      console.error(error);
      setMessage(`共通OCR V2テストでエラー: ${String((error as any)?.message || error)}`);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>共通OCR V2 エンジンテスト</h1>
        <p style={styles.text}>自動入力はしません。画像前処理と文字認識だけを確認する診断画面です。車検証でも部品伝票でも同じエンジンを検証できます。</p>
        <div style={styles.notice}>{message}{busy ? `（${progress}%）` : ""}</div>
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
        <button disabled={busy} style={styles.primary} onClick={() => cameraRef.current?.click()}>📷 撮影してエンジンテスト</button>
        <button disabled={busy} style={styles.secondary} onClick={() => libraryRef.current?.click()}>🖼 写真からエンジンテスト</button>
        {preview && <img src={preview} alt="テスト画像" style={{ width: "100%", maxHeight: 480, objectFit: "contain", borderRadius: 14, marginTop: 16, background: "#eef2f7" }} />}
      </section>

      {result && <>
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>前処理・統合結果</h2>
          <p><strong>{result.geometry}</strong></p>
          <p>近似一致 support: <strong>{result.support}</strong> / confidence: <strong>{result.confidence}</strong></p>
          <div style={styles.notice}>{result.quality.join(" / ")}</div>
          <details>
            <summary style={{ fontWeight: 800, cursor: "pointer" }}>統合OCR文字</summary>
            <textarea readOnly value={result.consensus} style={styles.debug} />
          </details>
        </section>
        <section style={styles.card}>
          <details open>
            <summary style={{ fontWeight: 800, cursor: "pointer" }}>各variant 生OCR比較</summary>
            <p style={styles.text}>どの画像補正・PSMで文字が壊れたかを比較します。adaptiveBinaryは影や照明むらに強い局所二値化です。</p>
            <textarea readOnly value={result.raw} style={styles.debug} />
          </details>
        </section>
      </>}
    </main>
  );
}
