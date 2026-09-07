/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { prepareOCRInputFile } from "../../transfer";
import { detectHorizontalRuleBands, mergeDynamicRows, rowBandsFromRules, rowBandsFromTSV, type CropBox, type RowBand } from "../../dynamic-rows";
import { detectSlipColumnProfile } from "../../general/slip-profiles";

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto", padding: "18px 14px 60px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 18, padding: 18, marginBottom: 14 },
  title: { fontSize: 28, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.7 },
  button: { width: "100%", border: 0, borderRadius: 12, padding: "15px 12px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 17 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 12, padding: "14px 12px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 16, marginTop: 10 },
  debug: { width: "100%", minHeight: 520, border: "1px solid #d6deea", borderRadius: 10, padding: 10, fontSize: 12, background: "#f8fafc", whiteSpace: "pre-wrap" },
};

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を開けませんでした。")); };
    img.src = url;
  });
}

async function orientedColorCanvas(file: File) {
  const img = await loadImage(file);
  const rotate = img.naturalHeight > img.naturalWidth * 1.08;
  const sourceWidth = rotate ? img.naturalHeight : img.naturalWidth;
  const sourceHeight = rotate ? img.naturalWidth : img.naturalHeight;
  const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (rotate) {
    ctx.save();
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, canvas.height, canvas.width);
    ctx.restore();
  } else ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, rotate };
}

async function fileCanvas(file: File) {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function detectPaperBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 800));
  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const yellow = r > 100 && g > 95 && r + g > b * 1.75;
    return bright > 150 || yellow;
  };
  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0; let count = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.18) ys.push(y);
  }
  if (ys.length < 4) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const roughBottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0; let count = 0;
    for (let y = top; y <= roughBottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.20) xs.push(x);
  }
  const left = xs.length ? Math.max(0, xs[0] - step * 2) : 0;
  const right = xs.length ? Math.min(w - 1, xs[xs.length - 1] + step * 2) : w - 1;
  const width = right - left + 1;
  let boxHeight = roughBottom - top + 1;
  const expectedHeight = Math.round(width / 1.74);
  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) boxHeight = Math.min(expectedHeight, h - top);
  if (width < w * 0.55 || boxHeight < h * 0.25) return { x: 0, y: 0, w, h };
  return { x: left, y: top, w: width, h: boxHeight };
}

async function canvasBlob(canvas: HTMLCanvasElement, quality = 0.95) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像変換失敗")), "image/jpeg", quality));
}

async function rowBlob(source: HTMLCanvasElement, paper: CropBox, row: RowBand) {
  const x = Math.max(0, Math.round(paper.x + paper.w * 0.015));
  const right = Math.min(source.width, Math.round(paper.x + paper.w * 0.985));
  const y = Math.max(0, row.top);
  const bottom = Math.min(source.height, row.bottom + 1);
  const w = Math.max(1, right - x);
  const h = Math.max(1, bottom - y);
  const targetWidth = 2200;
  const scale = Math.min(5, Math.max(1, targetWidth / w));
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("行crop失敗");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, x, y, w, h, 0, 0, out.width, out.height);
  return canvasBlob(out);
}

function rowSummary(rows: RowBand[]) {
  if (!rows.length) return "<none>";
  return rows.map((row, i) => `${i + 1}: top=${row.top} bottom=${row.bottom} center=${row.center} h=${row.bottom - row.top + 1} source=${row.source}`).join("\n");
}

export default function DynamicPartsOCRDiagnosticPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("黄色または白の実写真を選択してください。");
  const [preview, setPreview] = useState("");

  async function diagnose(file: File) {
    const logs: string[] = [];
    let worker: any = null;
    setBusy(true);
    try {
      const color = await orientedColorCanvas(file);
      const colorPaper = detectPaperBox(color.canvas);
      const colorCtx = color.canvas.getContext("2d", { willReadFrequently: true });
      if (!colorCtx) throw new Error("色保持画像を読めませんでした。");
      const rgba = colorCtx.getImageData(0, 0, color.canvas.width, color.canvas.height).data;
      const rules = detectHorizontalRuleBands(rgba, color.canvas.width, color.canvas.height, colorPaper);
      const ruleRows = rowBandsFromRules(rules, colorPaper);

      const prepared = await prepareOCRInputFile(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(prepared));
      const ocrSource = await fileCanvas(prepared);

      logs.push(`元画像=${file.name} / rotate90CCW=${color.rotate ? "YES" : "NO"}`);
      logs.push(`色保持geometry=${color.canvas.width}x${color.canvas.height}`);
      logs.push(`OCR source=${ocrSource.width}x${ocrSource.height}`);
      logs.push(`座標系一致=${color.canvas.width === ocrSource.width && color.canvas.height === ocrSource.height ? "YES" : "NO"}`);
      logs.push(`color paper box=${JSON.stringify(colorPaper)}`);
      logs.push(`横罫線=${rules.length}本: ${rules.map((r) => r.center).join(", ") || "<none>"}`);
      logs.push(`\n横罫線由来row候補 ${ruleRows.length}件\n${rowSummary(ruleRows)}`);

      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3", user_defined_dpi: "300", tessedit_char_whitelist: "" });
      const full = await worker.recognize(await canvasBlob(ocrSource, 0.96), {}, { text: true, tsv: true });
      const rawText = full.data.text || "";
      const tsv = full.data.tsv || "";
      const tsvRows = rowBandsFromTSV(tsv, colorPaper);
      const merged = mergeDynamicRows(ruleRows, tsvRows, colorPaper);
      const profile = detectSlipColumnProfile(rawText);

      logs.push(`\nTesseract全文: textChars=${rawText.length} / tsvChars=${tsv.length}`);
      logs.push(`明細らしい語=${/部品|名称|数量|受注|出庫|標準価格|単価|ガスケット|プラグ|ワイパ|クラッチ/i.test(rawText) ? "YES" : "NO"}`);
      logs.push(`白帳票profile=${profile ? `${profile.id} / 単価→${profile.unitPriceTarget} / missingCost→${profile.missingCost}` : "not-detected"}`);
      logs.push(`\nTSV由来row候補 ${tsvRows.length}件\n${rowSummary(tsvRows)}`);
      logs.push(`\n統合row候補 ${merged.length}件\n${rowSummary(merged)}`);

      await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: tesseract.PSM?.SINGLE_LINE ?? "7", user_defined_dpi: "300", tessedit_char_whitelist: "" });
      const rowTexts: string[] = [];
      for (let i = 0; i < merged.length; i += 1) {
        const text = ((await worker.recognize(await rowBlob(ocrSource, colorPaper, merged[i]))).data.text || "").trim();
        rowTexts.push(text);
        logs.push(`dynamic row ${i + 1}: ${JSON.stringify(text || "<EMPTY>")}`);
      }

      const nonEmpty = rowTexts.filter((x) => x.trim()).length;
      logs.push(`\n診断結論材料: dynamicRows=${merged.length} / rowOCR非空=${nonEmpty}`);
      if (profile) logs.push("白帳票ではこのprofileが検出された場合のみ、単価を定価側・仕入れ空欄として扱う候補です。汎用parser全体の意味変更はしていません。");
      logs.push("このページは診断専用です。既存OCR本体・正式保存・Preview採用判定は変更していません。");
      logs.push(`\n生OCR先頭:\n${rawText.slice(0, 2500) || "<EMPTY>"}`);
      setReport(logs.join("\n\n"));
    } catch (error) {
      logs.push(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      setReport(logs.join("\n\n"));
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>部品OCR 動的行診断</h1>
        <p style={styles.text}>色保持画像の横罫線とOCR TSV文字位置を別々に検出し、固定firstRowY/rowStepを使わず明細行候補を比較する診断専用ページです。</p>
        <input ref={inputRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && diagnose(e.target.files[0])} />
        <button disabled={busy} style={styles.button} onClick={() => inputRef.current?.click()}>{busy ? "診断中…" : "実写真を動的行診断"}</button>
        <button style={styles.secondary} onClick={() => location.assign("/ocr/diagnostic")}>固定row診断へ戻る</button>
        {preview && <img src={preview} alt="OCR前処理画像" style={{ width: "100%", maxHeight: 420, objectFit: "contain", marginTop: 14, borderRadius: 10, background: "#eef2f7" }} />}
      </section>
      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>動的行診断ログ</h2>
        <textarea readOnly value={report} style={styles.debug} />
      </section>
    </main>
  );
}
