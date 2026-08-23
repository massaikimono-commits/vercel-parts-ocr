/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";

type Part = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
};

type CropBox = { x: number; y: number; w: number; h: number };
type CropMode = "text" | "name" | "nameBinary" | "numeric";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 920, margin: "0 auto", padding: "18px 14px 50px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16, boxShadow: "0 8px 30px #1a28400d" },
  title: { fontSize: 32, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.7 },
  primary: { width: "100%", border: 0, borderRadius: 14, padding: "17px 14px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 18, marginTop: 10 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 14, padding: "15px 14px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 17, marginTop: 10 },
  notice: { padding: "13px 15px", background: "#e9f7ef", border: "1px solid #bfe6ce", borderRadius: 12, marginBottom: 14, lineHeight: 1.6 },
  row: { display: "grid", gridTemplateColumns: "minmax(180px, 2fr) 80px 120px 120px", gap: 8, marginBottom: 10 },
  input: { width: "100%", minWidth: 0, border: "2px solid #d6deea", borderRadius: 10, padding: "11px 10px", fontSize: 16 },
  debug: { width: "100%", minHeight: 180, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" },
};

function normalizeText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[￥]/g, "¥")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[，、]/g, ",")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ");
}

function amountValues(text: string) {
  const noYen = text.replace(/¥\s*\d[\d,. ]*/g, " ");
  const matches = noYen.match(/\d{1,3}(?:[,\. ]\d{3})+|\d{4,7}/g) || [];
  return matches
    .map((raw) => ({ raw, value: Number(raw.replace(/\D/g, "")) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 100 && x.value <= 2000000);
}

function cleanPartName(line: string) {
  return line
    .replace(/[¥￥]\s*[lI1|]?\s*\d[\d,. ]*/g, " ")
    .replace(/\b0{2,}\d+\b/g, " ")
    .replace(/^\*?\d{4,}\s*/g, "")
    .replace(/^[A-Z]{1,4}[- ]?[A-Z0-9]{2,}\s*/i, "")
    .replace(/^[\s:;|・.\-]+|[\s:;|・.\-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function nameScore(line: string) {
  const cleaned = cleanPartName(line);
  if (cleaned.length < 2) return -100;
  if (/品番|品名|受注|出庫|標準価格|単価|金額|倉庫|棚番|受注残|年月日|売上|コード|合計|伝票|型式|車台/.test(cleaned)) return -100;

  let score = 0;
  const jp = cleaned.match(/[ぁ-んァ-ヶ一-龠]/g)?.length || 0;
  const alpha = cleaned.match(/[A-Za-z]/g)?.length || 0;
  const digits = cleaned.match(/\d/g)?.length || 0;

  if (jp) score += Math.min(12, jp * 2);
  if (alpha) score += Math.min(8, alpha);
  if (/ASSY|KIT|SET|COMP|クラッチ|ブレーキ|パッド|フィルタ|オイル|ベルト|シール|ホース|ガスケット/i.test(cleaned)) score += 12;
  if (/[\/／]/.test(cleaned)) score += 5;
  if (cleaned.length >= 6) score += 3;
  if (cleaned.length >= 10) score += 3;
  if (/[○●◎□■◇◆]/.test(cleaned)) score -= 8;
  if (digits > cleaned.length * 0.45) score -= 10;
  if (/^[A-Z0-9_.\/-]+$/i.test(cleaned)) score -= 3;
  return score;
}

function bestNameFromTexts(texts: string[]) {
  let best = "";
  let bestScore = -100;
  for (const text of texts) {
    const lines = normalizeText(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      const cleaned = cleanPartName(line);
      const score = nameScore(cleaned);
      if (score > bestScore) {
        bestScore = score;
        best = cleaned;
      }
    }
  }
  return { name: bestScore >= 1 ? best : "", score: bestScore };
}

function parseRowText(text: string): Part | null {
  const normalized = normalizeText(text);
  const lines = normalized.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return null;

  const { name: bestName, score: bestScore } = bestNameFromTexts(lines);
  const joined = lines.join(" ");
  const amounts = amountValues(joined);
  if (!bestName || bestScore < 2 || amounts.length < 2) return null;

  const firstAmountPos = joined.indexOf(amounts[0].raw);
  const before = firstAmountPos >= 0 ? joined.slice(0, firstAmountPos).replace(/[¥￥]\s*\d[\d,. ]*/g, " ") : joined;
  const qtyMatches = [...before.matchAll(/(?:^|\s)(\d{1,3})(?=\s|$)/g)];
  let qty = "1";
  for (let i = qtyMatches.length - 1; i >= 0; i -= 1) {
    const n = Number(qtyMatches[i][1]);
    if (n >= 1 && n <= 99) {
      qty = String(n);
      break;
    }
  }

  return {
    id: uid(),
    name: bestName,
    qty,
    retail: String(amounts[0].value),
    cost: String(amounts[1].value),
    source: normalized,
  };
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

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.97) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像変換に失敗しました。")), "image/jpeg", quality);
  });
}

function detectPaperBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };

  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 800));
  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const yellowPaper = r > 105 && g > 105 && r + g > b * 1.75;
    return bright > 148 || yellowPaper;
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
    if (count && hit / count > 0.18) ys.push(y);
  }
  if (ys.length < 4) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let count = 0;
    for (let y = top; y <= bottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.2) xs.push(x);
  }
  if (xs.length < 4) return { x: 0, y: top, w, h: bottom - top + 1 };

  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  if (box.w < w * 0.55 || box.h < h * 0.3) return { x: 0, y: 0, w, h };
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

function otsuThreshold(gray: Uint8ClampedArray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 150;
  for (let i = 0; i < 256; i += 1) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) {
      max = between;
      threshold = i;
    }
  }
  return Math.max(95, Math.min(205, threshold));
}

async function makeCrop(source: HTMLCanvasElement, box: CropBox, targetWidth = 2200, mode: CropMode = "text") {
  const maxScale = mode === "name" || mode === "nameBinary" ? 6 : 4;
  const scale = Math.min(maxScale, Math.max(1, targetWidth / box.w));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(box.w * scale));
  out.height = Math.max(1, Math.round(box.h * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像処理を開始できませんでした。");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);

  const image = ctx.getImageData(0, 0, out.width, out.height);
  const gray = new Uint8ClampedArray(out.width * out.height);
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    const r = image.data[p];
    const g = image.data[p + 1];
    let v = Math.round(r * 0.22 + g * 0.78);
    const contrast = mode === "numeric" ? 1.9 : mode === "name" ? 1.35 : mode === "nameBinary" ? 1.55 : 1.62;
    const lift = mode === "name" ? 146 : 154;
    v = Math.max(0, Math.min(255, Math.round((v - 128) * contrast + lift)));
    gray[i] = v;
  }

  const threshold = otsuThreshold(gray);
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (mode === "nameBinary") v = v < threshold ? 0 : 255;
    else if (v > (mode === "name" ? 238 : 226)) v = 255;
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvasBlob(out);
}

function numericValue(text: string, max = 2000000) {
  const normalized = normalizeText(text);
  const matches = normalized.match(/\d{1,3}(?:[,\. ]\d{3})+|\d{1,7}/g) || [];
  const values = matches
    .map((x) => Number(x.replace(/\D/g, "")))
    .filter((x) => Number.isFinite(x) && x > 0 && x <= max);
  return values.length ? String(values[0]) : "";
}

async function sourceCanvas(file: File) {
  const img = await loadImage(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export default function HighAccuracyOCRPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("部品名称は名称欄の下段を拡大して複数回読み取ります。");
  const [parts, setParts] = useState<Part[]>([]);
  const [debugText, setDebugText] = useState("");
  const [preview, setPreview] = useState("");

  async function readName(worker: any, tesseract: any, source: HTMLCanvasElement, paper: CropBox, y: number) {
    const fullBox = relativeBox(paper, 0.025, y + 0.002, 0.37, 0.058);
    const lowerBox = relativeBox(paper, 0.035, y + 0.029, 0.36, 0.030);
    const [fullBlob, lowerBlob, lowerBinaryBlob] = await Promise.all([
      makeCrop(source, fullBox, 2100, "name"),
      makeCrop(source, lowerBox, 2200, "name"),
      makeCrop(source, lowerBox, 2200, "nameBinary"),
    ]);

    const texts: string[] = [];
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
      tessedit_char_whitelist: "",
      user_defined_dpi: "300",
    });
    texts.push((await worker.recognize(fullBlob)).data.text || "");

    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: tesseract.PSM?.SINGLE_LINE ?? "7",
      tessedit_char_whitelist: "",
      user_defined_dpi: "300",
    });
    texts.push((await worker.recognize(lowerBlob)).data.text || "");
    texts.push((await worker.recognize(lowerBinaryBlob)).data.text || "");

    const best = bestNameFromTexts(texts);
    return { ...best, texts };
  }

  async function runOCR(file: File) {
    setBusy(true);
    setProgress(1);
    setParts([]);
    setDebugText("");
    setMessage("伝票の位置を検出しています…");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      const source = await sourceCanvas(file);
      const paper = detectPaperBox(source);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setProgress((old) => Math.max(old, Math.min(96, old + Math.max(1, Math.round((m.progress || 0) * 2)))));
          }
        },
      });

      const found: Part[] = [];
      const logs: string[] = [];
      const rowStart = 0.368;
      const rowStep = 0.066;
      const rowHeight = 0.063;

      for (let row = 0; row < 7; row += 1) {
        const y = rowStart + row * rowStep;
        setMessage(`部品表 ${row + 1}行目を読み取り中…`);
        setProgress((old) => Math.max(old, 8 + row * 10));

        const rowBox = relativeBox(paper, 0.025, y, 0.82, rowHeight);
        const rowBlob = await makeCrop(source, rowBox, 2300, "text");
        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
          tessedit_char_whitelist: "",
          user_defined_dpi: "300",
        });
        const rowText = (await worker.recognize(rowBlob)).data.text || "";
        let parsed = parseRowText(rowText);
        logs.push(`【${row + 1}行目】\n${rowText.trim()}`);

        if (parsed) {
          const nameRead = await readName(worker, tesseract, source, paper, y);
          logs.push(`【${row + 1}行目 名称専用】\n${nameRead.texts.map((t, i) => `候補${i + 1}: ${t.trim()}`).join("\n")}\n採用:${nameRead.name} (score ${nameRead.score})`);
          if (nameRead.name && nameRead.score > nameScore(parsed.name)) {
            parsed = { ...parsed, name: nameRead.name, source: `${parsed.source}\nNAME:${nameRead.texts.join(" | ")}` };
          }
        }

        if (!parsed && row < 5) {
          const nameRead = await readName(worker, tesseract, source, paper, y);
          const qtyBlob = await makeCrop(source, relativeBox(paper, 0.405, y + 0.006, 0.07, rowHeight - 0.012), 700, "numeric");
          const retailBlob = await makeCrop(source, relativeBox(paper, 0.49, y + 0.006, 0.105, rowHeight - 0.012), 900, "numeric");
          const costBlob = await makeCrop(source, relativeBox(paper, 0.595, y + 0.006, 0.105, rowHeight - 0.012), 900, "numeric");

          await worker.setParameters({
            tessedit_pageseg_mode: tesseract.PSM?.SINGLE_LINE ?? "7",
            tessedit_char_whitelist: "0123456789,.-",
            user_defined_dpi: "300",
          });
          const qtyText = (await worker.recognize(qtyBlob)).data.text || "";
          const retailText = (await worker.recognize(retailBlob)).data.text || "";
          const costText = (await worker.recognize(costBlob)).data.text || "";

          const retail = numericValue(retailText);
          const cost = numericValue(costText);
          const qty = numericValue(qtyText, 99) || "1";
          logs.push(`【${row + 1}行目セル】\n名称:${nameRead.name}\n個数:${qtyText.trim()}\n定価:${retailText.trim()}\n仕入:${costText.trim()}`);

          if (nameRead.name && retail && cost) {
            parsed = { id: uid(), name: nameRead.name, qty, retail, cost, source: `${nameRead.texts.join(" | ")} | ${qtyText} | ${retailText} | ${costText}` };
          }
        }

        if (parsed) {
          const duplicate = found.some((p) => p.name.replace(/\s/g, "").toLowerCase() === parsed!.name.replace(/\s/g, "").toLowerCase() && p.retail === parsed!.retail && p.cost === parsed!.cost);
          if (!duplicate) found.push(parsed);
        }
      }

      setDebugText(logs.join("\n\n"));
      setParts(found);
      setProgress(100);
      setMessage(found.length ? `${found.length}件を抽出しました。特に部品名称を確認してください。` : "まだ4項目を取れませんでした。読み取り範囲を次に調整します。");
    } catch (error) {
      console.error(error);
      setMessage("OCR処理でエラーが出ました。もう一度同じ写真で試してください。");
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  function updatePart(index: number, key: keyof Part, value: string) {
    setParts((old) => old.map((p, i) => i === index ? { ...p, [key]: value } : p));
  }

  function saveParts() {
    if (!parts.length) return;
    let current: Part[] = [];
    try {
      current = JSON.parse(localStorage.getItem("parts-data") || "[]");
      if (!Array.isArray(current)) current = [];
    } catch {
      current = [];
    }
    localStorage.setItem("parts-data", JSON.stringify([...parts, ...current]));
    setMessage(`${parts.length}件をメインの部品データへ保存しました。`);
  }

  return (
    <main style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button onClick={() => location.assign("/")} style={{ border: "1px solid #ccd5e2", background: "#fff", borderRadius: 12, padding: "10px 14px", color: "#2674e8", fontWeight: 700 }}>← メインへ</button>
        <div style={{ fontWeight: 800 }}>icb</div>
      </div>

      <section style={styles.card}>
        <h1 style={styles.title}>部品伝票 高精度OCR</h1>
        <p style={styles.text}>個数・定価・仕入れに加え、部品名称は名称欄の下段だけを大きく切り出して3通りで読み取り、最も部品名らしい結果を採用します。</p>
        {message && <div style={styles.notice}>{message}{busy ? `（${progress}%）` : ""}</div>}

        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && runOCR(e.target.files[0])} />
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && runOCR(e.target.files[0])} />

        <button disabled={busy} style={styles.primary} onClick={() => cameraRef.current?.click()}>📷 今撮影して読み取る</button>
        <button disabled={busy} style={styles.secondary} onClick={() => libraryRef.current?.click()}>🖼 写真ライブラリから読み取る</button>

        {preview && <img src={preview} alt="読み取り画像" style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 14, marginTop: 16, background: "#eef2f7" }} />}
      </section>

      <section style={styles.card}>
        <h2 style={{ marginTop: 0 }}>抽出データ</h2>
        {!parts.length && <p style={styles.text}>まだ抽出できた部品はありません。</p>}
        {parts.length > 0 && (
          <>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 560 }}>
                <div style={{ ...styles.row, fontWeight: 800, padding: "0 2px" }}><div>部品名称</div><div>個数</div><div>定価</div><div>仕入れ</div></div>
                {parts.map((p, i) => (
                  <div style={styles.row} key={p.id}>
                    <input style={styles.input} value={p.name} onChange={(e) => updatePart(i, "name", e.target.value)} />
                    <input style={styles.input} inputMode="numeric" value={p.qty} onChange={(e) => updatePart(i, "qty", e.target.value)} />
                    <input style={styles.input} inputMode="numeric" value={p.retail} onChange={(e) => updatePart(i, "retail", e.target.value)} />
                    <input style={styles.input} inputMode="numeric" value={p.cost} onChange={(e) => updatePart(i, "cost", e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
            <button style={styles.primary} onClick={saveParts}>✓ この内容を部品データへ保存</button>
          </>
        )}
      </section>

      <section style={styles.card}>
        <details>
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>OCR詳細（調整用）</summary>
          <p style={styles.text}>名称専用OCRの3候補もここに表示します。通常は開かなくて大丈夫です。</p>
          <textarea readOnly value={debugText} style={styles.debug} />
        </details>
      </section>
    </main>
  );
}
