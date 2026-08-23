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
type NumberRead = { value: string; texts: string[] };

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
  debug: { width: "100%", minHeight: 200, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" },
};

function normalizeText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[￥]/g, "¥")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[，、]/g, ",")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

function correctCommonPartWord(text: string) {
  const words = [
    "クラッチ", "ブレーキ", "フィルター", "フィルタ", "ワイパー",
    "ガスケット", "ベルト", "ホース", "シール", "パッド",
    "ベアリング", "プラグ", "オイル",
  ];

  let corrected = text
    .replace(/リクフッチ|リクラッチ|クラツチ|クフッチ|ラクッチ/g, "クラッチ");

  corrected = corrected.replace(/[ァ-ヶー]{3,}/g, (token) => {
    let best = token;
    let distance = 99;
    for (const word of words) {
      const d = levenshtein(token, word);
      if (d < distance) {
        distance = d;
        best = word;
      }
    }
    const limit = token.length >= 7 ? 3 : 2;
    return distance <= limit ? best : token;
  });

  return corrected;
}

function cleanPartName(raw: string) {
  let text = normalizeText(raw)
    .replace(/[¥￥]\s*[0-9Il|OQS,.\s]+.*$/i, "")
    .replace(/\bMC[- ]?E\d+\b/gi, " ")
    .replace(/\*?0{2,}\d+/g, " ")
    .replace(/^[-:;|・.\s]+|[-:;|・.\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  text = correctCommonPartWord(text);

  const trailing = text.match(/^(.*\b(?:ASSY|COMP|KIT|SET))\s+([A-Z]{1,2})$/i);
  if (trailing && !/^(RH|LH|FR|RR)$/i.test(trailing[2])) text = trailing[1];

  return text.trim();
}

function nameScore(text: string) {
  const cleaned = cleanPartName(text);
  if (cleaned.length < 3) return -100;
  if (/品番|品名|受注|出庫|標準価格|単価|金額|倉庫|棚番|受注残|年月日|売上|コード|合計|伝票|型式|車台/.test(cleaned)) return -100;

  let score = 0;
  const jp = cleaned.match(/[ぁ-んァ-ヶ一-龠]/g)?.length || 0;
  const alpha = cleaned.match(/[A-Za-z]/g)?.length || 0;
  const digits = cleaned.match(/\d/g)?.length || 0;
  score += Math.min(14, jp * 2);
  score += Math.min(8, alpha);
  if (/ASSY|COMP|KIT|SET|クラッチ|ブレーキ|パッド|フィルタ|オイル|ベルト|ホース|ガスケット/i.test(cleaned)) score += 14;
  if (/[\/／]/.test(cleaned)) score += 5;
  if (digits > cleaned.length * 0.45) score -= 10;
  return score;
}

function bestName(texts: string[]) {
  let name = "";
  let score = -100;
  for (const text of texts) {
    for (const line of normalizeText(text).split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      const cleaned = cleanPartName(line);
      const s = nameScore(cleaned);
      if (s > score) {
        score = s;
        name = cleaned;
      }
    }
  }
  return { name: score >= 1 ? name : "", score };
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

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.98) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("画像変換に失敗しました。")),
      "image/jpeg",
      quality
    );
  });
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
  const roughBottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let count = 0;
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
  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) {
    boxHeight = Math.min(expectedHeight, h - top);
  }

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

function otsuThreshold(gray: Uint8ClampedArray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 150;
  let maxVariance = 0;
  for (let i = 0; i < 256; i += 1) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      best = i;
    }
  }
  return Math.max(90, Math.min(205, best));
}

async function makeCrop(source: HTMLCanvasElement, box: CropBox, targetWidth: number, binary = false) {
  const scale = Math.min(7, Math.max(1, targetWidth / box.w));
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
    v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.42 + 148)));
    gray[i] = v;
  }

  const threshold = otsuThreshold(gray);
  for (let p = 0, i = 0; p < image.data.length; p += 4, i += 1) {
    let v = gray[i];
    if (binary) v = v < threshold ? 0 : 255;
    else if (v > 240) v = 255;
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvasBlob(out);
}

function numberCandidates(text: string, max: number) {
  const matches = normalizeText(text).match(/\d{1,3}(?:[,\. ]\d{3})+|\d{1,7}/g) || [];
  return matches
    .map((x) => Number(x.replace(/\D/g, "")))
    .filter((x) => Number.isFinite(x) && x > 0 && x <= max)
    .map(String);
}

function chooseNumber(texts: string[], max: number) {
  const perPass = texts.map((t) => numberCandidates(t, max));
  const all = perPass.flat();
  if (!all.length) return "";

  const counts = new Map<string, number>();
  for (const value of all) counts.set(value, (counts.get(value) || 0) + 1);
  const repeated = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (repeated[0] && repeated[0][1] >= 2) return repeated[0][0];

  // 2方式が食い違う時は、罫線を二値化して誤読する場合があるので通常画像を優先。
  return perPass.find((x) => x.length)?.[0] || all[0];
}

async function readNumber(
  worker: any,
  tesseract: any,
  source: HTMLCanvasElement,
  box: CropBox,
  max: number,
  singleChar = false
): Promise<NumberRead> {
  const [normal, binary] = await Promise.all([
    makeCrop(source, box, singleChar ? 720 : 1100, false),
    makeCrop(source, box, singleChar ? 720 : 1100, true),
  ]);

  const texts: string[] = [];
  await worker.setParameters({
    tessedit_pageseg_mode: singleChar ? (tesseract.PSM?.SINGLE_LINE ?? "7") : (tesseract.PSM?.SINGLE_LINE ?? "7"),
    tessedit_char_whitelist: "0123456789,.",
    user_defined_dpi: "300",
  });
  texts.push((await worker.recognize(normal)).data.text || "");
  texts.push((await worker.recognize(binary)).data.text || "");
  return { value: chooseNumber(texts, max), texts };
}

async function readName(worker: any, tesseract: any, source: HTMLCanvasElement, box: CropBox) {
  const [normal, binary] = await Promise.all([
    makeCrop(source, box, 1900, false),
    makeCrop(source, box, 1900, true),
  ]);

  const texts: string[] = [];
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: tesseract.PSM?.SINGLE_LINE ?? "7",
    tessedit_char_whitelist: "",
    user_defined_dpi: "300",
  });
  texts.push((await worker.recognize(normal)).data.text || "");
  texts.push((await worker.recognize(binary)).data.text || "");
  return { ...bestName(texts), texts };
}

function likelyHasContent(text: string) {
  const normalized = normalizeText(text);
  return /[0-9A-Za-zぁ-んァ-ヶ一-龠]/.test(normalized) && normalized.replace(/[^0-9A-Za-zぁ-んァ-ヶ一-龠]/g, "").length >= 2;
}

function priceCandidates(read: NumberRead) {
  const values = read.texts.flatMap((t) => numberCandidates(t, 2000000));
  return [...new Set(values)];
}

function chooseRetail(read: NumberRead, cost: string) {
  const candidates = priceCandidates(read);
  if (!candidates.length) return read.value;
  if (!cost) return read.value || candidates[0];
  const c = Number(cost);
  // 「標準価格」は通常「単価」以上。OCR候補に条件を満たす値があればそちらを優先。
  return candidates.find((x) => Number(x) >= c) || read.value || candidates[0];
}

export default function HighAccuracyOCRPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("4項目を伝票の列ごとに読み取ります。");
  const [parts, setParts] = useState<Part[]>([]);
  const [debugText, setDebugText] = useState("");
  const [preview, setPreview] = useState("");

  async function runOCR(file: File) {
    setBusy(true);
    setProgress(1);
    setParts([]);
    setDebugText("");
    setMessage("伝票位置を補正しています…");
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
      const logs: string[] = [`paper x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];

      // 大一用品商会の部品表。1行目の上端は用紙上端から約46.2%。
      const rowStart = 0.462;
      const rowStep = 0.100;
      const rowHeight = 0.090;
      let emptyRows = 0;

      for (let row = 0; row < 5; row += 1) {
        const y = rowStart + row * rowStep;
        if (y + rowHeight >= 0.96) break;

        setMessage(`部品表 ${row + 1}行目を確認中…`);
        setProgress((old) => Math.max(old, 8 + row * 15));

        const rowBox = relativeBox(paper, 0.04, y, 0.78, rowHeight);
        const rowBlob = await makeCrop(source, rowBox, 2400, false);
        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? "11",
          tessedit_char_whitelist: "",
          user_defined_dpi: "300",
        });
        const rowText = (await worker.recognize(rowBlob)).data.text || "";
        logs.push(`【${row + 1}行目 全体】\n${rowText.trim()}`);

        if (!likelyHasContent(rowText)) {
          emptyRows += 1;
          if (emptyRows >= 2 && row > 0) break;
          continue;
        }
        emptyRows = 0;

        // 印字は行の下側にあるため、罫線や上段の品番を避けて下段だけを読む。
        const cellY = y + 0.047;
        const cellH = 0.040;

        const nameBox = relativeBox(paper, 0.050, cellY, 0.245, cellH);
        const qtyBox = relativeBox(paper, 0.438, cellY, 0.034, cellH);
        const retailBox = relativeBox(paper, 0.492, cellY, 0.080, cellH);
        const costBox = relativeBox(paper, 0.602, cellY, 0.074, cellH);
        const amountBox = relativeBox(paper, 0.735, cellY, 0.078, cellH);

        const nameRead = await readName(worker, tesseract, source, nameBox);
        const qtyRead = await readNumber(worker, tesseract, source, qtyBox, 99, true);
        const retailRead = await readNumber(worker, tesseract, source, retailBox, 2000000);
        const costRead = await readNumber(worker, tesseract, source, costBox, 2000000);

        let qty = qtyRead.value;
        let cost = costRead.value;
        let amountRead: NumberRead = { value: "", texts: [] };

        // 単価を取り損ねた場合のみ「金額」列も補助として読む。
        if (!cost) {
          amountRead = await readNumber(worker, tesseract, source, amountBox, 2000000);
          if (!qty || qty === "1") cost = amountRead.value;
        }

        // 部品行が読み取れているのに個数だけ空なら、伝票上よく使う1を初期候補にする。
        if (!qty && nameRead.name && (retailRead.value || cost)) qty = "1";

        const retail = chooseRetail(retailRead, cost);

        logs.push(
          `【${row + 1}行目 セル】\n` +
          `名称候補: ${nameRead.texts.map((x) => x.trim()).join(" / ")}\n` +
          `名称採用: ${nameRead.name}\n` +
          `個数: ${qtyRead.texts.map((x) => x.trim()).join(" / ")} => ${qty}\n` +
          `定価: ${retailRead.texts.map((x) => x.trim()).join(" / ")} => ${retail}\n` +
          `仕入れ: ${costRead.texts.map((x) => x.trim()).join(" / ")} => ${cost}\n` +
          (amountRead.texts.length ? `金額補助: ${amountRead.texts.map((x) => x.trim()).join(" / ")} => ${amountRead.value}` : "")
        );

        // 1項目欠けただけで結果を捨てず、画面に出して手修正できるようにする。
        const useful = nameRead.name || qty || retail || cost;
        const enough = [nameRead.name, qty, retail, cost].filter(Boolean).length >= 2;
        if (useful && enough) {
          found.push({
            id: uid(),
            name: nameRead.name,
            qty,
            retail,
            cost,
            source: rowText,
          });
        }
      }

      setParts(found);
      setDebugText(logs.join("\n\n"));
      setProgress(100);
      setMessage(
        found.length
          ? `${found.length}件を抽出しました。空欄や誤読があればその場で修正できます。`
          : "部品行を抽出できませんでした。OCR詳細を残したまま次の位置調整をします。"
      );
    } catch (error) {
      console.error(error);
      setMessage("OCR処理でエラーが出ました。同じ写真でもう一度試してください。");
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
        <p style={styles.text}>大一用品商会の伝票に合わせ、部品名称・個数・定価・仕入れの印字位置を別々に読み取ります。1項目だけ読めなくても結果を消さず、画面上で修正できます。</p>
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
                <div style={{ ...styles.row, fontWeight: 800, padding: "0 2px" }}>
                  <div>部品名称</div><div>個数</div><div>定価</div><div>仕入れ</div>
                </div>
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
          <p style={styles.text}>各セルの読み取り候補を確認できます。通常は開かなくて大丈夫です。</p>
          <textarea readOnly value={debugText} style={styles.debug} />
        </details>
      </section>
    </main>
  );
}
