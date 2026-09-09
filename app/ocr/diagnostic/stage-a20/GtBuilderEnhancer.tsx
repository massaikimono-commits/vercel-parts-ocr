"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EXPECTED_FILES } from "../stage-a4/gt";

type GtRow = { name: string; qty: string; retail: string; cost: string };
type GtMap = Record<string, GtRow[]>;
type PreviewMap = Record<string, { url: string; originalName: string }>;

const STORAGE_KEY = "icb.parts-ocr.stage-a19.four-field-gt.v1";
const EMPTY_ROW: GtRow = { name: "", qty: "", retail: "", cost: "" };

function blankMap(): GtMap {
  return Object.fromEntries(EXPECTED_FILES.map((f) => [f, [{ ...EMPTY_ROW }]]));
}
function normalizeStored(value: unknown): GtMap {
  const base = blankMap();
  if (!value || typeof value !== "object") return base;
  for (const f of EXPECTED_FILES) {
    const rows = (value as Record<string, unknown>)[f];
    if (!Array.isArray(rows) || !rows.length) continue;
    base[f] = rows.map((r) => {
      const v = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      return { name: String(v.name ?? ""), qty: String(v.qty ?? ""), retail: String(v.retail ?? ""), cost: String(v.cost ?? "") };
    });
  }
  return base;
}
function hasGtRows(rows: GtRow[] | undefined) {
  return Boolean(rows?.some((r) => r.name.trim() || r.qty.trim() || r.retail.trim() || r.cost.trim()));
}
function completeCount(gt: GtMap) {
  return EXPECTED_FILES.filter((f) => hasGtRows(gt[f])).length;
}
function canonical(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  return m ? EXPECTED_FILES.find((f) => f.startsWith(`IMG_${m[1]}`)) || "" : "";
}
function evalInput() {
  return document.querySelector('main input[type="file"][multiple]') as HTMLInputElement | null;
}
function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export default function GtBuilderEnhancer() {
  const [gt, setGt] = useState<GtMap>(() => blankMap());
  const [loaded, setLoaded] = useState(false);
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [state, setState] = useState("A19保存済みGTを確認しています…");
  const urls = useRef<string[]>([]);

  useEffect(() => {
    try {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const payload = params.get("a19gt");
      if (payload) {
        const migrated = normalizeStored(JSON.parse(fromBase64Url(payload)));
        const count = completeCount(migrated);
        if (count !== 12) throw new Error(`migrated GT incomplete: ${count}/12`);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        setGt(migrated);
        setState("A19保存済みGTを移行しました。A19保存済みGTを使用中");
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        setLoaded(true);
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const next = normalizeStored(JSON.parse(raw));
        setGt(next);
        const count = completeCount(next);
        setState(count === 12 ? "A19保存済みGTを使用中" : `A19保存済みGTを検出しましたが ${count}/12 です。`);
      } else {
        setState("このSafari originにはA19保存済みGTがありません。A19移行ボタンから移してください。");
      }
    } catch {
      setState("A19 GT移行payloadまたは保存済みGTを読み込めませんでした。GT内容は変更していません。");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const capture = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "file" || !target.multiple || !target.closest("main")) return;
      if (target.dataset.a20AllowRun === "1") return;
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(target.files || []);
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
      const next: PreviewMap = {};
      const dup: string[] = [];
      const unknown: string[] = [];
      for (const file of files) {
        const id = canonical(file.name);
        if (!id) { unknown.push(file.name); continue; }
        if (next[id]) { dup.push(file.name); continue; }
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        next[id] = { url, originalName: file.name };
      }
      setPreviews(next);
      const missing = EXPECTED_FILES.filter((id) => !next[id]);
      setState([`画像対応 ${Object.keys(next).length}/12`, missing.length ? `不足: ${missing.join(", ")}` : "12枚すべて1対1対応済み", dup.length ? `重複: ${dup.join(", ")}` : "", unknown.length ? `対象外: ${unknown.join(", ")}` : ""].filter(Boolean).join(" / "));
    };
    document.addEventListener("change", capture, true);
    return () => { document.removeEventListener("change", capture, true); urls.current.forEach(URL.revokeObjectURL); };
  }, []);

  useEffect(() => {
    const hide = () => {
      const input = evalInput();
      if (!input) return false;
      input.closest("section")?.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("黄色正式12枚")) (b as HTMLButtonElement).style.display = "none";
      });
      return true;
    };
    if (!hide()) {
      const t = window.setInterval(() => { if (hide()) window.clearInterval(t); }, 100);
      return () => window.clearInterval(t);
    }
  }, []);

  const completed = useMemo(() => completeCount(gt), [gt]);
  const selected = EXPECTED_FILES.filter((f) => previews[f]).length;
  const rowCounts = useMemo(() => Object.fromEntries(EXPECTED_FILES.map((f) => [f, (gt[f] || []).filter((r) => r.name.trim() || r.qty.trim() || r.retail.trim() || r.cost.trim()).length])), [gt]);

  function choose() {
    const input = evalInput();
    if (input) input.click(); else setState("評価用画像選択欄が見つかりません。再読み込みしてください。");
  }
  function run() {
    const input = evalInput();
    if (!input?.files?.length) { setState("先に正式12枚を選択してください。"); return; }
    const missing = EXPECTED_FILES.filter((f) => !previews[f]);
    if (missing.length) { setState(`写真対応が未完了: ${missing.join(", ")}`); return; }
    if (completed !== 12) { setState(`A19保存済みGTが不足しています。${completed}/12`); return; }
    input.dataset.a20AllowRun = "1";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => delete input.dataset.a20AllowRun, 0);
  }

  return <section style={{ maxWidth: 1120, margin: "16px auto 0", padding: "0 12px" }}><div style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14 }}>
    <h2 style={{ marginTop: 0 }}>Stage A20 正式12枚</h2>
    <p style={{ lineHeight: 1.6 }}>A19で保存した4項目GTを自動読込します。GTはscoring-onlyで、A20 runtime/controlには使用しません。GTの再入力は不要です。</p>
    <div style={{ padding: 10, borderRadius: 10, background: completed === 12 ? "#eef8f0" : "#fff4e5", marginBottom: 10, fontWeight: 700 }}>{loaded ? (completed === 12 ? "A19保存済みGTを使用中 ・ 12/12" : `A19 GT ${completed}/12`) : "A19保存済みGTを確認中…"}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6, marginBottom: 12 }}>{EXPECTED_FILES.map((f) => <div key={f} style={{ border: "1px solid #e1e6ee", borderRadius: 8, padding: 8, fontSize: 12 }}>{f}<br/><strong>GT {rowCounts[f] || 0}行</strong></div>)}</div>
    {completed !== 12 && loaded && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#fff4e5", fontSize: 13, lineHeight: 1.5 }}>このA20 originには正式GTがありません。12枚の再入力はしません。A19側の「A20へGTを移行」から移してください。</div>}
    <button type="button" onClick={choose} disabled={completed !== 12} style={{ width: "100%", border: 0, borderRadius: 12, padding: 12, background: completed === 12 ? "#174ea6" : "#aeb8c7", color: "#fff", fontWeight: 800, fontSize: 16 }}>黄色正式12枚を一括選択</button>
    <div style={{ margin: "10px 0 12px", fontSize: 13 }}>写真対応 {selected}/12 ・ GT {completed}/12<br/>{state}</div>
    {selected > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 12 }}>{EXPECTED_FILES.map((f) => { const p = previews[f]; return <div key={f} style={{ border: "1px solid #e1e6ee", borderRadius: 8, padding: 6, fontSize: 11 }}><strong>{f}</strong>{p ? <><img src={p.url} alt={`${f}対応画像`} style={{ width: "100%", height: 110, objectFit: "contain", display: "block", marginTop: 4 }} /><div style={{ overflowWrap: "anywhere" }}>{p.originalName}</div></> : <div style={{ height: 110, display: "grid", placeItems: "center", color: "#667085" }}>未選択</div>}</div>; })}</div>}
    <button type="button" onClick={run} disabled={selected !== 12 || completed !== 12} style={{ width: "100%", border: 0, borderRadius: 13, padding: 14, marginTop: 6, background: selected === 12 && completed === 12 ? "#2468df" : "#aeb8c7", color: "#fff", fontWeight: 800, fontSize: 17 }}>この12枚で3 recognition方式を1run</button>
  </div></section>;
}
