/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState } from "react";
import { consumeOCRTransferImage } from "./transfer";
import {
  createDocumentRecognitionSession,
  createSharedTesseractWorker,
  recognizeDocumentRegion,
  OCR_FIELD_PRESETS,
} from "../lib/document-recognition-v2";

type Part = { id: string; name: string; qty: string; retail: string; cost: string; source?: string };

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
  debug: { width: "100%", minHeight: 260, border: "1px solid #d6deea", borderRadius: 12, padding: 12, fontSize: 13, background: "#f8fafc" },
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

function cleanPartName(raw: string) {
  const text = normalizeText(raw)
    .replace(/([ぁ-んァ-ヶ一-龠])\s+(?=[ぁ-んァ-ヶ一-龠])/g, "$1")
    .replace(/^[\[\](){}|\\・:;.,\s]+/, "")
    .replace(/\bMC\s*-?\s*E\s*\d+\b/gi, " ")
    .replace(/\*?0{2,}\d+/g, " ")
    .replace(/[¥￥]\s*[0-9Il|OQS,.\s]+.*$/i, "")
    .replace(/\s+[YV]\s*\d{3,}.*$/i, "")
    .replace(/^[-:;|・.\s]+|[-:;|・.\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const assy = text.match(/^(.*?\b(?:ASSY|COMP|KIT|SET)\b)(?:\s+(RH|LH|FR|RR))?.*$/i);
  if (assy) return (assy[1] + (assy[2] ? ` ${assy[2]}` : "")).trim();
  return text;
}

function nameScore(text: string) {
  const cleaned = cleanPartName(text);
  if (cleaned.length < 3) return -100;
  if (/品番|品名|受注|出庫|標準価格|単価|金額|倉庫|棚番|受注残|年月日|売上|コード|合計|伝票|型式|車台/.test(cleaned)) return -100;
  let score = 0;
  const jp = cleaned.match(/[ぁ-んァ-ヶ一-龠]/g)?.length || 0;
  const alpha = cleaned.match(/[A-Za-z]/g)?.length || 0;
  const digits = cleaned.match(/\d/g)?.length || 0;
  score += Math.min(16, jp * 2) + Math.min(10, alpha);
  if (/ASSY|COMP|KIT|SET/i.test(cleaned)) score += 10;
  if (/[\/／]/.test(cleaned)) score += 5;
  if (digits > cleaned.length * 0.4) score -= 12;
  return score;
}

function bestName(texts: string[]) {
  let name = "";
  let score = -100;
  for (const text of texts) {
    for (const line of normalizeText(text).split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      const cleaned = cleanPartName(line);
      const s = nameScore(cleaned);
      if (s > score) { score = s; name = cleaned; }
    }
  }
  return { name: score >= 1 ? name : "", score };
}

function detectSupplierCode(texts: string[]) {
  const joined = normalizeText(texts.join(" ")).toUpperCase().replace(/\s+/g, "");
  return joined.match(/[A-Z]{1,4}-[A-Z0-9]{2,8}/)?.[0] || "";
}

function observationTexts(result: any) {
  return [...new Set([
    result?.value,
    ...(result?.observations || []).map((x: any) => x?.text),
  ].map((x) => String(x || "").trim()).filter(Boolean))];
}

function numericValue(result: any, max: number) {
  const raw = String(result?.value || "").replace(/\D/g, "");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= max ? String(n) : "";
}

async function readName(session: any, worker: any, y: number) {
  const result = await recognizeDocumentRegion(session, worker, {
    x: 0.025,
    y: y + 0.002,
    width: 0.370,
    height: 0.060,
  }, {
    ...OCR_FIELD_PRESETS.japaneseText,
    variants: ["original", "contrast", "adaptiveBinary", "binaryDark"],
    psms: ["11", "7", "6"],
    targetWidth: 2500,
    minSimilarity: 0.58,
    minSupport: 2,
    minConfidence: 0.53,
    recoveryMaxPasses: 6,
  });
  const texts = observationTexts(result);
  const supplierCode = detectSupplierCode(texts);
  const fallback = bestName(texts);
  const recognized = cleanPartName(result?.value || fallback.name);
  return {
    name: recognized,
    score: fallback.score,
    texts,
    supplierCode,
    reason: result?.reason || "",
  };
}

async function readNumber(session: any, worker: any, region: any, max: number, qtyMode = false) {
  const result = await recognizeDocumentRegion(session, worker, region, {
    ...(qtyMode ? OCR_FIELD_PRESETS.number : OCR_FIELD_PRESETS.money),
    variants: ["original", "contrast", "adaptiveBinary", "binaryDark"],
    psms: qtyMode ? ["10", "8", "7"] : ["8", "7"],
    targetWidth: qtyMode ? 1100 : 1700,
    minSupport: 2,
    minConfidence: qtyMode ? 0.56 : 0.60,
    recoveryMaxPasses: 5,
    validate: (value: string) => {
      const n = Number(String(value).replace(/\D/g, ""));
      return Number.isFinite(n) && n > 0 && n <= max;
    },
  });
  return {
    value: numericValue(result, max),
    texts: observationTexts(result),
    reason: result?.reason || "",
  };
}

function chooseCost(costRead: any, amountRead: any, qty: string) {
  if (costRead.value) return costRead.value;
  if (qty === "1") return amountRead.value;
  return "";
}

export default function HighAccuracyOCRPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("共通OCR V2で4項目を伝票の印字位置ごとに読み取ります。");
  const [parts, setParts] = useState<Part[]>([]);
  const [debugText, setDebugText] = useState("");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let active = true;
    consumeOCRTransferImage().then((file) => {
      if (active && file) runOCR(file);
    }).catch((error) => console.error(error));
    return () => { active = false; };
  }, []);

  async function runOCR(file: File) {
    setBusy(true);
    setProgress(1);
    setParts([]);
    setDebugText("");
    setMessage("共通OCR V2で伝票画像を補正しています…");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));

    let worker: any = null;
    try {
      const session = await createDocumentRecognitionSession(file, {
        maxSide: 3600,
        cropPaper: true,
        minPaperConfidence: 0.45,
      });
      const created = await createSharedTesseractWorker({
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setProgress((old) => Math.max(old, Math.min(96, old + Math.max(1, Math.round((m.progress || 0) * 2)))));
          }
        },
      });
      worker = created.worker;

      const found: Part[] = [];
      const logs: string[] = [
        "共通OCR V2 / 大一用品商会 専用レイアウト",
        "部品名称は辞書で置換せず、OCR結果そのものを採用",
        `傾き補正: ${session.geometry.deskewApplied ? `${session.geometry.deskewAngle.toFixed(2)}° conf=${session.geometry.deskewConfidence.toFixed(2)}` : "不要/保留"}`,
        ...(session.qualityWarnings || []).map((x: string) => `画像品質: ${x}`),
      ];
      const firstRowY = 0.440;
      const rowStep = 0.100;
      let emptyRows = 0;

      for (let row = 0; row < 4; row += 1) {
        const y = firstRowY + row * rowStep;
        if (y >= 0.88) break;
        setMessage(`共通OCR V2: 部品表 ${row + 1}行目を読み取り中…`);
        setProgress((old) => Math.max(old, 8 + row * 20));

        const nameRead = await readName(session, worker, y);
        const qtyRead = await readNumber(session, worker, { x: 0.432, y, width: 0.040, height: 0.070 }, 99, true);
        const retailRead = await readNumber(session, worker, { x: 0.480, y, width: 0.090, height: 0.070 }, 2000000);
        const costRead = await readNumber(session, worker, { x: 0.596, y, width: 0.080, height: 0.070 }, 2000000);
        const amountRead = await readNumber(session, worker, { x: 0.730, y, width: 0.080, height: 0.070 }, 2000000);

        let qty = qtyRead.value;
        if (!qty && (retailRead.value || costRead.value || amountRead.value)) qty = "1";
        if (Number(qty) > 20 && (retailRead.value || costRead.value)) qty = "1";
        const retail = retailRead.value;
        const cost = chooseCost(costRead, amountRead, qty);

        logs.push(
          `【${row + 1}行目】`,
          `名称OCR: ${nameRead.texts.join(" / ") || "なし"}`,
          `品番候補(診断のみ): ${nameRead.supplierCode || ""}`,
          `名称採用: ${nameRead.name} / ${nameRead.reason}`,
          `個数: ${qtyRead.texts.join(" / ")} => ${qty} / ${qtyRead.reason}`,
          `定価: ${retailRead.texts.join(" / ")} => ${retail} / ${retailRead.reason}`,
          `仕入れ: ${costRead.texts.join(" / ")} => ${cost} / ${costRead.reason}`,
          `金額補助: ${amountRead.texts.join(" / ")} => ${amountRead.value} / ${amountRead.reason}`,
        );

        const strongName = nameScore(nameRead.name) >= 8;
        const retailOk = Number(retail || 0) >= 100;
        const costOk = Number(cost || 0) >= 100;
        const isRealPartRow = (retailOk && costOk) || (strongName && (retailOk || costOk));
        if (isRealPartRow) {
          found.push({ id: uid(), name: nameRead.name, qty, retail, cost, source: logs.slice(-8).join("\n") });
          emptyRows = 0;
        } else {
          emptyRows += 1;
          if (emptyRows >= 2 && row > 0) break;
        }
      }

      setParts(found);
      setDebugText(logs.join("\n\n"));
      setProgress(100);
      setMessage(found.length
        ? `${found.length}件を抽出しました。名称は辞書で補わず、共通OCR V2の認識結果を表示しています。`
        : "部品行を安全に確定できませんでした。誤った値は保存していません。");
    } catch (error) {
      console.error(error);
      setMessage("OCR処理でエラーが出ました。誤った値は保存していません。");
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
        <p style={styles.text}>専用帳票の列位置は帳票仕様として利用しますが、部品名称を辞書で正解へ置換しません。文字認識は車検証と同じ共通OCR V2で行い、原画像・コントラスト・影対応画像を比較して読み取ります。</p>
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
        {parts.length > 0 && <>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ ...styles.row, fontWeight: 800, padding: "0 2px" }}><div>部品名称</div><div>個数</div><div>定価</div><div>仕入れ</div></div>
              {parts.map((p, i) => <div style={styles.row} key={p.id}>
                <input style={styles.input} value={p.name} onChange={(e) => updatePart(i, "name", e.target.value)} />
                <input style={styles.input} inputMode="numeric" value={p.qty} onChange={(e) => updatePart(i, "qty", e.target.value)} />
                <input style={styles.input} inputMode="numeric" value={p.retail} onChange={(e) => updatePart(i, "retail", e.target.value)} />
                <input style={styles.input} inputMode="numeric" value={p.cost} onChange={(e) => updatePart(i, "cost", e.target.value)} />
              </div>)}
            </div>
          </div>
          <button style={styles.primary} onClick={saveParts}>✓ この内容を部品データへ保存</button>
        </>}
      </section>
      <section style={styles.card}>
        <details>
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>OCR詳細（調整用）</summary>
          <p style={styles.text}>共通OCR V2の複数画像・複数PSM・高解像度再読取の候補と採用理由を表示します。品番候補は診断用で、名称の自動置換には使いません。</p>
          <textarea readOnly value={debugText} style={styles.debug} />
        </details>
      </section>
    </main>
  );
}
