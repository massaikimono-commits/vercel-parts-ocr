/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import scoringGt from "../../../evaluation/parts/yellow-documents.corrected.v2.json";
import { orientedCanvas } from "../../ocr/diagnostic/stage-a20/a19-table-crops";
import { clearFormalSet, loadFormalSet, P5_FORMAL_SET_MANIFEST_VERSION, saveFormalSet } from "../../ocr/bakeoff/p5-formal-set-idb";

type RegisteredImage = { id: string; file: File; name: string; previewUrl: string; selectionOrder: number; imageWidth: number | null; imageHeight: number | null; fingerprint: string };
type Row = { rowId: string; fields: { name: string; qty: string; retail: string; cost: string }; sourceTokenCount?: number };
type Variant = { variantId: string; mappedHeaderFieldCount: number; rowClusterCount: number; columnAssignmentCount: number; reconstructedRowCount: number; nonBlankNameCount: number; nonBlankQtyCount: number; nonBlankRetailCount: number; nonBlankCostCount: number; wrongAutoConfirm: number; manualReviewRequired: boolean; processingTimeMs: number; rows: Row[] };
type CandidateResult = { id: string; diagnosticPsm: "3" | "6"; pageOcrTokenCount: number; variants: Variant[]; error: string | null };
type PersistenceState = "checking" | "ready" | "missing" | "error";
type Field = "name" | "qty" | "retail" | "cost";
type FieldMask = Record<Field, boolean>;

type TargetedRowAudit = { predRowIndex: number; matchedGtRowIndex: number | null; rowMatchScore: number; fieldMatchMask: FieldMask };
type TargetedAudit = { scorerValid: boolean; matchedRows: number; fieldCorrectCounts: Record<Field, number>; rows: TargetedRowAudit[] };

const RESULT_SCHEMA = "icb.parts-ocr.p5-scoring-integrity-short.v1";
const RESULT_REVISION = "p5-scoring-integrity-audit-0678-d-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
const FORMAL_IMAGE_IDS = Array.from({ length: 12 }, (_, index) => `IMG_${String(675 + index).padStart(4, "0")}`);
const FIELDS: Field[] = ["name", "qty", "retail", "cost"];
const GT_FIELD = { name: "partName", qty: "qty", retail: "retail", cost: "cost" } as const;
const WEIGHTS: Record<Field, number> = { name: 4, qty: 1, retail: 3, cost: 3 };

function canonicalId(name: string) { const match = name.match(/IMG[_-]?(\d{4})/i); return match?.[1] ? `IMG_${match[1]}` : "UNMATCHED"; }
function loadImageSize(url: string) { return new Promise<{ width: number; height: number }>((resolve) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => resolve({ width: 0, height: 0 }); image.src = url; }); }
async function safeFingerprint(file: File) { const bytes = await file.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).slice(0, 10).map((value) => value.toString(16).padStart(2, "0")).join(""); }
async function copyText(text: string) { if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text); const textarea = document.createElement("textarea"); textarea.value = text; textarea.style.position = "fixed"; textarea.style.opacity = "0"; document.body.appendChild(textarea); textarea.select(); const ok = document.execCommand("copy"); document.body.removeChild(textarea); if (!ok) throw new Error("clipboard copy failed"); }
function validateFormalRegistry(items: RegisteredImage[]) { const ids = items.map((item) => item.id); return items.length === 12 && FORMAL_IMAGE_IDS.every((id) => ids.includes(id)) && new Set(ids).size === 12; }
function canvasBlob(canvas: HTMLCanvasElement) { return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/jpeg", .96)); }

function normName(value: unknown) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function normNumber(value: unknown) {
  let source = String(value ?? "").normalize("NFKC").trim().replace(/[￥¥円,，\s]/g, "");
  if (!source) return "";
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(source)) return source;
  const sign = source.startsWith("-") ? "-" : "";
  source = source.replace(/^[+-]/, "");
  let [integer, fraction = ""] = source.split(".");
  integer = integer.replace(/^0+(?=\d)/, "") || "0";
  fraction = fraction.replace(/0+$/, "");
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}
function normField(field: Field, value: unknown) { return field === "name" ? normName(value) : normNumber(value); }

function expectedRowsFor(imageId: string): any[] { const order = (scoringGt.captureDocumentOrder as Record<string, string[]>)[imageId] ?? []; const documents = scoringGt.documents as Record<string, any[]>; return order.flatMap((documentId) => documents[documentId] ?? []); }
function fieldMask(gt: any, row: Row): FieldMask { return Object.fromEntries(FIELDS.map((field) => [field, Boolean(normField(field, row?.fields?.[field])) && normField(field, row?.fields?.[field]) === normField(field, gt?.[GT_FIELD[field]] ?? "")])) as FieldMask; }
function rowMatchWeight(gt: any, row: Row) { const mask = fieldMask(gt, row); return FIELDS.reduce((sum, field) => sum + (mask[field] ? WEIGHTS[field] : 0), 0); }

function alignRows(expected: any[], actual: Row[]) {
  type Alignment = { score: number; pairs: Array<[number, number]> };
  const better = (a: Alignment, b: Alignment) => {
    if (a.score !== b.score) return a.score > b.score ? a : b;
    if (a.pairs.length !== b.pairs.length) return a.pairs.length > b.pairs.length ? a : b;
    const key = (value: Alignment) => value.pairs.map(([i, j]) => `${String(i).padStart(3, "0")}:${String(j).padStart(3, "0")}`).join("|");
    return key(a) <= key(b) ? a : b;
  };
  const dp: Alignment[][] = Array.from({ length: expected.length + 1 }, () => Array(actual.length + 1)); dp[0][0] = { score: 0, pairs: [] };
  for (let i = 0; i <= expected.length; i += 1) for (let j = 0; j <= actual.length; j += 1) {
    if (i === 0 && j === 0) continue;
    let best: Alignment | null = null;
    if (i > 0 && dp[i - 1][j]) best = dp[i - 1][j];
    if (j > 0 && dp[i][j - 1]) best = best ? better(best, dp[i][j - 1]) : dp[i][j - 1];
    if (i > 0 && j > 0 && dp[i - 1][j - 1]) {
      const weight = rowMatchWeight(expected[i - 1], actual[j - 1]);
      if (weight >= 4) { const candidate = { score: dp[i - 1][j - 1].score + weight, pairs: [...dp[i - 1][j - 1].pairs, [i - 1, j - 1] as [number, number]] }; best = best ? better(best, candidate) : candidate; }
    }
    dp[i][j] = best ?? { score: 0, pairs: [] };
  }
  return dp[expected.length][actual.length].pairs;
}

function syntheticScorerAudit() {
  const gt = (partName: string, qty: string, retail: string, cost: string) => ({ partName, qty, retail, cost });
  const row = (name: string, qty: string, retail: string, cost: string): Row => ({ rowId: "S", fields: { name, qty, retail, cost } });
  const expected = [gt("部品A", "1", "1210", "1029"), gt("部品B", "2", "2700", "1740"), gt("部品C", "4", "850", "105")];
  const exact = alignRows(expected, expected.map((item, index) => ({ rowId: `R${index}`, fields: { name: item.partName, qty: item.qty, retail: item.retail, cost: item.cost } })));
  const reordered = alignRows(expected, [row("部品B", "2", "2700", "1740"), row("部品A", "1", "1210", "1029"), row("部品C", "4", "850", "105")]);
  const normalized = rowMatchWeight(expected[0], row(" 部品Ａ ", " １ ", "￥1,210.00", "1，029円"));
  const blankDoesNotMatch = rowMatchWeight(expected[0], row("", "", "", "")) === 0;
  const exactPass = exact.length === 3 && exact.every(([i, j]) => i === j);
  const rowOrderPass = reordered.length === 2 && reordered.every(([i, j], index, pairs) => index === 0 || (i > pairs[index - 1][0] && j > pairs[index - 1][1]));
  const normalizationPass = normalized === 11 && blankDoesNotMatch && normNumber(" 001.00 ") === "1" && normNumber("￥1,210.50") === "1210.5";
  return { scorerSyntheticExactMatch: exactPass ? "PASS" : "FAIL", rowOrderMatching: rowOrderPass ? "PASS" : "FAIL", normalization: normalizationPass ? "PASS" : "FAIL" } as const;
}
const SCORER_AUDIT = syntheticScorerAudit();
if (SCORER_AUDIT.scorerSyntheticExactMatch !== "PASS" || SCORER_AUDIT.rowOrderMatching !== "PASS" || SCORER_AUDIT.normalization !== "PASS") throw new Error("P5 scoring integrity synthetic audit failed");

function targeted0678DAudit(rows: Row[]): TargetedAudit {
  const expected = expectedRowsFor("IMG_0678");
  const pairs = alignRows(expected, rows);
  const gtByPred = new Map<number, number>(pairs.map(([gtIndex, predIndex]) => [predIndex, gtIndex]));
  const counts: Record<Field, number> = { name: 0, qty: 0, retail: 0, cost: 0 };
  const detail = rows.map((row, predIndex) => {
    const matchedGtRowIndex = gtByPred.get(predIndex) ?? null;
    let referenceIndex = matchedGtRowIndex;
    if (referenceIndex === null && expected.length) {
      let bestScore = -1;
      expected.forEach((gt, index) => { const score = rowMatchWeight(gt, row); if (score > bestScore) { bestScore = score; referenceIndex = index; } });
    }
    const mask = referenceIndex === null ? { name: false, qty: false, retail: false, cost: false } : fieldMask(expected[referenceIndex], row);
    if (matchedGtRowIndex !== null) for (const field of FIELDS) if (mask[field]) counts[field] += 1;
    return { predRowIndex, matchedGtRowIndex, rowMatchScore: referenceIndex === null ? 0 : rowMatchWeight(expected[referenceIndex], row), fieldMatchMask: mask };
  });
  return { scorerValid: true, matchedRows: pairs.length, fieldCorrectCounts: counts, rows: detail };
}

function parseTsv(tsv: string) { const lines = String(tsv || "").split(/\r?\n/).filter(Boolean); if (lines.length < 2) return []; const header = lines[0].split("\t"); const index = Object.fromEntries(header.map((value, i) => [value, i])); if (["level", "left", "top", "width", "height", "text"].some((key) => index[key] === undefined)) return []; return lines.slice(1).flatMap((line) => { const cells = line.split("\t"); if (Number(cells[index.level]) !== 5) return []; const text = String(cells[index.text] ?? "").trim(); const left = Number(cells[index.left]), top = Number(cells[index.top]), width = Number(cells[index.width]), height = Number(cells[index.height]); return !text || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ? [] : [{ text, x1: left, y1: top, x2: left + width, y2: top + height }]; }); }
function parseBlocks(blocks: any) { if (!Array.isArray(blocks)) return []; const out: any[] = []; for (const block of blocks) for (const paragraph of block?.paragraphs ?? []) for (const line of paragraph?.lines ?? []) for (const word of line?.words ?? []) { const text = String(word?.text ?? "").trim(); const b = word?.bbox; const x1 = Number(b?.x0), y1 = Number(b?.y0), x2 = Number(b?.x1), y2 = Number(b?.y1); if (text && [x1, y1, x2, y2].every(Number.isFinite) && x2 > x1 && y2 > y1) out.push({ text, x1, y1, x2, y2 }); } return out; }

async function run0678D(file: File) {
  const source = await orientedCanvas(file, 2200); const blob = await canvasBlob(source.canvas); const tess: any = await import("tesseract.js"); const semantic: any = await import("../../ocr/bakeoff/p5-semantic-candidates.mjs"); const worker = await tess.createWorker("jpn+eng", 1);
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "", tessedit_pageseg_mode: tess.PSM?.SINGLE_BLOCK ?? "6" });
    const recognized = await worker.recognize(blob, {}, { text: true, blocks: true, layoutBlocks: false, hocr: false, tsv: true, box: false, unlv: false, osd: false, pdf: false, imageColor: false, imageGrey: false, imageBinary: false, debug: false });
    const data = recognized?.data ?? {}; const tsv = parseTsv(typeof data.tsv === "string" ? data.tsv : ""); const blocks = parseBlocks(data.blocks); const tokens = tsv.length ? tsv : blocks;
    const variants = semantic.compareSemanticMappingCandidates(tokens); const d = variants.find((variant: any) => variant.variantId === "D_PARTIAL_HEADER_COLUMN_LATTICE"); if (!d) throw new Error("D variant unavailable");
    return { id: "IMG_0678", diagnosticPsm: "6" as const, pageOcrTokenCount: tokens.length, variants: [{ ...d, processingTimeMs: 0, manualReviewRequired: true, rows: d.rows ?? [] }] as Variant[], error: null };
  } finally { await worker.setParameters({ tessedit_pageseg_mode: tess.PSM?.AUTO ?? "3" }).catch(() => undefined); await worker.terminate().catch(() => undefined); }
}

function buildManagementShort(results: CandidateResult[], registryReady: boolean, registrySize: number) {
  const d = results.find((item) => item.id === "IMG_0678")?.variants.find((variant) => variant.variantId === "D_PARTIAL_HEADER_COLUMN_LATTICE");
  const targeted = d ? targeted0678DAudit(d.rows) : null;
  const decision = targeted ? (targeted.matchedRows > 0 ? "SCORER_VALID_REASSESS_D_ACCURACY" : "SCORER_VALID_D_ACCURACY_FAIL") : "TARGETED_RUN_REQUIRED";
  return { schema: RESULT_SCHEMA, revision: RESULT_REVISION, evaluationHead: EVALUATION_HEAD, registryReady, registrySize, ...SCORER_AUDIT, targeted0678D: targeted, decision, nextAction: targeted?.matchedRows ? "Re-score same prediction; OCR logic unchanged" : "Move to row/field semantic alignment architecture review; OCR tuning remains HOLD", productionChanged: false };
}

export default function Page() {
  const inputRef = useRef<HTMLInputElement>(null); const registryRef = useRef<Map<string, RegisteredImage>>(new Map()); const [registered, setRegistered] = useState<RegisteredImage[]>([]); const [results, setResults] = useState<CandidateResult[]>([]); const [busy, setBusy] = useState(false); const [status, setStatus] = useState("端末内の正式セットを確認中です…"); const [copyStatus, setCopyStatus] = useState(""); const [persistenceState, setPersistenceState] = useState<PersistenceState>("checking");
  const ids = useMemo(() => new Set(registered.map((item) => item.id)), [registered]); const formalReady = registered.length === 12 && FORMAL_IMAGE_IDS.every((id) => ids.has(id)) && ids.size === 12;
  useEffect(() => { let cancelled = false; (async () => { try { if (!("indexedDB" in window)) throw new Error("indexeddb unavailable"); const stored = await loadFormalSet(); if (stored.length !== 12 || stored.some((item) => item.manifestVersion !== P5_FORMAL_SET_MANIFEST_VERSION)) throw new Error("manifest mismatch"); const restored: RegisteredImage[] = []; for (const item of stored) { const file = new File([item.blob], item.filename, { type: item.mimeType || item.blob.type || "image/jpeg" }); const fingerprint = await safeFingerprint(file); if (fingerprint !== item.safeImageFingerprint || canonicalId(item.filename) !== item.imageId) throw new Error("fingerprint mismatch"); restored.push({ id: item.imageId, file, name: item.filename, previewUrl: URL.createObjectURL(file), selectionOrder: item.selectionOrder, imageWidth: item.width, imageHeight: item.height, fingerprint }); } if (!validateFormalRegistry(restored)) throw new Error("formal incomplete"); if (!cancelled) { registryRef.current.clear(); restored.forEach((item) => registryRef.current.set(item.id, item)); setRegistered(restored); setPersistenceState("ready"); setStatus("正式セット READY 12/12。端末内保存から自動復元しました。"); } } catch { await clearFormalSet().catch(() => undefined); if (!cancelled) { setPersistenceState("missing"); setStatus("正式12枚を登録してください。"); } } })(); return () => { cancelled = true; }; }, []);
  async function register(files: FileList | null) { if (!files?.length || busy) return; setBusy(true); try { const base = Array.from(files).slice(0, 12).map((file, index) => ({ file, id: canonicalId(file.name), name: file.name, previewUrl: URL.createObjectURL(file), selectionOrder: index + 1 })); const sizes = await Promise.all(base.map((item) => loadImageSize(item.previewUrl))); const fps = await Promise.all(base.map((item) => safeFingerprint(item.file))); const next: RegisteredImage[] = base.map((item, index) => ({ ...item, imageWidth: sizes[index].width || null, imageHeight: sizes[index].height || null, fingerprint: fps[index] })); if (!validateFormalRegistry(next)) throw new Error("invalid formal set"); await saveFormalSet(next.map((item) => ({ manifestVersion: P5_FORMAL_SET_MANIFEST_VERSION, imageId: item.id, safeImageFingerprint: item.fingerprint, filename: item.name, width: item.imageWidth, height: item.imageHeight, mimeType: item.file.type || "image/jpeg", blob: item.file, selectionOrder: item.selectionOrder }))); registryRef.current.clear(); next.forEach((item) => registryRef.current.set(item.id, item)); setRegistered(next); setPersistenceState("ready"); setStatus("正式セット READY 12/12。端末内保存済みです。"); } catch { setStatus("正式セット登録に失敗しました。"); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; } }
  async function runAudit() { if (busy || !formalReady) return; const item = registryRef.current.get("IMG_0678"); if (!item) { setStatus("IMG_0678をregistryから解決できません。"); return; } setBusy(true); setResults([]); setCopyStatus(""); setStatus("IMG_0678 / D predictionを再生成し、scoring-only integrityを監査中です。"); try { const result = await run0678D(item.file); setResults([result]); setStatus("Scoring Integrity監査完了。総合管理用結果をコピーできます。"); } catch (error) { setStatus(`監査失敗: ${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); } }
  async function copyShort() { try { await copyText(JSON.stringify(buildManagementShort(results, formalReady, registryRef.current.size), null, 2)); setCopyStatus("コピーしました"); } catch { setCopyStatus("コピー失敗"); } }
  const targeted = results[0]?.variants[0] ? targeted0678DAudit(results[0].variants[0].rows) : null;
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}><section style={{ background: "white", border: "1px solid #ddd", borderRadius: 14, padding: 16 }}><h1>P5 Scoring Integrity Audit</h1><p>OCR tuningなし。GTはprediction生成後のscoring-onlyだけに使用します。</p><p><b>Synthetic Exact:</b> {SCORER_AUDIT.scorerSyntheticExactMatch} / <b>Row Order:</b> {SCORER_AUDIT.rowOrderMatching} / <b>Normalization:</b> {SCORER_AUDIT.normalization}</p><input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(e) => void register(e.target.files)} /><p><b>正式セット：</b>{formalReady ? "READY 12/12" : persistenceState === "checking" ? "確認中" : `${registered.length}/12`}</p><p>{status}</p>{!formalReady && persistenceState !== "checking" ? <button disabled={busy} onClick={() => inputRef.current?.click()}>正式12枚を登録</button> : null}<button disabled={!formalReady || busy} onClick={() => void runAudit()} style={{ marginLeft: 8 }}>{busy ? "監査中…" : "0678-D Scoring監査"}</button>{targeted ? <div style={{ marginTop: 14 }}><p><b>0678-D matchedRows:</b> {targeted.matchedRows}</p><p>fieldCorrect name {targeted.fieldCorrectCounts.name} / qty {targeted.fieldCorrectCounts.qty} / retail {targeted.fieldCorrectCounts.retail} / cost {targeted.fieldCorrectCounts.cost}</p><button onClick={() => void copyShort()}>総合管理用結果をコピー</button>{copyStatus ? <span style={{ marginLeft: 8 }}>{copyStatus}</span> : null}</div> : null}</section></main>;
}
