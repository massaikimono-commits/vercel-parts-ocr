/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { prepareOCRInputFile } from "../transfer";

type CropBox = { x: number; y: number; w: number; h: number };
type Mode = "dedicated" | "general" | "unknown";

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto", padding: "18px 14px 60px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 18, padding: 18, marginBottom: 14 },
  title: { fontSize: 28, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.7 },
  button: { width: "100%", border: 0, borderRadius: 12, padding: "15px 12px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 17 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 12, padding: "14px 12px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 16, marginTop: 10 },
  debug: { width: "100%", minHeight: 420, border: "1px solid #d6deea", borderRadius: 10, padding: 10, fontSize: 12, background: "#f8fafc", whiteSpace: "pre-wrap" },
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

async function orientationOnlyCanvas(file: File) {
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
  } else {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
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
    if (count && hit / count > 0.2) xs.push(x);
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

function relativeBox(paper: CropBox, x: number, y: number, w: number, h: number): CropBox {
  return {
    x: Math.round(paper.x + paper.w * x),
    y: Math.round(paper.y + paper.h * y),
    w: Math.max(1, Math.round(paper.w * w)),
    h: Math.max(1, Math.round(paper.h * h)),
  };
}

async function cropBlob(source: HTMLCanvasElement, box: CropBox, targetWidth = 1500) {
  const scale = Math.min(8, Math.max(1, targetWidth / box.w));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("crop失敗");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < image.data.length; p += 4) {
    const v0 = Math.round(image.data[p] * 0.20 + image.data[p + 1] * 0.72 + image.data[p + 2] * 0.08);
    const v = Math.max(0, Math.min(255, Math.round((v0 - 128) * 1.25 + 148)));
    image.data[p] = v; image.data[p + 1] = v; image.data[p + 2] = v; image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("crop変換失敗")), "image/jpeg", 0.95));
}

function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function classify(text: string): Mode {
  const t = normalize(text);
  const dedicatedSignals = ["大一用品商会", "大一用品", "用品商会", "DAIICHI", "MC-E133", "MCE133", "07009330"];
  if (dedicatedSignals.some((x) => t.includes(normalize(x)))) return "dedicated";
  const dedicatedHeaders = ["受注数", "出庫数", "標準価格", "倉庫", "棚番", "受注残"];
  if (dedicatedHeaders.filter((x) => t.includes(normalize(x))).length >= 3) return "dedicated";
  const genericHeaders = ["部品名称", "部品名", "品名", "商品名", "名称", "個数", "数量", "定価", "希望小売価格", "売価", "仕入れ", "仕入", "原価", "仕切", "仕切価格"];
  if (genericHeaders.filter((x) => t.includes(normalize(x))).length >= 3) return "general";
  return "unknown";
}

function digits(raw: string) {
  return raw.normalize("NFKC").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^\d]/g, "");
}

function moneyValue(raw: string) {
  const n = Number(digits(raw));
  return Number.isFinite(n) && n >= 100 && n <= 5000000 ? String(n) : "";
}

function qtyValue(raw: string) {
  const n = Number(digits(raw));
  return Number.isFinite(n) && n >= 1 && n <= 99 ? String(n) : "";
}

function nameCandidate(raw: string) {
  const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (text.length < 3) return "";
  if (/品番|品名|受注|出庫|標準価格|単価|金額|倉庫|棚番|受注残|年月日|売上|コード|合計|伝票|型式|車台/.test(text)) return "";
  return text;
}

function nameStrong(name: string) {
  if (!name) return false;
  const jp = name.match(/[ぁ-んァ-ヶ一-龠]/g)?.length || 0;
  const alpha = name.match(/[A-Za-z]/g)?.length || 0;
  return jp * 2 + alpha >= 8 || /ASSY|COMP|KIT|SET|クラッチ|ブレーキ|パッド|フィルタ|オイル|ベルト|ホース|ガスケット/i.test(name);
}

export default function PartsOCRDiagnosticPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("診断画像を選択してください。");
  const [preview, setPreview] = useState("");

  async function diagnose(file: File) {
    setBusy(true);
    const logs: string[] = [];
    let worker: any = null;
    try {
      logs.push(`1. 元画像: ${file.name} / ${file.type || "unknown"} / ${file.size} bytes`);
      const original = await loadImage(file);
      logs.push(`   raw dimensions=${original.naturalWidth}x${original.naturalHeight}`);

      const oriented = await orientationOnlyCanvas(file);
      logs.push(`2. 向き補正: rotate90CCW=${oriented.rotate ? "YES" : "NO"} / ${oriented.canvas.width}x${oriented.canvas.height}`);
      const colorPaper = detectPaperBox(oriented.canvas);
      logs.push(`4. 色保持paper box: x=${colorPaper.x} y=${colorPaper.y} w=${colorPaper.w} h=${colorPaper.h}`);

      const preparedFile = await prepareOCRInputFile(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(preparedFile));
      const ocrSource = await fileCanvas(preparedFile);
      const grayPaper = detectPaperBox(ocrSource);
      logs.push(`5. OCR用前処理画像: ${ocrSource.width}x${ocrSource.height} / ${preparedFile.name}`);
      logs.push(`   現行gray後paper box: x=${grayPaper.x} y=${grayPaper.y} w=${grayPaper.w} h=${grayPaper.h}`);
      logs.push(`   color/gray座標差: dx=${grayPaper.x - colorPaper.x} dy=${grayPaper.y - colorPaper.y} dw=${grayPaper.w - colorPaper.w} dh=${grayPaper.h - colorPaper.h}`);

      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1);
      await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3", user_defined_dpi: "300", tessedit_char_whitelist: "" });
      const fullBlob = await new Promise<Blob>((resolve, reject) => ocrSource.toBlob((b) => b ? resolve(b) : reject(new Error("全体画像変換失敗")), "image/jpeg", 0.96));
      const full = await worker.recognize(fullBlob, {}, { text: true, tsv: true });
      const rawText = full.data.text || "";
      const tsv = full.data.tsv || "";
      const mode = classify(rawText);
      logs.push(`3. 帳票判定: ${mode}`);
      logs.push(`6. Tesseract生OCR: textChars=${rawText.length} / tsvChars=${tsv.length}`);
      logs.push(`   生OCR先頭:\n${rawText.slice(0, 2500) || "<EMPTY>"}`);
      logs.push(`   明細らしい語の存在: ${/部品|名称|数量|受注|出庫|標準価格|単価|ガスケット|プラグ|ワイパ|クラッチ/i.test(rawText) ? "YES" : "NO"}`);

      const paper = grayPaper;
      logs.push(`7. 現行明細領域基準: paper=${JSON.stringify(paper)} / firstRowY=0.440 / rowStep=0.100 / lowerLimit=0.88`);
      let emptyRows = 0;
      let hypotheticalStop = "なし";
      let accepted = 0;

      for (let row = 0; ; row += 1) {
        const y = 0.440 + row * 0.100;
        if (y >= 0.88) break;
        const nameBox = relativeBox(paper, 0.025, y + 0.002, 0.370, 0.058);
        const qtyBox = relativeBox(paper, 0.432, y, 0.040, 0.070);
        const retailBox = relativeBox(paper, 0.480, y, 0.090, 0.070);
        const costBox = relativeBox(paper, 0.596, y, 0.080, 0.070);
        logs.push(`8. row${row + 1} crop: y=${y.toFixed(3)} name=${JSON.stringify(nameBox)} qty=${JSON.stringify(qtyBox)} retail=${JSON.stringify(retailBox)} cost=${JSON.stringify(costBox)}`);

        await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM?.SINGLE_LINE ?? "7", tessedit_char_whitelist: "", preserve_interword_spaces: "1", user_defined_dpi: "300" });
        const nameText = (await worker.recognize(await cropBlob(ocrSource, nameBox, 2200))).data.text || "";
        const name = nameCandidate(nameText);

        await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM?.SINGLE_WORD ?? "8", tessedit_char_whitelist: "0123456789,.|IlOo", preserve_interword_spaces: "0", user_defined_dpi: "300" });
        const qtyText = (await worker.recognize(await cropBlob(ocrSource, qtyBox, 900))).data.text || "";
        const retailText = (await worker.recognize(await cropBlob(ocrSource, retailBox, 1450))).data.text || "";
        const costText = (await worker.recognize(await cropBlob(ocrSource, costBox, 1450))).data.text || "";
        const qty = qtyValue(qtyText);
        const retail = moneyValue(retailText);
        const cost = moneyValue(costText);
        const strongName = nameStrong(name);
        const isRealPartRow = (Boolean(retail) && Boolean(cost)) || (strongName && Boolean(retail || cost));
        logs.push(`9-11. row${row + 1}: nameRaw=${JSON.stringify(nameText.trim())} => name=${JSON.stringify(name)} / qtyRaw=${JSON.stringify(qtyText.trim())} => ${qty || "<blank>"} / retailRaw=${JSON.stringify(retailText.trim())} => ${retail || "<blank>"} / costRaw=${JSON.stringify(costText.trim())} => ${cost || "<blank>"} / strongName=${strongName} / isRealPartRow=${isRealPartRow}`);
        if (isRealPartRow) {
          accepted += 1;
          emptyRows = 0;
        } else {
          emptyRows += 1;
          if (emptyRows >= 2 && row > 0 && hypotheticalStop === "なし") hypotheticalStop = `row${row + 1}終了後（従来条件ならここでbreak）`;
        }
      }
      logs.push(`12. 診断継続走査結果: accepted=${accepted} / emptyRows早期終了位置=${hypotheticalStop}`);
      logs.push("注: 診断ページではearly breakを実行せず、下側行も観察しています。正式OCRロジックは変更していません。");
      logs.push("白帳票確認: 生OCR/TSVに明細があるかを最優先。現行generalでは『単価』はcostラベル扱いのため、固定白帳票では列意味の不一致が別途存在します。");
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
        <h1 style={styles.title}>部品OCR 段階診断</h1>
        <p style={styles.text}>精度調整ではなく、0件になる段階を切り分けるための診断専用ページです。正式保存は行いません。</p>
        <input ref={inputRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && diagnose(e.target.files[0])} />
        <button disabled={busy} style={styles.button} onClick={() => inputRef.current?.click()}>{busy ? "診断中…" : "写真ライブラリから診断"}</button>
        <button style={styles.secondary} onClick={() => location.assign("/ocr/auto")}>通常の自動判定へ戻る</button>
        {preview && <img src={preview} alt="OCR前処理画像" style={{ width: "100%", maxHeight: 420, objectFit: "contain", marginTop: 14, borderRadius: 10, background: "#eef2f7" }} />}
      </section>
      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>診断ログ</h2>
        <textarea readOnly value={report} style={styles.debug} />
      </section>
    </main>
  );
}
