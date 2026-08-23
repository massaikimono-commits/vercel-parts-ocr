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
  retail: ["定価", "標準価格", "希望小売価格", "売価", "販売価格"],
  cost: ["仕入れ", "仕入", "原価", "仕切", "仕切価格", "単価"],
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
  const n = s.replace(/[^\d]/g, "");
  return n;
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

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.96) {
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
    let hit = 0;
    let total = 0;
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
    let hit = 0;
    let total = 0;
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
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    let v = Math.round(r * 0.22 + g * 0.70 + b * 0.08);
    v = Math.max(0, Math.min(255, Math.round((v - 128) * 1.22 + 150)));
    if (v > 247) v = 255;
    image.data[p] = v;
    image.data[p + 1] = v;
    image.data[p + 2] = v;
    image.data[p + 3] = 255;
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
    const left = Number(c[6]);
    const top = Number(c[7]);
    const width = Number(c[8]);
    const height = Number(c[9]);
    words.push({
      text,
      left,
      top,
      width,
      height,
      conf,
      lineKey: `${c[2]}-${c[3]}-${c[4]}`,
    });
  }

  const groups = new Map<string, Word[]>();
  for (const word of words) {
    const list = groups.get(word.lineKey) || [];
    list.push(word);
    groups.set(word.lineKey, list);
  }

  return [...groups.values()]
    .map((lineWords) => {
      const sorted = [...lineWords].sort((a, b) => a.left - b.left);
      return {
        words: sorted,
        text: sorted.map((x) => x.text).join(" "),
        top: Math.min(...sorted.map((x) => x.top)),
        bottom: Math.max(...sorted.map((x) => x.top + x.height)),
      };
    })
    .sort((a, b) => a.top - b.top);
}

function findLabelInWords(words: Word[], labels: string[]) {
  for (let i = 0; i < words.length; i += 1) {
    for (let len = 1; len <= 3 && i + len <= words.length; len += 1) {
      const slice = words.slice(i, i + len);
      const joined = labelText(slice.map((x) => x.text).join(""));
      const label = labels.find((x) => {
        const target = labelText(x);
        return joined === target || joined.includes(target) || target.includes(joined) && joined.length >= 2;
      });
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
    const unique = new Map(matches.map((x) => [x.key, x]));
    const list = [...unique.values()];
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
    for (const word of line.words) {
      const key = nearestColumn(word, headers);
      if (key) cells[key].push(word.text);
    }

    const rawName = cleanName(cells.name.join(" "));
    let qty = qtyValue(cells.qty.join(" "));
    let retail = hasRetail ? moneyValue(cells.retail.join(" ")) : "";
    let cost = hasCost ? moneyValue(cells.cost.join(" ")) : "";

    if (!hasRetail && hasCost) cost = moneyValue(cells.cost.join(" "));
    if (hasRetail && !hasCost) retail = moneyValue(cells.retail.join(" "));

    const hasPrice = Boolean(retail || cost);
    if (!hasPrice && rawName) {
      pendingName = pendingName ? `${pendingName} ${rawName}` : rawName;
      continue;
    }
    if (!hasPrice) continue;

    const name = cleanName([pendingName, rawName].filter(Boolean).join(" "));
    pendingName = "";
    if (!qty) qty = "1";

    if (name || qty || retail || cost) {
      found.push({ id: uid(), name, qty, retail, cost, source: allText });
    }
  }
  return found;
}

function amountValues(line: string) {
  const matches = normalize(line).match(/\d{1,3}(?:[,\.]\d{3})+|\d{3,7}/g) || [];
  return matches
    .map((raw) => ({ raw, value: Number(raw.replace(/\D/g, "")) }))
    .filter((x) => x.value >= 100 && x.value <= 5000000);
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
      found.push({
        id: uid(),
        name,
        qty,
        retail: amounts[0] ? String(amounts[0].value) : "",
        cost: amounts[1] ? String(amounts[1].value) : "",
        source: line,
      });
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

  async function runOCR(file: File) {
    setBusy(true);
    setProgress(1);
    setParts([]);
    setRawText("");
    setDebug("");
    setMessage("用紙全体を解析しています…");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      const source = await sourceCanvas(file);
      const paper = detectPaper(source);
      const enhanced = await makeEnhanced(source, paper);
      const tesseract: any = await import("tesseract.js");
      worker = await tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") setProgress(Math.max(5, Math.round((m.progress || 0) * 95)));
        },
      });
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? "3",
        user_defined_dpi: "300",
      });
      const result = await worker.recognize(enhanced, {}, { text: true, tsv: true });
      const text = result.data.text || "";
      const tsv = result.data.tsv || "";
      setRawText(text);

      const lines = parseTSV(tsv);
      const header = detectHeader(lines);
      let extracted: Part[] = [];
      if (header && header.matches.length >= 3) extracted = parseByColumns(lines, header);
      if (!extracted.length) extracted = fallbackParse(text);
      extracted = dedupe(extracted);
      setParts(extracted);

      const headerDebug = header
        ? `見出し行: ${header.index + 1}\n検出列: ${header.matches.map((x) => `${x.key}=${x.label}`).join(" / ")}`
        : "見出し行: 自動検出できず（全文フォールバック使用）";
      const lineDebug = lines.slice(0, 80).map((x, i) => `${i + 1}: ${x.text}`).join("\n");
      setDebug(`${headerDebug}\n\nOCR行データ\n${lineDebug}`);
      setProgress(100);
      setMessage(
        extracted.length
          ? `${extracted.length}件を候補抽出しました。内容を確認して保存してください。`
          : "候補を自動抽出できませんでした。OCR全文は残してあるので、実物に合わせて調整できます。"
      );
    } catch (error) {
      console.error(error);
      setMessage("汎用OCR処理でエラーが出ました。画像を変えずにもう一度試してください。");
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  }

  function updatePart(index: number, key: keyof Part, value: string) {
    setParts((old) => old.map((p, i) => i === index ? { ...p, [key]: value } : p));
  }

  function addManual() {
    setParts((old) => [...old, { id: uid(), name: "", qty: "1", retail: "", cost: "" }]);
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
    setMessage(`${parts.length}件を部品データへ保存しました。`);
  }

  async function copyTSV() {
    const text = [
      "部品名称\t個数\t定価\t仕入れ",
      ...parts.map((p) => `${p.name}\t${p.qty}\t${p.retail}\t${p.cost}`),
    ].join("\n");
    await navigator.clipboard?.writeText(text);
    setMessage("Excel貼り付け用データをコピーしました。");
  }

  function saveCSV() {
    const text = [["部品名称", "個数", "定価", "仕入れ"], ...parts.map((p) => [p.name, p.qty, p.retail, p.cost])]
      .map((row) => row.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }));
    a.download = "parts-general-ocr.csv";
    a.click();
  }

  return (
    <main style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button onClick={() => location.assign("/")} style={{ border: "1px solid #ccd5e2", background: "#fff", borderRadius: 12, padding: "10px 14px", color: "#2674e8", fontWeight: 700 }}>← メインへ</button>
        <div style={{ fontWeight: 800 }}>icb</div>
      </div>

      <section style={styles.card}>
        <h1 style={styles.title}>汎用A4・他社伝票OCR</h1>
        <p style={styles.text}>
          A4いっぱいに部品が並ぶ用紙や、まだ登録していない他社伝票向けです。用紙全体をOCRして「部品名称・数量・定価・仕入れ」に近い見出しを探し、表の列位置から複数行をまとめて抽出します。
        </p>
        {message && <div style={styles.notice}>{message}{busy ? `（${progress}%）` : ""}</div>}

        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && runOCR(e.target.files[0])} />
        <input ref={libraryRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && runOCR(e.target.files[0])} />
        <button disabled={busy} style={styles.primary} onClick={() => cameraRef.current?.click()}>📷 今撮影して汎用OCR</button>
        <button disabled={busy} style={styles.secondary} onClick={() => libraryRef.current?.click()}>🖼 写真ライブラリから汎用OCR</button>
        {preview && <img src={preview} alt="読み取り画像" style={{ width: "100%", maxHeight: 460, objectFit: "contain", borderRadius: 14, marginTop: 16, background: "#eef2f7" }} />}
      </section>

      <section style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <h2 style={{ marginTop: 0 }}>抽出データ</h2>
          <button style={{ border: "1px solid #ccd5e2", borderRadius: 10, padding: "9px 12px", background: "#fff" }} onClick={addManual}>＋1行追加</button>
        </div>
        {!parts.length && <p style={styles.text}>まだ抽出データはありません。</p>}
        {parts.length > 0 && (
          <>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 600 }}>
                <div style={{ ...styles.row, fontWeight: 800 }}><div>部品名称</div><div>個数</div><div>定価</div><div>仕入れ</div></div>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button style={styles.secondary} onClick={copyTSV}>📋 Excelへコピー</button>
              <button style={styles.secondary} onClick={saveCSV}>CSV保存</button>
            </div>
          </>
        )}
      </section>

      <section style={styles.card}>
        <details>
          <summary style={{ fontWeight: 800, cursor: "pointer" }}>OCR詳細（調整用）</summary>
          <p style={styles.text}>実物のA4伝票が手に入った時は、ここに出る「検出列」とOCR行データを見ながら精度を合わせられます。</p>
          <textarea readOnly value={debug} style={styles.debug} />
        </details>
      </section>

      <section style={styles.card}>
        <details>
          <summary style={{ fontWeight: 800, cursor: "pointer" }}>OCR全文</summary>
          <textarea readOnly value={rawText} style={styles.debug} />
        </details>
      </section>
    </main>
  );
}
