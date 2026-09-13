/* eslint-disable @next/next/no-img-element, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import scoringGt from "../../../evaluation/parts/yellow-documents.corrected.v2.json";
import { orientedCanvas } from "../../ocr/diagnostic/stage-a20/a19-table-crops";
import { clearFormalSet, loadFormalSet, P5_FORMAL_SET_MANIFEST_VERSION, saveFormalSet } from "../../ocr/bakeoff/p5-formal-set-idb";

type RegisteredImage = {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  selectionOrder: number;
  imageWidth: number | null;
  imageHeight: number | null;
  fingerprint: string;
};

type Row = { rowId: string; fields: { name: string; qty: string; retail: string; cost: string }; sourceTokenCount?: number };
type Variant = {
  variantId: "C_SOFT_HEADER_BAND" | "D_PARTIAL_HEADER_COLUMN_LATTICE" | "E_ROW_PRESERVE_COLUMN_LATTICE";
  mappedHeaderFieldCount: number;
  rowClusterCount: number;
  columnAssignmentCount: number;
  reconstructedRowCount: number;
  nonBlankNameCount: number;
  nonBlankQtyCount: number;
  nonBlankRetailCount: number;
  nonBlankCostCount: number;
  wrongAutoConfirm: number;
  manualReviewRequired: boolean;
  processingTimeMs: number;
  rows: Row[];
  score?: Score;
};

type Score = {
  correctRowCount: number;
  falseRowCount: number;
  correctNameCount: number;
  correctQtyCount: number;
  correctRetailCount: number;
  correctCostCount: number;
};

type CandidateResult = {
  id: string;
  diagnosticPsm: "3" | "6";
  pageOcrTokenCount: number;
  variants: Variant[];
  error: string | null;
};

type PersistenceState = "checking" | "ready" | "missing" | "error";

const RESULT_SCHEMA = "icb.parts-ocr.p5-management-short.v1";
const RESULT_REVISION = "p5-c-d-e-row-preserve-scoring-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
const FORMAL_IMAGE_IDS = Array.from({ length: 12 }, (_, index) => `IMG_${String(675 + index).padStart(4, "0")}`);
const AUTO_TARGETS = [
  { id: "IMG_0675", psm: "3" as const },
  { id: "IMG_0678", psm: "6" as const },
  { id: "IMG_0684", psm: "3" as const },
];
const FIELDS = ["name", "qty", "retail", "cost"] as const;
const GT_FIELD = { name: "partName", qty: "qty", retail: "retail", cost: "cost" } as const;

function canonicalId(name: string) {
  const match = name.match(/IMG[_-]?(\d{4})/i);
  return match?.[1] ? `IMG_${match[1]}` : "UNMATCHED";
}

function loadImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });
}

async function safeFingerprint(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 10).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard copy failed");
}

function validateFormalRegistry(items: RegisteredImage[]) {
  const ids = items.map((item) => item.id);
  return items.length === 12 && FORMAL_IMAGE_IDS.every((id) => ids.includes(id)) && new Set(ids).size === 12;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/jpeg", .96));
}

function parseTsv(tsv: string) {
  const lines = String(tsv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const index = Object.fromEntries(header.map((value, i) => [value, i]));
  if (["level", "left", "top", "width", "height", "conf", "text"].some((key) => index[key] === undefined)) return [];
  return lines.slice(1).flatMap((line) => {
    const cells = line.split("\t");
    if (Number(cells[index.level]) !== 5) return [];
    const text = String(cells[index.text] ?? "").trim();
    const left = Number(cells[index.left]); const top = Number(cells[index.top]); const width = Number(cells[index.width]); const height = Number(cells[index.height]);
    if (!text || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
    const confidenceRaw = Number(cells[index.conf]);
    return [{ text, x1: left, y1: top, x2: left + width, y2: top + height, confidence: Number.isFinite(confidenceRaw) ? confidenceRaw / 100 : null }];
  });
}

function parseBlocks(blocks: any) {
  if (!Array.isArray(blocks)) return [];
  const out: any[] = [];
  for (const block of blocks) for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) for (const word of Array.isArray(line?.words) ? line.words : []) {
    const text = String(word?.text ?? "").trim();
    const bbox = word?.bbox;
    const x1 = Number(bbox?.x0); const y1 = Number(bbox?.y0); const x2 = Number(bbox?.x1); const y2 = Number(bbox?.y1);
    if (!text || ![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
    const confidenceRaw = Number(word?.confidence);
    out.push({ text, x1, y1, x2, y2, confidence: Number.isFinite(confidenceRaw) ? confidenceRaw / 100 : null });
  }
  return out;
}

function addRowPreserveHybrid(baseVariants: any[]): any[] {
  const c = baseVariants.find((variant) => variant.variantId === "C_SOFT_HEADER_BAND");
  const d = baseVariants.find((variant) => variant.variantId === "D_PARTIAL_HEADER_COLUMN_LATTICE");
  if (!c || !d) return baseVariants;
  const dRows = new Map((d.rows ?? []).map((row: Row) => [row.rowId, row]));
  const rows = (c.rows ?? []).map((cRow: Row) => {
    const dRow = dRows.get(cRow.rowId) as Row | undefined;
    const fields = Object.fromEntries(FIELDS.map((field) => [field, dRow?.fields?.[field] || cRow.fields?.[field] || ""])) as Row["fields"];
    return { rowId: cRow.rowId, fields, sourceTokenCount: cRow.sourceTokenCount };
  });
  const count = (field: typeof FIELDS[number]) => rows.filter((row: Row) => Boolean(row.fields[field])).length;
  const e = {
    variantId: "E_ROW_PRESERVE_COLUMN_LATTICE",
    mappedHeaderFieldCount: Math.max(c.mappedHeaderFieldCount ?? 0, d.mappedHeaderFieldCount ?? 0),
    rowClusterCount: c.rowClusterCount ?? 0,
    columnAssignmentCount: Math.max(c.columnAssignmentCount ?? 0, d.columnAssignmentCount ?? 0),
    reconstructedRowCount: rows.length,
    nonBlankNameCount: count("name"),
    nonBlankQtyCount: count("qty"),
    nonBlankRetailCount: count("retail"),
    nonBlankCostCount: count("cost"),
    wrongAutoConfirm: 0,
    manualReviewRequired: true,
    rows,
  };
  return [c, d, e];
}

function normName(value: unknown) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function normNumber(value: unknown) { return String(value ?? "").normalize("NFKC").replace(/[￥¥,\s]/g, "").trim(); }
function normField(field: typeof FIELDS[number], value: unknown) { return field === "name" ? normName(value) : normNumber(value); }

function expectedRowsFor(imageId: string): any[] {
  const order = (scoringGt.captureDocumentOrder as Record<string, string[]>)[imageId] ?? [];
  const documents = scoringGt.documents as Record<string, any[]>;
  return order.flatMap((documentId) => documents[documentId] ?? []);
}

function rowMatchWeight(gt: any, row: Row) {
  const weights = { name: 4, qty: 1, retail: 3, cost: 3 } as const;
  let score = 0;
  for (const field of FIELDS) {
    const predicted = normField(field, row?.fields?.[field] ?? "");
    const wanted = normField(field, gt?.[GT_FIELD[field]] ?? "");
    if (predicted && wanted && predicted === wanted) score += weights[field];
  }
  return score;
}

function alignRows(expected: any[], actual: Row[]) {
  type Alignment = { score: number; pairs: Array<[number, number]> };
  const better = (a: Alignment, b: Alignment) => a.score !== b.score ? (a.score > b.score ? a : b) : (a.pairs.length >= b.pairs.length ? a : b);
  const dp: Alignment[][] = Array.from({ length: expected.length + 1 }, () => Array(actual.length + 1));
  dp[0][0] = { score: 0, pairs: [] };
  for (let i = 0; i <= expected.length; i += 1) for (let j = 0; j <= actual.length; j += 1) {
    if (i === 0 && j === 0) continue;
    let best: Alignment | null = null;
    if (i > 0 && dp[i - 1][j]) best = dp[i - 1][j];
    if (j > 0 && dp[i][j - 1]) best = best ? better(best, dp[i][j - 1]) : dp[i][j - 1];
    if (i > 0 && j > 0 && dp[i - 1][j - 1]) {
      const weight = rowMatchWeight(expected[i - 1], actual[j - 1]);
      if (weight >= 4) {
        const candidate = { score: dp[i - 1][j - 1].score + weight, pairs: [...dp[i - 1][j - 1].pairs, [i - 1, j - 1] as [number, number]] };
        best = best ? better(best, candidate) : candidate;
      }
    }
    dp[i][j] = best ?? { score: 0, pairs: [] };
  }
  return dp[expected.length][actual.length].pairs;
}

function scoreVariantAfterPrediction(imageId: string, rows: Row[]): Score {
  const expected = expectedRowsFor(imageId);
  const pairs = alignRows(expected, rows);
  const score: Score = { correctRowCount: pairs.length, falseRowCount: rows.length - pairs.length, correctNameCount: 0, correctQtyCount: 0, correctRetailCount: 0, correctCostCount: 0 };
  for (const [expectedIndex, actualIndex] of pairs) {
    const gt = expected[expectedIndex]; const row = rows[actualIndex];
    for (const field of FIELDS) if (normField(field, row.fields[field]) === normField(field, gt[GT_FIELD[field]])) {
      if (field === "name") score.correctNameCount += 1;
      if (field === "qty") score.correctQtyCount += 1;
      if (field === "retail") score.correctRetailCount += 1;
      if (field === "cost") score.correctCostCount += 1;
    }
  }
  return score;
}

async function runComparison(file: File, requestedPsm: "3" | "6", imageId: string) {
  const source = await orientedCanvas(file, 2200);
  const blob = await canvasBlob(source.canvas);
  const tess: any = await import("tesseract.js");
  const semantic: any = await import("../../ocr/bakeoff/p5-semantic-candidates.mjs");
  const psm = requestedPsm === "6" ? (tess.PSM?.SINGLE_BLOCK ?? "6") : (tess.PSM?.AUTO ?? "3");
  const worker = await tess.createWorker("jpn+eng", 1);
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "", tessedit_pageseg_mode: psm });
    const started = performance.now();
    const recognized = await worker.recognize(blob, {}, { text: true, blocks: true, layoutBlocks: false, hocr: false, tsv: true, box: false, unlv: false, osd: false, pdf: false, imageColor: false, imageGrey: false, imageBinary: false, debug: false });
    const recognizeElapsedMs = Math.round(performance.now() - started);
    const data = recognized?.data ?? {};
    const tsvTokens = parseTsv(typeof data.tsv === "string" ? data.tsv : "");
    const blockTokens = parseBlocks(data.blocks);
    const tokens = tsvTokens.length ? tsvTokens : blockTokens;
    const mappingStarted = performance.now();
    const rawVariants = semantic.compareSemanticMappingCandidates(tokens);
    const selected = addRowPreserveHybrid(rawVariants);
    const processingTimeMs = recognizeElapsedMs + Math.round(performance.now() - mappingStarted);
    const variants: Variant[] = selected.map((variant: any) => ({
      variantId: variant.variantId,
      mappedHeaderFieldCount: Number(variant.mappedHeaderFieldCount ?? 0),
      rowClusterCount: Number(variant.rowClusterCount ?? 0),
      columnAssignmentCount: Number(variant.columnAssignmentCount ?? 0),
      reconstructedRowCount: Number(variant.reconstructedRowCount ?? 0),
      nonBlankNameCount: Number(variant.nonBlankNameCount ?? 0),
      nonBlankQtyCount: Number(variant.nonBlankQtyCount ?? 0),
      nonBlankRetailCount: Number(variant.nonBlankRetailCount ?? 0),
      nonBlankCostCount: Number(variant.nonBlankCostCount ?? 0),
      wrongAutoConfirm: Number(variant.wrongAutoConfirm ?? 0),
      manualReviewRequired: true,
      processingTimeMs,
      rows: variant.rows ?? [],
    }));
    // GT is consulted only here, after every prediction row and field has already been generated.
    for (const variant of variants) variant.score = scoreVariantAfterPrediction(imageId, variant.rows);
    return { pageOcrTokenCount: tokens.length, variants };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: tess.PSM?.AUTO ?? "3" }).catch(() => undefined);
    await worker.terminate().catch(() => undefined);
  }
}

function buildManagementShort(results: CandidateResult[], registryReady: boolean, registrySize: number) {
  return {
    schema: RESULT_SCHEMA,
    revision: RESULT_REVISION,
    evaluationHead: EVALUATION_HEAD,
    registryReady,
    registrySize,
    scoringOnlyGt: true,
    gtRuntimeUsedForGeneration: false,
    targets: results.flatMap((item) => item.variants.map((variant) => ({
      imageId: item.id,
      psm: item.diagnosticPsm,
      variant: variant.variantId,
      mappedHeaderFieldCount: variant.mappedHeaderFieldCount,
      reconstructedRowCount: variant.reconstructedRowCount,
      nonBlankNameCount: variant.nonBlankNameCount,
      nonBlankQtyCount: variant.nonBlankQtyCount,
      nonBlankRetailCount: variant.nonBlankRetailCount,
      nonBlankCostCount: variant.nonBlankCostCount,
      wrongAutoConfirm: variant.wrongAutoConfirm,
      correctRowCount: variant.score?.correctRowCount ?? 0,
      falseRowCount: variant.score?.falseRowCount ?? 0,
      correctNameCount: variant.score?.correctNameCount ?? 0,
      correctQtyCount: variant.score?.correctQtyCount ?? 0,
      correctRetailCount: variant.score?.correctRetailCount ?? 0,
      correctCostCount: variant.score?.correctCostCount ?? 0,
      processingTimeMs: variant.processingTimeMs,
    }))),
  };
}

export default function P5TokenGridRealPhotoPocPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const registryRef = useRef<Map<string, RegisteredImage>>(new Map());
  const [registered, setRegistered] = useState<RegisteredImage[]>([]);
  const [results, setResults] = useState<CandidateResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("端末内の正式セットを確認中です…");
  const [copyStatus, setCopyStatus] = useState("");
  const [persistenceState, setPersistenceState] = useState<PersistenceState>("checking");

  const registeredIds = useMemo(() => new Set(registered.map((item) => item.id)), [registered]);
  const missingIds = FORMAL_IMAGE_IDS.filter((id) => !registeredIds.has(id));
  const duplicateIds = registered.map((item) => item.id).filter((id, index, all) => id !== "UNMATCHED" && all.indexOf(id) !== index);
  const unmatchedCount = registered.filter((item) => item.id === "UNMATCHED").length;
  const formalReady = registered.length === 12 && missingIds.length === 0 && duplicateIds.length === 0 && unmatchedCount === 0;

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!("indexedDB" in window)) { setPersistenceState("error"); setStatus("このブラウザでは端末内保存を利用できません。正式12枚を再登録してください。"); return; }
      try {
        const stored = await loadFormalSet();
        if (!stored.length) { if (!cancelled) { setPersistenceState("missing"); setStatus("端末内に正式セットがありません。初回のみ正式12枚を登録してください。"); } return; }
        if (stored.length !== 12 || stored.some((item) => item.manifestVersion !== P5_FORMAL_SET_MANIFEST_VERSION)) throw new Error("manifest mismatch");
        const restored: RegisteredImage[] = [];
        for (const item of stored) {
          if (!FORMAL_IMAGE_IDS.includes(item.imageId) || canonicalId(item.filename) !== item.imageId) throw new Error("manifest image mismatch");
          const file = new File([item.blob], item.filename, { type: item.mimeType || item.blob.type || "image/jpeg" });
          const fingerprint = await safeFingerprint(file);
          if (fingerprint !== item.safeImageFingerprint) throw new Error("fingerprint mismatch");
          restored.push({ id: item.imageId, file, name: item.filename, previewUrl: URL.createObjectURL(file), selectionOrder: item.selectionOrder, imageWidth: item.width, imageHeight: item.height, fingerprint });
        }
        if (!validateFormalRegistry(restored)) throw new Error("formal set incomplete");
        if (cancelled) return;
        registryRef.current.clear(); for (const item of restored) registryRef.current.set(item.id, item);
        setRegistered(restored.sort((a, b) => a.selectionOrder - b.selectionOrder)); setPersistenceState("ready"); setStatus("正式セット READY 12/12。端末内保存から自動復元しました。再選択なしで比較できます。");
      } catch {
        await clearFormalSet().catch(() => undefined);
        if (!cancelled) { registryRef.current.clear(); setRegistered([]); setPersistenceState("missing"); setStatus("端末内の正式セットが不整合です。正式12枚を再登録してください。"); }
      }
    }
    void restore(); return () => { cancelled = true; };
  }, []);

  async function registerFormalSet(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = Array.from(files).slice(0, 12); setBusy(true); setCopyStatus(""); setResults([]); registryRef.current.clear();
    try {
      const base = selected.map((file, index) => ({ file, id: canonicalId(file.name), name: file.name, previewUrl: URL.createObjectURL(file), selectionOrder: index + 1 }));
      const [sizes, fingerprints] = await Promise.all([Promise.all(base.map((item) => loadImageSize(item.previewUrl))), Promise.all(base.map((item) => safeFingerprint(item.file)))]);
      const next: RegisteredImage[] = base.map((item, index) => ({ ...item, imageWidth: sizes[index].width || null, imageHeight: sizes[index].height || null, fingerprint: fingerprints[index] }));
      if (!validateFormalRegistry(next)) { setRegistered(next); setPersistenceState("missing"); setStatus("正式セット不整合です。IMG_0675〜IMG_0686の正式12枚をまとめて再登録してください。"); return; }
      await saveFormalSet(next.map((item) => ({ manifestVersion: P5_FORMAL_SET_MANIFEST_VERSION, imageId: item.id, safeImageFingerprint: item.fingerprint, filename: item.name, width: item.imageWidth, height: item.imageHeight, mimeType: item.file.type || "image/jpeg", blob: item.file, selectionOrder: item.selectionOrder })));
      for (const item of next) registryRef.current.set(item.id, item); setRegistered(next); setPersistenceState("ready"); setStatus("正式セット READY 12/12。端末内IndexedDBへ保存済みです。");
    } catch { registryRef.current.clear(); setPersistenceState("error"); setStatus("端末内保存に失敗しました。正式12枚を再登録してください。"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function runAutoDiagnostic() {
    if (busy) return;
    if (!formalReady || registryRef.current.size !== 12) { setStatus("正式12枚が端末内にありません。正式12枚を再登録してください。"); return; }
    const targets = AUTO_TARGETS.map((spec) => ({ spec, item: registryRef.current.get(spec.id) }));
    if (targets.some(({ item }) => !item)) { setStatus("比較対象を端末内registryから解決できません。正式12枚を再登録してください。"); return; }
    setBusy(true); setCopyStatus(""); setResults([]); setStatus("3ケースを自動選択し、C / D / Eを比較＋scoring-only採点中です。file pickerは開きません。");
    const collected: CandidateResult[] = [];
    try {
      for (const { spec, item } of targets as Array<{ spec: typeof AUTO_TARGETS[number]; item: RegisteredImage }>) {
        try {
          const comparison = await runComparison(item.file, spec.psm, item.id);
          collected.push({ id: item.id, diagnosticPsm: spec.psm, pageOcrTokenCount: comparison.pageOcrTokenCount, variants: comparison.variants, error: null });
        } catch (error) { collected.push({ id: item.id, diagnosticPsm: spec.psm, pageOcrTokenCount: 0, variants: [], error: error instanceof Error ? error.message : String(error) }); }
        setResults([...collected]);
      }
      setStatus("Candidate E比較＋scoring-only採点完了。『総合管理用結果をコピー』でshort JSONを提出できます。");
    } finally { setBusy(false); }
  }

  async function copyManagementShort() {
    if (!results.length) return;
    try { await copyText(JSON.stringify(buildManagementShort(results, formalReady, registryRef.current.size), null, 2)); setCopyStatus("コピーしました"); }
    catch { setCopyStatus("コピーできませんでした"); }
  }

  return <main style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 12px 60px", color: "#172033", background: "#f7f9fc" }}>
    <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
      <h1 style={{ marginTop: 0 }}>P5 Candidate E Row-Preserve Column Lattice比較</h1>
      <p><b>Cのrow coverageとDのcolumn assignmentを分離統合し、C / D / Eを同一OCR tokenで比較します。</b></p>
      <p>GTは全prediction生成後のscoring-onlyに限定し、row生成・column推定・field assignment・threshold・stopには使用しません。</p>
    </section>
    <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
      <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void registerFormalSet(event.target.files)} />
      <div style={{ fontWeight: 900, color: formalReady ? "#176b34" : "#8a5a00" }}>正式セット：{persistenceState === "checking" ? "確認中" : formalReady ? "READY 12/12" : `登録 ${registered.length}/12`}</div>
      <div style={{ marginTop: 4, fontWeight: 800, color: persistenceState === "ready" ? "#176b34" : "#667085" }}>保存：{persistenceState === "ready" ? "端末内保存済み" : persistenceState === "checking" ? "確認中" : "未保存"}</div>
      <div role="status" aria-live="polite" style={{ marginTop: 8 }}>{status}</div>
      {persistenceState !== "checking" && !formalReady ? <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, marginTop: 12, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>正式12枚を登録</button> : null}
      {formalReady ? <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, marginTop: 10, background: "white", color: "#334155", fontWeight: 800 }}>正式セットを再登録</button> : null}
      <button disabled={!formalReady || busy} onClick={() => void runAutoDiagnostic()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, marginTop: 12, background: !formalReady || busy ? "#94a3b8" : "#176b34", color: "white", fontWeight: 900 }}>{busy ? "候補比較中…" : "自動診断開始"}</button>
    </section>
    {results.length > 0 ? <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>C / D / E 比較結果</h2>
      <button onClick={() => void copyManagementShort()} disabled={busy} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: "#176b34", color: "white", fontWeight: 900 }}>総合管理用結果をコピー</button>
      {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus === "コピーしました" ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
      {results.map((item) => <div key={item.id} style={{ marginTop: 14, borderTop: "1px solid #dbe2ec", paddingTop: 10 }}>
        <div style={{ fontWeight: 900 }}>{item.id} / PSM {item.diagnosticPsm} / tokens {item.pageOcrTokenCount}</div>
        {item.error ? <div style={{ color: "#a11" }}>ERROR: {item.error}</div> : null}
        {item.variants.map((variant) => <div key={variant.variantId} style={{ fontSize: 13, marginTop: 7 }}>
          <b>{variant.variantId}</b>: rows {variant.reconstructedRowCount} / name {variant.nonBlankNameCount} / qty {variant.nonBlankQtyCount} / retail {variant.nonBlankRetailCount} / cost {variant.nonBlankCostCount}<br />
          score: row {variant.score?.correctRowCount ?? 0} / false {variant.score?.falseRowCount ?? 0} / name {variant.score?.correctNameCount ?? 0} / qty {variant.score?.correctQtyCount ?? 0} / retail {variant.score?.correctRetailCount ?? 0} / cost {variant.score?.correctCostCount ?? 0}
        </div>)}
      </div>)}
    </section> : null}
  </main>;
}
