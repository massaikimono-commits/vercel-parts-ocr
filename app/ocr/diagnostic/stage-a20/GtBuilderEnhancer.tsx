"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EXPECTED_FILES } from "../stage-a4/gt";

type GtRow = { name: string; qty: string; retail: string; cost: string };
type GtMap = Record<string, GtRow[]>;
type PreviewMap = Record<string, { url: string; originalName: string }>;

const STORAGE_KEY = "icb.parts-ocr.stage-a19.four-field-gt.v1";
const EMPTY_ROW: GtRow = { name: "", qty: "", retail: "", cost: "" };

function blankMap(): GtMap {
  return Object.fromEntries(EXPECTED_FILES.map((file) => [file, [{ ...EMPTY_ROW }]]));
}

function normalizeStored(value: unknown): GtMap {
  const base = blankMap();
  if (!value || typeof value !== "object") return base;
  for (const file of EXPECTED_FILES) {
    const rows = (value as Record<string, unknown>)[file];
    if (!Array.isArray(rows) || !rows.length) continue;
    base[file] = rows.map((row) => {
      const v = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        name: String(v.name ?? ""), qty: String(v.qty ?? ""), retail: String(v.retail ?? ""), cost: String(v.cost ?? ""),
      };
    });
  }
  return base;
}

function canonicalFromName(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  if (!m) return "";
  return EXPECTED_FILES.find((file) => file.startsWith(`IMG_${m[1]}`)) || "";
}

function evalInput() {
  return document.querySelector('main input[type="file"][multiple]') as HTMLInputElement | null;
}

export default function GtBuilderEnhancer() {
  const [gt, setGt] = useState<GtMap>(() => blankMap());
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("未保存");
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [selectionState, setSelectionState] = useState("最初に黄色正式12枚を一括選択してください。");
  const urls = useRef<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setGt(normalizeStored(JSON.parse(raw)));
    } catch { setSaveState("保存済みGT読込失敗"); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gt)); setSaveState("ブラウザに自動保存済み"); }
    catch { setSaveState("ブラウザ保存失敗"); }
  }, [gt, loaded]);

  useEffect(() => {
    const capture = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "file" || !target.multiple || !target.closest("main")) return;
      if (target.dataset.a20AllowRun === "1") return;
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(target.files || []);
      urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = [];
      const next: PreviewMap = {}, duplicates: string[] = [], unknown: string[] = [];
      for (const file of files) {
        const id = canonicalFromName(file.name);
        if (!id) { unknown.push(file.name); continue; }
        if (next[id]) { duplicates.push(file.name); continue; }
        const url = URL.createObjectURL(file); urls.current.push(url); next[id] = { url, originalName: file.name };
      }
      setPreviews(next);
      const missing = EXPECTED_FILES.filter((id) => !next[id]);
      setSelectionState([
        `対応確認 ${Object.keys(next).length}/12`,
        missing.length ? `不足: ${missing.join(", ")}` : "12枚すべて1対1対応済み",
        duplicates.length ? `重複: ${duplicates.join(", ")}` : "",
        unknown.length ? `対象外: ${unknown.join(", ")}` : "",
      ].filter(Boolean).join(" / "));
    };
    document.addEventListener("change", capture, true);
    return () => { document.removeEventListener("change", capture, true); urls.current.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  useEffect(() => {
    const hideMain = () => {
      const input = evalInput();
      if (!input) return false;
      const section = input.closest("section");
      section?.querySelectorAll("button").forEach((b) => { if (b.textContent?.includes("黄色正式12枚")) (b as HTMLButtonElement).style.display = "none"; });
      return true;
    };
    if (!hideMain()) { const t = window.setInterval(() => { if (hideMain()) window.clearInterval(t); }, 100); return () => window.clearInterval(t); }
  }, []);

  const completed = useMemo(() => EXPECTED_FILES.filter((file) => (gt[file] || []).some((r) => r.name.trim() || r.qty.trim() || r.retail.trim() || r.cost.trim())).length, [gt]);
  const selected = EXPECTED_FILES.filter((file) => previews[file]).length;

  function update(file: string, index: number, key: keyof GtRow, value: string) {
    setGt((cur) => ({ ...cur, [file]: cur[file].map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  }
  function add(file: string) { setGt((cur) => ({ ...cur, [file]: [...cur[file], { ...EMPTY_ROW }] })); }
  function remove(file: string, index: number) { setGt((cur) => { const rows = cur[file].filter((_, i) => i !== index); return { ...cur, [file]: rows.length ? rows : [{ ...EMPTY_ROW }] }; }); }
  function choose() { const input = evalInput(); if (input) input.click(); else setSelectionState("評価用画像選択欄が見つかりません。再読み込みしてください。"); }
  function run() {
    const input = evalInput();
    if (!input?.files?.length) { setSelectionState("先に正式12枚を選択してください。"); return; }
    const missing = EXPECTED_FILES.filter((f) => !previews[f]);
    if (missing.length) { setSelectionState(`写真対応が未完了: ${missing.join(", ")}`); return; }
    if (completed !== EXPECTED_FILES.length) { setSelectionState(`GT未入力の伝票があります。入力済み ${completed}/12`); return; }
    input.dataset.a20AllowRun = "1";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => delete input.dataset.a20AllowRun, 0);
  }

  return <section style={{ maxWidth: 1120, margin: "16px auto 0", padding: "0 12px" }}>
    <div style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14 }}>
      <h2 style={{ marginTop: 0 }}>Stage A20 正式12枚・4項目GT</h2>
      <p>同じ12枚をここで一度だけ選択します。ファイル名からIMG_0675〜IMG_0686へ自動対応し、サムネイル横の表へ実伝票の印字を入力してください。GTは採点にだけ使われ、OCR runtimeには渡しません。</p>
      <button type="button" onClick={choose} style={{ width: "100%", border: 0, borderRadius: 12, padding: 12, background: "#174ea6", color: "#fff", fontWeight: 800, fontSize: 16 }}>黄色正式12枚を一括選択して写真対応を確認</button>
      <div style={{ margin: "10px 0 12px", fontSize: 13, lineHeight: 1.55 }}>写真対応 {selected}/12 ・ GT入力 {completed}/12 ・ {saveState}<br />{selectionState}</div>
      {EXPECTED_FILES.map((file) => {
        const p = previews[file];
        return <details key={file} open={file === EXPECTED_FILES[0]} style={{ borderTop: "1px solid #e5e9f0", padding: "10px 0" }}>
          <summary style={{ fontWeight: 800, cursor: "pointer" }}>{file}</summary>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,220px) 1fr", gap: 12, marginTop: 10, alignItems: "start" }}>
            <div>{p ? <><img src={p.url} alt={`${file}対応画像`} style={{ width: "100%", maxHeight: 220, objectFit: "contain", border: "1px solid #ccd5e3", borderRadius: 10, background: "#f8fafc" }} /><div style={{ fontSize: 12, overflowWrap: "anywhere", marginTop: 4 }}>対応: <strong>{p.originalName}</strong></div></> : <div style={{ minHeight: 120, border: "1px dashed #c6ceda", borderRadius: 10, display: "grid", placeItems: "center", textAlign: "center", color: "#667085" }}>{file}<br />対応画像未選択</div>}</div>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}><thead><tr><th>#</th><th>部品名称</th><th>個数</th><th>定価</th><th>仕入れ</th><th /></tr></thead><tbody>{(gt[file] || []).map((row, i) => <tr key={`${file}-${i}`}><td>{i + 1}</td>{(["name","qty","retail","cost"] as const).map((key) => <td key={key} style={{ padding: 4 }}><input value={row[key]} onChange={(e) => update(file, i, key, e.target.value)} inputMode={key === "name" ? "text" : "numeric"} aria-label={`${file} row ${i + 1} ${key}`} style={{ width: "100%", boxSizing: "border-box", padding: "9px 8px", border: "1px solid #ccd5e3", borderRadius: 8 }} /></td>)}<td><button type="button" onClick={() => remove(file, i)}>削除</button></td></tr>)}</tbody></table><button type="button" onClick={() => add(file)} style={{ marginTop: 8, border: 0, borderRadius: 9, background: "#eef4ff", color: "#245eb7", fontWeight: 800, padding: "9px 12px" }}>＋ 行追加</button></div>
          </div>
        </details>;
      })}
      <button type="button" onClick={run} disabled={selected !== 12 || completed !== 12} style={{ width: "100%", border: 0, borderRadius: 13, padding: "14px 12px", marginTop: 14, background: selected === 12 && completed === 12 ? "#2468df" : "#aeb8c7", color: "#fff", fontWeight: 800, fontSize: 17 }}>この12枚とGTで3 recognition方式を1run</button>
    </div>
  </section>;
}
