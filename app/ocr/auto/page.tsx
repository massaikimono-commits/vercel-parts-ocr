/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { saveOCRTransferImage } from "../transfer";
import { validateDocumentFile } from "../../lib/file-security";

type Mode = "dedicated" | "general" | "unknown" | "";
type CropBox = { x: number; y: number; w: number; h: number };

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

function toBlob(canvas: HTMLCanvasElement, quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("画像変換に失敗しました。")),
      "image/jpeg",
      quality
    );
  });
}

async function sourceCanvas(file: File, maxSide = 2200) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function detectPaperBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(3, Math.floor(Math.max(w, h) / 700));
  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const yellow = r > 100 && g > 95 && r + g > b * 1.72;
    return bright > 150 || yellow;
  };

  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0;
    let count = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.17) ys.push(y);
  }
  if (ys.length < 4) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let count = 0;
    for (let y = top; y <= bottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.18) xs.push(x);
  }
  if (xs.length < 4) return { x: 0, y: 0, w, h };

  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  if (box.w < w * 0.48 || box.h < h * 0.25) return { x: 0, y: 0, w, h };
  return box;
}

function relativeBox(paper: CropBox, x: number, y: number, w: number, h: number): CropBox {
  return {
    x: Math.round(paper.x + paper.w * x),
    y: Math.round(paper.y + paper.h * y),
    w: Math.max(1, Math.round(paper.w * w)),
    h: Math.max(1, Math.round(paper.h * h)),
  };
}

async function enhancedCrop(source: HTMLCanvasElement, box: CropBox, targetWidth = 1800) {
  const scale = Math.min(6, Math.max(1, targetWidth / box.w));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < image.data.length; p += 4) {
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    let v = Math.round(r * 0.20 + g * 0.72 + b * 0.08);
    v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.35 + 150)));
    if (v > 246) v = 255;
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return toBlob(canvas);
}

async function prepareForDetection(file: File) {
  const canvas = await sourceCanvas(file, 1600);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
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
  return toBlob(canvas, 0.9);
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

  // 大一用品商会の帳票は、この列見出しの組み合わせも特徴として使う。
  const dedicatedFormatHeaders = ["受注数", "出庫数", "標準価格", "倉庫", "棚番", "受注残"];
  const formatHits = dedicatedFormatHeaders.filter((x) => t.includes(normalize(x)));
  if (formatHits.length >= 3) {
    return { mode: "dedicated", reason: `専用伝票の列構成を検出: ${formatHits.join(" / ")}`, auto: true };
  }

  const genericHeaders = [
    "部品名称", "部品名", "品名", "商品名", "名称",
    "個数", "数量", "定価", "単価", "希望小売価格", "売価",
    "仕入れ", "仕入", "原価", "仕切", "仕切価格",
  ];
  const headerHits = genericHeaders.filter((x) => t.includes(normalize(x)));
  if (headerHits.length >= 3) {
    return { mode: "general", reason: `汎用表の見出しを${headerHits.length}個検出: ${headerHits.slice(0, 6).join(" / ")}`, auto: true };
  }

  // 判定が弱い時は勝手に汎用へ送らない。
  return {
    mode: "unknown",
    reason: "専用伝票・汎用伝票のどちらかを安全に確定できませんでした。誤判定を避けるため自動移動を止めました。",
    auto: false,
  };
}

async function readDedicatedMarkers(worker: any, tesseract: any, file: File) {
  const source = await sourceCanvas(file, 2400);
  const paper = detectPaperBox(source);
  const crops = [
    // 上部：納品書タイトル、会社名、伝票ヘッダ周辺
    relativeBox(paper, 0.00, 0.00, 1.00, 0.34),
    // 最初の部品行：品番・名称・価格周辺
    relativeBox(paper, 0.00, 0.32, 0.84, 0.28),
  ];

  const texts: string[] = [];
  await worker.setParameters({
    tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
    preserve_interword_spaces: "1",
    tessedit_char_whitelist: "",
    user_defined_dpi: "300",
  });
  for (const crop of crops) {
    const image = await enhancedCrop(source, crop, 2200);
    texts.push((await worker.recognize(image)).data.text || "");
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
  const [message, setMessage] = useState("伝票を1回選ぶだけで、専用OCRか汎用OCRかを自動判定します。");

  async function detect(file: File) {
    const fileCheck = await validateDocumentFile(file);
    if (!fileCheck.ok) { setMessage(fileCheck.message); return; }
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
      const tesseract: any = await import("../../lib/tesseract-local");
      worker = await tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") setProgress(Math.max(1, Math.min(94, Math.round((m.progress || 0) * 80) + 5)));
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: "",
        user_defined_dpi: "300",
      });

      const result = await worker.recognize(image);
      let text = result.data.text || "";
      let judged = classify(text);

      // 全体OCRで専用判定できなかった場合だけ、専用帳票の重要部分を拡大して再確認。
      if (judged.mode !== "dedicated") {
        setMessage("専用伝票の特徴を拡大して再確認しています…");
        setProgress(82);
        const markerText = await readDedicatedMarkers(worker, tesseract, file);
        text = `${text}\n\n【専用判定用拡大OCR】\n${markerText}`;
        const secondJudgement = classify(text);
        if (secondJudgement.mode === "dedicated") judged = secondJudgement;
        else if (judged.mode === "unknown") judged = secondJudgement;
      }

      setRawText(text);
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
        setMessage("自動判定を確定できませんでした。下のボタンから専用OCRか汎用OCRを選んでください。");
      }
    } catch (error) {
      console.error(error);
      setMode("unknown");
      setReason("自動判定処理でエラーが出ました。誤ったOCRへ送らないよう自動移動を止めました。");
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
        <p style={styles.text}>1回だけ撮影・選択すれば、用紙判定から専用/汎用OCRへの移動、同じ写真の読み取り開始まで自動で進みます。判定に自信がない時は勝手に汎用へ進みません。</p>
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
          <p style={styles.text}>全体OCRに加えて、専用伝票の重要部分を拡大して再確認した文字も表示します。</p>
          <textarea readOnly value={rawText} style={{ width: "100%", minHeight: 260, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" }} />
        </details>
      </section>
    </main>
  );
}
