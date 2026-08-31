/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { safeActionError } from "../../lib/client-security";

import { useEffect, useRef, useState } from "react";
import { consumeOCRTransferImage } from "../transfer";
import { validateDocumentFile } from "../../lib/file-security";

type Part = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
};

type Word = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  lineKey: string;
};

type OCRLine = {
  words: Word[];
  text: string;
  top: number;
  bottom: number;
};

type ColumnKey = "name" | "qty" | "retail" | "cost";
type HeaderMatch = { key: ColumnKey; x: number; label: string };

type CropBox = { x: number; y: number; w: number; h: number };

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const LABELS: Record<ColumnKey, string[]> = {
  name: ["部品名称", "部品名", "品名", "商品名", "名称", "摘要", "品目"],
  qty: ["個数", "数量", "数", "受注数", "出庫数", "入数"],
  retail: ["定価", "標準価格", "希望小売価格", "売価", "販売価格", "単価"],
  cost: ["仕入れ", "仕入", "原価", "仕切", "仕切価格"],
};

const STOP_WORDS = ["合計", "小計", "総合計", "消費税", "税額", "請求額", "今回御買上額"];

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto", padding: "18px 14px 60px", color: "#162033" },
  card: { background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16, boxShadow: "0 8px 30px #1a28400d" },
  title: { fontSize: 32, margin: "0 0 10px", fontWeight: 800 },
  text: { color: "#5d6878", lineHeight: 1.75 },
  primary: { width: "100%", border: 0, borderRadius: 14, padding: "17px 14px", background: "#2f6fe4", color: "#fff", fontWeight: 800, fontSize: 18, marginTop: 10 },
  secondary: { width: "100%", border: "1px solid #ccd5e2", borderRadius: 14, padding: "15px 14px", background: "#fff", color: "#2674e8", fontWeight: 700, fontSize: 17, marginTop: 10 },
  notice: { padding: "13px 15px", background: "#e9f7ef", border: "1px solid #bfe6ce", borderRadius: 12, marginBottom: 14, lineHeight: 1.6 },
  row: { display: "grid", gridTemplateColumns: "minmax(210px, 2fr) 80px 120px 120px", gap: 8, marginBottom: 10 },
  input: { width: "100%", minWidth: 0, border: "2px solid #d6deea", borderRadius: 10, padding: "11px 10px", fontSize: 16 },
  debug: { width: "100%", minHeight: 300, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" },
};

function normalize(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[￥]/g, "¥")
    .replace(/[，、]/g, ",")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function labelText(text: string) {
  return normalize(text).replace(/[\s:：・|｜/／.()（）\[\]［］-]/g, "");
}

function isHeaderLike(text: string) {
  const t = labelText(text);
  return Object.values(LABELS).flat().some((x) => t.includes(labelText(x)));
}

function cleanName(raw: string) {
  let text = normalize(raw)
    .replace(/¥\s*\d[\d,. ]*/g, " ")
    .replace(/\b\d{1,3}(?:[,\.]\d{3})+\b/g, " ")
    .replace(/^[:：;；|｜・.\-\s]+|[:：;；|｜・.\-\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (isHeaderLike(text)) return "";
  if (STOP_WORDS.some((x) => text.includes(x))) return "";
  return text;
}

function digits(raw: string) {
  const s = normalize(raw).replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  return s.replace(/[^\d]/g, "");
}

function moneyValue(raw: string) {
  const n = Number(digits(raw));
  return Number.isFinite(n) && n >= 100 && n <= 5000000 ? String(n) : "";
}

function qtyValue(raw: string) {
  const n = Number(digits(raw));
  return Number.isFinite(n) && n >= 1 && n <= 999 ? String(n) : "";
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を開けませんでした。")); };
    img.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.96) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像変換に失敗しました。")), "image/jpeg", quality);
  });
}

async function sourceCanvas(file: File) {
  const img = await loadImage(file);
  const maxSide = 3200;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function detectPaper(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(3, Math.floor(Math.max(w, h) / 700));
  const bright = (r: number, g: number, b: number) => {
    const v = (r + g + b) / 3;
    return v > 145 && Math.max(r, g, b) - Math.min(r, g, b) < 95;
  };
  const rows: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0; let total = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (bright(data[p], data[p + 1], data[p + 2])) hit += 1;
      total += 1;
    }
    if (total && hit / total > 0.18) rows.push(y);
  }
  if (rows.length < 4) return { x: 0, y: 0, w, h };
  const top = Math.max(0, rows[0] - step * 3);
  const bottom = Math.min(h - 1, rows[rows.length - 1] + step * 3);
  const cols: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0; let total = 0;
    for (let y = top; y <= bottom; y += step) {
      const p = (y * w + x) * 4;
      if (bright(data[p], data[p + 1], data[p + 2])) hit += 1;
      total += 1;
    }
    if (total && hit / total > 0.18) cols.push(x);
  }
  if (cols.length < 4) return { x: 0, y: 0, w, h };
  const left = Math.max(0, cols[0] - step * 3);
  const right = Math.min(w - 1, cols[cols.length - 1] + step * 3);
  const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  if (box.w < w * 0.45 || box.h < h * 0.35) return { x: 0, y: 0, w, h };
  return box;
}

async function makeEnhanced(source: HTMLCanvasElement, box: CropBox) {
  const targetWidth = Math.min(2600, Math.max(1500, box.w * 1.8));
  const scale = targetWidth / box.w;
  const out = document.createElement("canvas");
  out.width = Math.round(box.w * scale);
  out.height = Math.round(box.h * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像処理を開始できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  for (let p = 0; p < image.data.length; p += 4) {
    const r = image.data[p]; const g = image.data[p + 1]; const b = image.data[p + 2];
    let v = Math.round(r * 0.22 + g * 0.70 + b * 0.08);
    v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.22 + 150)));
    if (v > 247) v = 255;
    image.data[p] = v; image.data[p + 1] = v; image.data[p + 2] = v; image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvasBlob(out);
}

function parseTSV(tsv: string): OCRLine[] {
  if (!tsv.trim()) return [];
  const words: Word[] = [];
  const rows = tsv.split(/\n/);
  for (let i = 1; i < rows.length; i += 1) {
    const c = rows[i].split("\t");
    if (c.length < 12) continue;
    const text = normalize(c.slice(11).join("\t"));
    const conf = Number(c[10]);
    if (!text || !Number.isFinite(conf) || conf < 12) continue;
    words.push({ text, left: Number(c[6]), top: Number(c[7]), width: Number(c[8]), height: Number(c[9]), conf, lineKey: `${c[2]}-${c[3]}-${c[4]}` });
  }
  const groups = new Map<string, Word[]>();
  for (const word of words) { const list = groups.get(word.lineKey) || []; list.push(word); groups.set(word.lineKey, list); }
  return [...groups.values()].map((lineWords) => {
    const sorted = [...lineWords].sort((a, b) => a.left - b.left);
    return { words: sorted, text: sorted.map((x) => x.text).join(" "), top: Math.min(...sorted.map((x) => x.top)), bottom: Math.max(...sorted.map((x) => x.top + x.height)) };
  }).sort((a, b) => a.top - b.top);
}

function findLabelInWords(words: Word[], labels: string[]) {
  for (let i = 0; i < words.length; i += 1) {
    for (let len = 1; len <= 3 && i + len <= words.length; len += 1) {
      const slice = words.slice(i, i + len);
      const joined = labelText(slice.map((x) => x.text).join(""));
      const label = labels.find((x) => { const target = labelText(x); return joined === target || joined.includes(target) || target.includes(joined) && joined.length >= 2; });
      if (label) {
        const left = Math.min(...slice.map((x) => x.left));
        const right = Math.max(...slice.map((x) => x.left + x.width));
        return { x: (left + right) / 2, label };
      }
    }
  }
  return null;
}

function detectHeader(lines: OCRLine[]) {
  let best: { index: number; matches: HeaderMatch[] } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matches: HeaderMatch[] = [];
    for (const key of Object.keys(LABELS) as ColumnKey[]) {
      const found = findLabelInWords(line.words, LABELS[key]);
      if (found) matches.push({ key, x: found.x, label: found.label });
    }
    const list = [...new Map(matches.map((x) => [x.key, x])).values()];
    if (!best || list.length > best.matches.length) best = { index, matches: list };
  }
  if (!best) return null;
  return best.matches.length >= 2 ? best : null;
}

function nearestColumn(word: Word, headers: HeaderMatch[]) {
  const cx = word.left + word.width / 2;
  return [...headers].sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx))[0]?.key;
}

function parseByColumns(lines: OCRLine[], header: { index: number; matches: HeaderMatch[] }) {
  const found: Part[] = [];
  let pendingName = "";
  const headers = header.matches;
  const hasRetail = headers.some((x) => x.key === "retail");
  const hasCost = headers.some((x) => x.key === "cost");
  for (let i = header.index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const allText = normalize(line.text);
    if (STOP_WORDS.some((x) => allText.includes(x))) break;
    const cells: Record<ColumnKey, string[]> = { name: [], qty: [], retail: [], cost: [] };
    for (const word of line.words) { const key = nearestColumn(word, headers); if (key) cells[key].push(word.text); }
    const rawName = cleanName(cells.name.join(" "));
    let qty = qtyValue(cells.qty.join(" "));
    let retail = hasRetail ? moneyValue(cells.retail.join(" ")) : "";
    let cost = hasCost ? moneyValue(cells.cost.join(" ")) : "";
    if (!hasRetail && hasCost) cost = moneyValue(cells.cost.join(" "));
    if (hasRetail && !hasCost) retail = moneyValue(cells.retail.join(" "));
    const hasPrice = Boolean(retail || cost);
    if (!hasPrice && rawName) { pendingName = pendingName ? `${pendingName} ${rawName}` : rawName; continue; }
    if (!hasPrice) continue;
    const name = cleanName([pendingName, rawName].filter(Boolean).join(" "));
    pendingName = "";
    if (!qty) qty = "1";
    if (name || qty || retail || cost) found.push({ id: uid(), name, qty, retail, cost, source: allText });
  }
  return found;
}

function amountValues(line: string) {
  const matches = normalize(line).match(/\d{1,3}(?:[,\.]\d{3})+|\d{3,7}/g) || [];
  return matches.map((raw) => ({ raw, value: Number(raw.replace(/\D/g, "")) })).filter((x) => x.value >= 100 && x.value <= 5000000);
}

function fallbackParse(text: string) {
  const lines = normalize(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const found: Part[] = [];
  let previousName = "";
  for (const line of lines) {
    if (STOP_WORDS.some((x) => line.includes(x))) continue;
    const amounts = amountValues(line);
    if (amounts.length >= 1) {
      const firstIndex = line.indexOf(amounts[0].raw);
      const before = firstIndex >= 0 ? line.slice(0, firstIndex) : line;
      let name = cleanName(before.replace(/(?:^|\s)\d{1,3}(?=\s|$)/g, " "));
      if (!name) name = previousName;
      const small = before.match(/(?:^|\s)(\d{1,3})(?=\s|$)/g) || [];
      const qty = small.length ? qtyValue(small[small.length - 1]) || "1" : "1";
      found.push({ id: uid(), name, qty, retail: amounts[0] ? String(amounts[0].value) : "", cost: amounts[1] ? String(amounts[1].value) : "", source: line });
      previousName = "";
    } else {
      const candidate = cleanName(line);
      if (candidate && !isHeaderLike(candidate)) previousName = candidate;
    }
  }
  return found;
}

function dedupe(parts: Part[]) {
  const seen = new Set<string>();
  return parts.filter((p) => {
    const key = `${p.name.replace(/\s/g, "").toLowerCase()}|${p.qty}|${p.retail}|${p.cost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(p.name || p.retail || p.cost);
  });
}

export default function GeneralOCRPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("A4・他社伝票の見出しと表構造を自動判定します。");
  const [preview, setPreview] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [rawText, setRawText] = useState("");
  const [debug, setDebug] = useState("");

  useEffect(() => {
    let active = true;
    consumeOCRTransferImage().then((file) => {
      if (active && file) runOCR(file);
    }).catch((error) => console.error(error));
    return () => { active = false; };
  }, []);

  async function runOCR(file: File) {
    const fileCheck = await validateDocumentFile(file);
    if (!fileCheck.ok) { setMessage(fileCheck.message); return; }
    setBusy(true); setProgress(1); setParts([]); setRawText(""); setDebug(""); setMessage("用紙全体を解析しています…");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    let worker: any = null;
    try {
      const source = await sourceCanvas(file);
      const paper = detectPaper(source);
      const enhanced = await makeEnhanced(source, paper);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1, { logger: (m: any) => { if (m.status === "recognizing text") setProgress(Math.max(5, Math.round((m.progress || 0) * 95))); } });
      await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3", user_defined_dpi: "300" });
      const result = await worker.recognize(enhanced, {}, { text: true, tsv: true });
      const text = result.data.text || "";
      const tsv = (result.data as any).tsv || "";
      setRawText(text);
      const lines = parseTSV(tsv);
      const header = detectHeader(lines);
      const columnParts = header ? parseByColumns(lines, header) : [];
      const fallback = fallbackParse(text);
      const best = dedupe(columnParts.length ? columnParts : fallback);
      setParts(best);
      setDebug(JSON.stringify({ paper, header, columnParts, fallbackCount: fallback.length, finalCount: best.length }, null, 2));
      setMessage(best.length ? `${best.length}件の部品候補を読み取りました。必ず内容を確認してください。` : "部品行を確定できませんでした。下のOCR原文を確認して手入力してください。");
      setProgress(100);
    } catch (error: any) {
      setMessage(safeActionError("部品伝票OCR", error));
    } finally {
      if (worker) { try { await worker.terminate(); } catch {} }
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>汎用部品伝票OCR</h1>
        <p style={styles.text}>白い部品一覧など、専用黄色伝票以外の表形式伝票を読み取ります。列見出しを使って、部品名称・個数・定価・仕入れを分けます。</p>
        <div style={styles.notice}>{busy ? `処理中 ${progress}% — ${message}` : message}</div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) runOCR(f); e.currentTarget.value = ""; }} />
        <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) runOCR(f); e.currentTarget.value = ""; }} />
        <button style={styles.primary} disabled={busy} onClick={() => cameraRef.current?.click()}>📷 写真を撮る</button>
        <button style={styles.secondary} disabled={busy} onClick={() => libraryRef.current?.click()}>🖼 写真を選ぶ</button>
        {preview && <img src={preview} alt="preview" style={{ width: "100%", maxHeight: 380, objectFit: "contain", marginTop: 16, borderRadius: 12, background: "#f5f6f8" }} />}
      </section>

      <section style={styles.card}>
        <h2>読取結果</h2>
        <div style={{ ...styles.row, fontWeight: 800, color: "#657187" }}><div>部品名称</div><div>個数</div><div>定価</div><div>仕入れ</div></div>
        {parts.map((part) => <div key={part.id} style={styles.row}>
          <input style={styles.input} value={part.name} onChange={(e) => setParts((old) => old.map((x) => x.id === part.id ? { ...x, name: e.target.value } : x))} />
          <input style={styles.input} value={part.qty} onChange={(e) => setParts((old) => old.map((x) => x.id === part.id ? { ...x, qty: e.target.value } : x))} />
          <input style={styles.input} value={part.retail} onChange={(e) => setParts((old) => old.map((x) => x.id === part.id ? { ...x, retail: e.target.value } : x))} />
          <input style={styles.input} value={part.cost} onChange={(e) => setParts((old) => old.map((x) => x.id === part.id ? { ...x, cost: e.target.value } : x))} />
        </div>)}
        {!parts.length && <div style={styles.text}>まだ結果はありません。</div>}
      </section>

      <section style={styles.card}>
        <details><summary style={{ fontWeight: 800 }}>OCR原文・解析情報</summary><textarea readOnly value={rawText} style={{ ...styles.debug, marginTop: 12 }} /><textarea readOnly value={debug} style={{ ...styles.debug, minHeight: 180, marginTop: 10 }} /></details>
      </section>
    </main>
  );
}
