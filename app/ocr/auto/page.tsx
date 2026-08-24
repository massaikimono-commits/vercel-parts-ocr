/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { saveOCRTransferImage } from "../transfer";
import {
  createDocumentRecognitionSession,
  createSharedTesseractWorker,
  recognizeDocumentRegion,
  recognizeWholeDocument,
  OCR_FIELD_PRESETS,
} from "../../lib/document-recognition-v2";

type Mode = "dedicated" | "general" | "unknown" | "";

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 920, margin: "0 auto", padding: "18px 14px 60px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16, boxShadow: "0 8px 30px #1a28400d" },
  title: { fontSize: 32, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.75 },
  notice: { padding: "14px 16px", background: "#e9f7ef", border: "1px solid #bfe6ce", borderRadius: 14, lineHeight: 1.7, marginBottom: 14 },
  warning: { padding: "14px 16px", background: "#fff7e6", border: "1px solid #f0cf8c", borderRadius: 14, lineHeight: 1.7, marginBottom: 14 },
  primary: { width: "100%", border: 0, borderRadius: 14, padding: "17px 14px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 18, marginTop: 10 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 14, padding: "15px 14px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 17, marginTop: 10 },
};

function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function classify(text: string): { mode: Mode; reason: string; auto: boolean } {
  const t = normalize(text);

  const supplierSignals = [
    "大一用品商会", "大一用品", "用品商会", "DAIICHI",
    "MC-E133", "MCE133", "07009330",
  ];
  const dedicatedHits = supplierSignals.filter((x) => t.includes(normalize(x)));
  if (dedicatedHits.length) {
    return { mode: "dedicated", reason: `大一用品商会の特徴を検出: ${dedicatedHits.join(" / ")}`, auto: true };
  }

  const dedicatedFormatHeaders = ["受注数", "出庫数", "標準価格", "倉庫", "棚番", "受注残"];
  const formatHits = dedicatedFormatHeaders.filter((x) => t.includes(normalize(x)));
  if (formatHits.length >= 3) {
    return { mode: "dedicated", reason: `専用伝票の列構成を検出: ${formatHits.join(" / ")}`, auto: true };
  }

  const genericHeaders = [
    "部品名称", "部品名", "品名", "商品名", "名称",
    "個数", "数量", "定価", "希望小売価格", "売価",
    "仕入れ", "仕入", "原価", "仕切", "仕切価格",
  ];
  const headerHits = genericHeaders.filter((x) => t.includes(normalize(x)));
  if (headerHits.length >= 3) {
    return { mode: "general", reason: `汎用表の見出しを${headerHits.length}個検出: ${headerHits.slice(0, 6).join(" / ")}`, auto: true };
  }

  return {
    mode: "unknown",
    reason: "専用伝票・汎用伝票のどちらかを安全に確定できませんでした。誤判定を避けるため自動移動を止めました。",
    auto: false,
  };
}

function observationText(result: any) {
  const texts = (result?.observations || [])
    .map((x: any) => String(x?.text || "").trim())
    .filter(Boolean);
  if (result?.value) texts.unshift(String(result.value));
  return [...new Set(texts)].join("\n");
}

async function readDedicatedMarkers(session: any, worker: any) {
  // These regions are intentionally broad and document-relative. They are not tuned
  // to one photographed sample; paper crop + deskew happens in the shared engine.
  const regions = [
    { x: 0.00, y: 0.00, width: 1.00, height: 0.36 },
    { x: 0.00, y: 0.28, width: 0.92, height: 0.34 },
  ];
  const texts: string[] = [];
  for (const region of regions) {
    const result = await recognizeDocumentRegion(session, worker, region, {
      ...OCR_FIELD_PRESETS.japaneseText,
      variants: ["original", "contrast", "binaryDark"],
      psms: ["11", "6"],
      targetWidth: 2600,
      minSimilarity: 0.56,
      minSupport: 2,
      minConfidence: 0.52,
    });
    const text = observationText(result);
    if (text) texts.push(text);
  }
  return texts.join("\n");
}

export default function AutoOCRPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState("");
  const [mode, setMode] = useState<Mode>("");
  const [reason, setReason] = useState("");
  const [rawText, setRawText] = useState("");
  const [message, setMessage] = useState("伝票を1回選ぶだけで、共通OCR V2が用紙を読み取り、専用/汎用を自動判定します。");

  async function detect(file: File) {
    setBusy(true);
    setProgress(1);
    setMode("");
    setReason("");
    setRawText("");
    setMessage("共通OCR V2で用紙を補正・判定しています…");

    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      await saveOCRTransferImage(file);
      const session = await createDocumentRecognitionSession(file, {
        maxSide: 3400,
        cropPaper: true,
        minPaperConfidence: 0.45,
      });
      setProgress(8);

      const created = await createSharedTesseractWorker({
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setProgress(Math.max(8, Math.min(88, Math.round((m.progress || 0) * 70) + 12)));
          }
        },
      });
      worker = created.worker;

      const whole = await recognizeWholeDocument(session, worker, {
        profile: "japanese",
        variants: ["original", "contrast", "binaryDark"],
        psms: ["11", "6"],
        minSimilarity: 0.52,
        minSupport: 2,
        minConfidence: 0.50,
      });

      let text = observationText(whole);
      let judged = classify(text);
      const diagnostics = [
        `共通OCR V2: ${whole.reason}`,
        `傾き補正: ${session.geometry.deskewApplied ? `${session.geometry.deskewAngle.toFixed(2)}°` : "不要/保留"}`,
        ...(session.qualityWarnings || []).map((x: string) => `画像品質: ${x}`),
      ];

      if (judged.mode !== "dedicated") {
        setMessage("共通OCR V2で伝票上部と明細見出しを再確認しています…");
        setProgress(88);
        const markerText = await readDedicatedMarkers(session, worker);
        if (markerText) text = `${text}\n\n【見出し再確認】\n${markerText}`;
        const secondJudgement = classify(text);
        if (secondJudgement.mode === "dedicated") judged = secondJudgement;
        else if (judged.mode === "unknown") judged = secondJudgement;
      }

      setRawText(`${diagnostics.join("\n")}\n\n【認識文字】\n${text}`);
      setMode(judged.mode);
      setReason(judged.reason);
      setProgress(100);

      if (judged.mode === "dedicated") {
        setMessage("大一用品商会 専用OCRと判定しました。自動で読み取りへ進みます…");
        window.setTimeout(() => location.assign("/ocr"), 650);
      } else if (judged.mode === "general") {
        setMessage("汎用A4・他社伝票OCRと判定しました。自動で読み取りへ進みます…");
        window.setTimeout(() => location.assign("/ocr/general"), 650);
      } else {
        setMessage("文字認識は完了しましたが帳票種別を安全に確定できませんでした。下から読み取り方式を選べます。");
      }
    } catch (error) {
      console.error(error);
      setMode("unknown");
      setReason("共通OCR V2の判定処理でエラーが出ました。誤ったOCRへ送らないよう自動移動を止めました。");
      setMessage("自動判定を止めました。下から読み取り方式を選べます。");
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>伝票OCR 自動判定</h1>
        <p style={styles.text}>車検証と共通の画像補正・傾き補正・複数画像OCR・近似文字統合を使って読み取ります。判定に自信がない時は勝手に別のOCRへ進みません。</p>
        <div style={mode === "unknown" ? styles.warning : styles.notice}>{message}{busy ? `（${progress}%）` : ""}</div>

        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && detect(e.target.files[0])} />
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && detect(e.target.files[0])} />
        <button disabled={busy} style={styles.primary} onClick={() => cameraRef.current?.click()}>📷 今撮影して自動読み取り</button>
        <button disabled={busy} style={styles.secondary} onClick={() => libraryRef.current?.click()}>🖼 写真ライブラリから自動読み取り</button>

        {preview && <img src={preview} alt="判定画像" style={{ width: "100%", maxHeight: 380, objectFit: "contain", borderRadius: 14, marginTop: 16, background: "#eef2f7" }} />}
      </section>

      {mode && (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>判定結果</h2>
          <div style={mode === "unknown" ? styles.warning : { ...styles.notice, fontWeight: 800, fontSize: 18 }}>
            {mode === "dedicated" ? "大一用品商会 専用OCR" : mode === "general" ? "汎用A4・他社伝票OCR" : "判定保留"}
          </div>
          <p style={styles.text}>{reason}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button style={styles.secondary} onClick={() => location.assign("/ocr")}>大一用品商会 専用OCR</button>
            <button style={styles.secondary} onClick={() => location.assign("/ocr/general")}>汎用A4・他社伝票OCR</button>
          </div>
        </section>
      )}

      <section style={styles.card}>
        <details>
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>判定用OCR詳細</summary>
          <p style={styles.text}>共通OCR V2の画像品質・傾き補正・複数OCR結果を表示します。</p>
          <textarea readOnly value={rawText} style={{ width: "100%", minHeight: 260, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" }} />
        </details>
      </section>
    </main>
  );
}
