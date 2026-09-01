/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { validateDocumentFile } from "../lib/file-security";

type Part = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
};

type Box = { x: number; w: number };
type OtherLayout = {
  firstY: number;
  rowPitch: number;
  name: Box;
  qty: Box;
  retail: Box;
  cost: Box;
};

const STORAGE_KEY = "parts-print-other-layout";

// 部品出庫伝票の右下「その他」欄を狙う初期値。
// 実機プリンターの余白差があるため、最終位置は画面からmm単位で調整する。
const initialLayout: OtherLayout = {
  firstY: 229,
  rowPitch: 5.0,
  name: { x: 121, w: 38 },
  qty: { x: 160, w: 9 },
  retail: { x: 170, w: 12 },
  cost: { x: 183, w: 13 },
};

function moneyText(value: string) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && value !== "" ? n.toLocaleString("ja-JP") : value;
}

function readParts(): Part[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("parts-data") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readLayout(): OtherLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed) return initialLayout;
    return {
      firstY: Number(parsed.firstY) || initialLayout.firstY,
      rowPitch: Number(parsed.rowPitch) || initialLayout.rowPitch,
      name: { ...initialLayout.name, ...(parsed.name || {}) },
      qty: { ...initialLayout.qty, ...(parsed.qty || {}) },
      retail: { ...initialLayout.retail, ...(parsed.retail || {}) },
      cost: { ...initialLayout.cost, ...(parsed.cost || {}) },
    };
  } catch {
    return initialLayout;
  }
}

function createPrintCanvas(parts: Part[], layout: OtherLayout) {
  // PDFに日本語を確実に出すため、文字は高解像度Canvasへ描いてからPDF化する。
  const pxPerMm = 8;
  const canvas = document.createElement("canvas");
  canvas.width = 210 * pxPerMm;
  canvas.height = 297 * pxPerMm;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("印刷データを作成できませんでした。");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(2.8 * pxPerMm)}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif`;

  const mm = (value: number) => value * pxPerMm;

  parts.forEach((part, index) => {
    const top = layout.firstY + index * layout.rowPitch;
    const baseline = mm(top + 2.25);

    ctx.textAlign = "left";
    ctx.fillText(part.name || "", mm(layout.name.x), baseline, mm(layout.name.w));

    ctx.textAlign = "center";
    ctx.fillText(part.qty || "", mm(layout.qty.x + layout.qty.w / 2), baseline, mm(layout.qty.w));

    ctx.textAlign = "right";
    ctx.fillText(moneyText(part.retail), mm(layout.retail.x + layout.retail.w - 0.8), baseline, mm(layout.retail.w));
    ctx.fillText(moneyText(part.cost), mm(layout.cost.x + layout.cost.w - 0.8), baseline, mm(layout.cost.w));
  });

  return canvas;
}

export default function PartsPrintPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [layout, setLayout] = useState<OtherLayout>(initialLayout);
  const [guide, setGuide] = useState("");
  const [message, setMessage] = useState("未割り当て部品は右下の「その他」欄へ4項目すべて印刷します。");

  useEffect(() => {
    const loaded = readParts();
    setParts(loaded);
    if (loaded[0]) setSelectedIds([loaded[0].id]);
    setLayout(readLayout());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const selectedParts = useMemo(
    () => parts.filter((p) => selectedIds.includes(p.id)),
    [parts, selectedIds]
  );

  function togglePart(id: string) {
    setSelectedIds((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  }

  function setField(field: keyof OtherLayout, value: number) {
    setLayout((old) => ({ ...old, [field]: value }));
  }

  function setBox(field: "name" | "qty" | "retail" | "cost", key: keyof Box, value: number) {
    setLayout((old) => ({ ...old, [field]: { ...old[field], [key]: value } }));
  }

  async function loadGuide(file: File) {
    const fileCheck = await validateDocumentFile(file);
    if (!fileCheck.ok) { setMessage(fileCheck.message); return; }
    if (guide) URL.revokeObjectURL(guide);
    setGuide(URL.createObjectURL(file));
    setMessage("用紙写真をガイド表示しました。写真は印刷されません。");
  }

  function makePdfAndOpen() {
    if (!selectedParts.length) {
      setMessage("印刷する部品を1件以上選んでください。");
      return;
    }

    // iPhone SafariのWebページ直接印刷ではURL/日付が入り2ページになることがあるため、
    // A4ちょうど1ページのPDFを作ってPDF側から印刷する。
    const popup = window.open("about:blank", "_blank");
    try {
      const canvas = createPrintCanvas(selectedParts, layout);
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 210, 297, undefined, "FAST");
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);

      if (popup) {
        popup.location.href = url;
      } else {
        location.assign(url);
      }

      setMessage("A4・1ページの印刷用PDFを開きました。PDF画面の共有/印刷から印刷してください。");
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) {
      console.error(error);
      popup?.close();
      setMessage("印刷用PDFの作成に失敗しました。もう一度押してください。");
    }
  }

  const fieldRows: Array<["name" | "qty" | "retail" | "cost", string]> = [
    ["name", "部品名称"],
    ["qty", "個数"],
    ["retail", "定価"],
    ["cost", "仕入れ"],
  ];

  return (
    <main className="page">
      <div className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <strong>icb</strong>
      </div>

      <section className="card">
        <h1>部品出庫伝票へ印刷</h1>
        <p>
          <b>安全ルール：</b>名称が似ているだけでは既存品名へ自動割り当てしません。
          明示的な割り当てがない部品は、右下の「その他」欄へ
          <b> 部品名称・個数・定価・仕入れの4項目 </b>を印刷します。
        </p>
        <div className="notice">{message}</div>

        <h2>印刷する部品</h2>
        {!parts.length && <p>保存済み部品がありません。先にOCR結果を保存してください。</p>}
        <div className="partList">
          {parts.map((p, i) => (
            <label className="part" key={p.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(p.id)}
                onChange={() => togglePart(p.id)}
              />
              <span>
                <b>{p.name || "名称未入力"}</b><br />
                個数 {p.qty || "-"}　定価 {moneyText(p.retail)}　仕入れ {moneyText(p.cost)}
              </span>
              {i === 0 && <small>最新</small>}
            </label>
          ))}
        </div>

        <div className="actions">
          <button className="primary" onClick={makePdfAndOpen}>📄 A4・1ページPDFを作って印刷</button>
          <button onClick={() => document.getElementById("position-settings")?.scrollIntoView({ behavior: "smooth" })}>
            印刷位置を調整
          </button>
        </div>
        <p className="hint">iPhoneではPDFを開いたあと、共有ボタン →「プリント」で印刷します。WebページのURLや日付は印刷されません。</p>
      </section>

      <section className="card" id="position-settings">
        <h2>右下「その他」欄の位置調整</h2>
        <p>まず初期位置で試し刷りし、上下左右のズレだけmm単位で合わせます。</p>
        <label className="fileButton">
          🖼 用紙写真をガイド表示
          <input hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadGuide(f); }} />
        </label>

        <div className="settingsGrid">
          <label>1行目 Y(mm)<input type="number" step="0.5" value={layout.firstY} onChange={(e) => setField("firstY", Number(e.target.value))} /></label>
          <label>行間(mm)<input type="number" step="0.1" value={layout.rowPitch} onChange={(e) => setField("rowPitch", Number(e.target.value))} /></label>
        </div>

        <div className="fieldSettings">
          {fieldRows.map(([key, label]) => (
            <div className="fieldBox" key={key}>
              <b>{label}</b>
              <label>X(mm)<input type="number" step="0.5" value={layout[key].x} onChange={(e) => setBox(key, "x", Number(e.target.value))} /></label>
              <label>幅(mm)<input type="number" step="0.5" value={layout[key].w} onChange={(e) => setBox(key, "w", Number(e.target.value))} /></label>
            </div>
          ))}
        </div>
        <button onClick={() => setLayout(initialLayout)}>初期位置に戻す</button>
      </section>

      <section className="previewCard">
        <h2>位置プレビュー</h2>
        <p>薄い写真は位置確認用だけです。PDFには文字だけ入ります。</p>
      </section>

      <div className="sheet previewSheet">
        {guide && <img className="guide" src={guide} alt="部品出庫伝票ガイド" />}
        {!guide && <div className="placeholder">A4 部品出庫伝票<br />右下「その他」欄に印字</div>}
        {selectedParts.map((p, i) => {
          const y = layout.firstY + i * layout.rowPitch;
          return (
            <div key={p.id}>
              <div className="overlay name" style={{ left: `${layout.name.x}mm`, top: `${y}mm`, width: `${layout.name.w}mm` }}>{p.name}</div>
              <div className="overlay center" style={{ left: `${layout.qty.x}mm`, top: `${y}mm`, width: `${layout.qty.w}mm` }}>{p.qty}</div>
              <div className="overlay right" style={{ left: `${layout.retail.x}mm`, top: `${y}mm`, width: `${layout.retail.w}mm` }}>{moneyText(p.retail)}</div>
              <div className="overlay right" style={{ left: `${layout.cost.x}mm`, top: `${y}mm`, width: `${layout.cost.w}mm` }}>{moneyText(p.cost)}</div>
            </div>
          );
        })}
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f3f6fb; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .page { max-width: 980px; margin: 0 auto; padding: 18px 14px 60px; }
        .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        button, .fileButton { border: 1px solid #cdd7e5; border-radius: 12px; padding: 11px 14px; background: white; color: #2674e8; font-weight: 800; font-size: 16px; cursor: pointer; }
        .primary { background: #2f6fe4; color: white; border-color: #2f6fe4; }
        .card, .previewCard { background: white; border: 1px solid #d9e0ea; border-radius: 22px; padding: 22px; margin-bottom: 16px; }
        h1 { font-size: 32px; margin: 0 0 12px; }
        h2 { margin-top: 6px; }
        p { color: #5d6878; line-height: 1.7; }
        .hint { font-size: 14px; margin: 10px 0 0; }
        .notice { background: #e9f7ef; border: 1px solid #bfe6ce; border-radius: 12px; padding: 13px 15px; line-height: 1.6; margin: 14px 0; }
        .partList { display: grid; gap: 9px; }
        .part { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; border: 1px solid #dbe3ee; border-radius: 12px; padding: 12px; }
        .part input { width: 22px; height: 22px; }
        .part small { background: #e8f0ff; color: #2f6fe4; padding: 4px 7px; border-radius: 999px; }
        .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
        .settingsGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 15px 0; }
        .settingsGrid label, .fieldBox label { display: grid; gap: 5px; color: #5d6878; font-weight: 700; }
        input[type="number"] { width: 100%; border: 1px solid #cdd7e5; border-radius: 10px; padding: 10px; font-size: 16px; }
        .fieldSettings { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
        .fieldBox { border: 1px solid #dbe3ee; border-radius: 12px; padding: 10px; display: grid; gap: 8px; }
        .sheet { position: relative; width: 210mm; height: 297mm; background: white; overflow: hidden; }
        .previewSheet { margin: 0 auto; transform-origin: top center; box-shadow: 0 5px 30px #23334b20; }
        .guide { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; opacity: .35; }
        .placeholder { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: #9aa5b5; font-size: 24px; }
        .overlay { position: absolute; height: 4.5mm; line-height: 4.5mm; font-size: 2.8mm; white-space: nowrap; overflow: hidden; color: #000; z-index: 2; }
        .overlay.name { text-align: left; }
        .overlay.center { text-align: center; }
        .overlay.right { text-align: right; padding-right: .8mm; }

        @media (max-width: 760px) {
          .fieldSettings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .previewSheet { transform: scale(.38); margin-bottom: calc(-297mm * .62); }
        }
      `}</style>
    </main>
  );
}
