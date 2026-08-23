/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { saveOCRTransferImage } from "../transfer";

type Mode = "dedicated" | "general" | "";

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 920, margin: "0 auto", padding: "18px 14px 60px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16, boxShadow: "0 8px 30px #1a28400d" },
  title: { fontSize: 32, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.75 },
  notice: { padding: "14px 16px", background: "#e9f7ef", border: "1px solid #bfe6ce", borderRadius: 14, lineHeight: 1.7, marginBottom: 14 },
  primary: { width: "100%", border: 0, borderRadius: 14, padding: "17px 14px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 18, marginTop: 10 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 14, padding: "15px 14px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 17, marginTop: 10 },
};

function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を開けませんでした。"));
    };
    img.src = url;
  });
}

async function prepareForDetection(file: File) {
  const img = await loadImage(file);
  const maxSide = 1500;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < image.data.length; p += 4) {
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    let v = Math.round(r * 0.22 + g * 0.70 + b * 0.08);
    v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.22 + 150)));
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("画像変換に失敗しました。")),
      "image/jpeg",
      0.9
    );
  });
}

function classify(text: string): { mode: Mode; reason: string } {
  const t = normalize(text);
  const supplierSignals = ["大一用品商会", "大一用品", "DAIICHI", "MC-E133", "MCE133", "07009330"];
  const dedicatedHits = supplierSignals.filter((x) => t.includes(normalize(x)));
  if (dedicatedHits.length) {
    return { mode: "dedicated", reason: `大一用品商会の特徴を検出: ${dedicatedHits.join(" / ")}` };
  }

  const genericHeaders = [
    "部品名称", "部品名", "品名", "商品名", "名称",
    "個数", "数量", "受注数", "出庫数",
    "定価", "標準価格", "希望小売価格", "売価",
    "仕入れ", "仕入", "原価", "仕切", "単価",
  ];
  const headerHits = genericHeaders.filter((x) => t.includes(normalize(x)));
  if (headerHits.length >= 2) {
    return { mode: "general", reason: `汎用表の見出しを${headerHits.length}個検出: ${headerHits.slice(0, 6).join(" / ")}` };
  }

  return { mode: "general", reason: "大一用品商会の特徴が見つからなかったため、汎用A4・他社伝票OCRを使用します。" };
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
  const [message, setMessage] = useState("伝票を1回選ぶだけで、専用OCRか汎用OCRかを自動判定します。");

  async function detect(file: File) {
    setBusy(true);
    setProgress(1);
    setMode("");
    setReason("");
    setRawText("");
    setMessage("用紙の種類を判定しています…");

    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      await saveOCRTransferImage(file);
      const image = await prepareForDetection(file);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") setProgress(Math.max(1, Math.min(99, Math.round((m.progress || 0) * 100))));
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });

      const result = await worker.recognize(image);
      const text = result.data.text || "";
      const judged = classify(text);
      setRawText(text);
      setMode(judged.mode);
      setReason(judged.reason);
      setProgress(100);
      setMessage(judged.mode === "dedicated" ? "大一用品商会 専用OCRと判定しました。次へ進むと同じ写真で自動読取します。" : "汎用A4・他社伝票OCRと判定しました。次へ進むと同じ写真で自動読取します。");
    } catch (error) {
      console.error(error);
      setMode("general");
      setReason("自動判定に失敗したため、安全側で汎用OCRを選びました。");
      setMessage("自動判定でエラーが出たため、汎用OCRを案内します。");
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  const destination = mode === "dedicated" ? "/ocr" : "/ocr/general";

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>伝票OCR 自動判定</h1>
        <p style={styles.text}>1回だけ撮影・選択して用紙を判定し、その同じ写真を判定先のOCRへ引き継ぎます。</p>
        <div style={styles.notice}>{message}{busy ? `（${progress}%）` : ""}</div>

        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && detect(e.target.files[0])} />
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && detect(e.target.files[0])} />
        <button disabled={busy} style={styles.primary} onClick={() => cameraRef.current?.click()}>📷 今撮影して自動判定</button>
        <button disabled={busy} style={styles.secondary} onClick={() => libraryRef.current?.click()}>🖼 写真ライブラリから自動判定</button>

        {preview && <img src={preview} alt="判定画像" style={{ width: "100%", maxHeight: 380, objectFit: "contain", borderRadius: 14, marginTop: 16, background: "#eef2f7" }} />}
      </section>

      {mode && (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>判定結果</h2>
          <div style={{ ...styles.notice, fontWeight: 800, fontSize: 18 }}>{mode === "dedicated" ? "大一用品商会 専用OCR" : "汎用A4・他社伝票OCR"}</div>
          <p style={styles.text}>{reason}</p>
          <button style={styles.primary} onClick={() => location.assign(destination)}>この写真のまま読み取りへ進む →</button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <button style={styles.secondary} onClick={() => location.assign("/ocr")}>専用OCRへ変更</button>
            <button style={styles.secondary} onClick={() => location.assign("/ocr/general")}>汎用OCRへ変更</button>
          </div>
        </section>
      )}

      <section style={styles.card}>
        <details>
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>判定用OCR詳細</summary>
          <p style={styles.text}>自動判定に使った文字だけを確認できます。</p>
          <textarea readOnly value={rawText} style={{ width: "100%", minHeight: 220, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" }} />
        </details>
      </section>
    </main>
  );
}
