/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runP5SemanticCandidateComparison, type P5SemanticCandidateSummary } from "../../ocr/bakeoff/p5-semantic-candidates-browser";
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

type CandidateResult = {
  id: string;
  diagnosticPsm: "3" | "6";
  pageOcrTokenCount: number;
  variants: P5SemanticCandidateSummary[];
  error: string | null;
};

type PersistenceState = "checking" | "ready" | "missing" | "error";

const RESULT_SCHEMA = "icb.parts-ocr.p5-management-short.v1";
const RESULT_REVISION = "p5-generalized-semantic-candidates-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
const FORMAL_IMAGE_IDS = Array.from({ length: 12 }, (_, index) => `IMG_${String(675 + index).padStart(4, "0")}`);
const AUTO_TARGETS = [
  { id: "IMG_0675", psm: "3" as const },
  { id: "IMG_0678", psm: "6" as const },
  { id: "IMG_0684", psm: "3" as const },
];

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

function buildManagementShort(results: CandidateResult[], registryReady: boolean, registrySize: number) {
  return {
    schema: RESULT_SCHEMA,
    revision: RESULT_REVISION,
    evaluationHead: EVALUATION_HEAD,
    registryReady,
    registrySize,
    targets: results.flatMap((item) => item.variants.map((variant) => ({
      imageId: item.id,
      psm: item.diagnosticPsm,
      variant: variant.variantId,
      mappedHeaderFieldCount: variant.mappedHeaderFieldCount,
      columnAssignmentCount: variant.columnAssignmentCount,
      reconstructedRowCount: variant.reconstructedRowCount,
      nonBlankNameCount: variant.nonBlankNameCount,
      nonBlankQtyCount: variant.nonBlankQtyCount,
      nonBlankRetailCount: variant.nonBlankRetailCount,
      nonBlankCostCount: variant.nonBlankCostCount,
      wrongAutoConfirm: variant.wrongAutoConfirm,
      manualReviewRequired: variant.manualReviewRequired,
      processingTimeMs: variant.processingTimeMs,
    })),
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
      if (!("indexedDB" in window)) {
        setPersistenceState("error");
        setStatus("このブラウザでは端末内保存を利用できません。正式12枚を再登録してください。");
        return;
      }
      try {
        const stored = await loadFormalSet();
        if (!stored.length) {
          if (!cancelled) {
            setPersistenceState("missing");
            setStatus("端末内に正式セットがありません。初回のみ正式12枚を登録してください。");
          }
          return;
        }
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
        registryRef.current.clear();
        for (const item of restored) registryRef.current.set(item.id, item);
        setRegistered(restored.sort((a, b) => a.selectionOrder - b.selectionOrder));
        setPersistenceState("ready");
        setStatus("正式セット READY 12/12。端末内保存から自動復元しました。再選択なしで比較できます。");
      } catch {
        await clearFormalSet().catch(() => undefined);
        if (!cancelled) {
          registryRef.current.clear();
          setRegistered([]);
          setPersistenceState("missing");
          setStatus("端末内の正式セットが不整合です。正式12枚を再登録してください。");
        }
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, []);

  async function registerFormalSet(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = Array.from(files).slice(0, 12);
    setBusy(true);
    setCopyStatus("");
    setResults([]);
    for (const item of registered) URL.revokeObjectURL(item.previewUrl);
    registryRef.current.clear();
    try {
      const base = selected.map((file, index) => ({ file, id: canonicalId(file.name), name: file.name, previewUrl: URL.createObjectURL(file), selectionOrder: index + 1 }));
      const [sizes, fingerprints] = await Promise.all([
        Promise.all(base.map((item) => loadImageSize(item.previewUrl))),
        Promise.all(base.map((item) => safeFingerprint(item.file))),
      ]);
      const next: RegisteredImage[] = base.map((item, index) => ({ ...item, imageWidth: sizes[index].width || null, imageHeight: sizes[index].height || null, fingerprint: fingerprints[index] }));
      if (!validateFormalRegistry(next)) {
        setRegistered(next);
        setPersistenceState("missing");
        setStatus("正式セット不整合です。IMG_0675〜IMG_0686の正式12枚をまとめて再登録してください。");
        return;
      }
      await saveFormalSet(next.map((item) => ({ manifestVersion: P5_FORMAL_SET_MANIFEST_VERSION, imageId: item.id, safeImageFingerprint: item.fingerprint, filename: item.name, width: item.imageWidth, height: item.imageHeight, mimeType: item.file.type || "image/jpeg", blob: item.file, selectionOrder: item.selectionOrder })));
      for (const item of next) registryRef.current.set(item.id, item);
      setRegistered(next);
      setPersistenceState("ready");
      setStatus("正式セット READY 12/12。端末内IndexedDBへ保存済みです。");
    } catch {
      registryRef.current.clear();
      setPersistenceState("error");
      setStatus("端末内保存に失敗しました。正式12枚を再登録してください。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function runAutoDiagnostic() {
    if (busy) return;
    if (!formalReady || registryRef.current.size !== 12) {
      setStatus("正式12枚が端末内にありません。正式12枚を再登録してください。");
      return;
    }
    const targets = AUTO_TARGETS.map((spec) => ({ spec, item: registryRef.current.get(spec.id) }));
    if (targets.some(({ item }) => !item)) {
      setStatus("比較対象を端末内registryから解決できません。正式12枚を再登録してください。");
      return;
    }
    setBusy(true);
    setCopyStatus("");
    setResults([]);
    setStatus("3ケースを自動選択し、CURRENT / A / B / Cを比較中です。file pickerは開きません。");
    const collected: CandidateResult[] = [];
    try {
      for (const { spec, item } of targets as Array<{ spec: typeof AUTO_TARGETS[number]; item: RegisteredImage }>) {
        try {
          const comparison = await runP5SemanticCandidateComparison(item.file, spec.psm);
          collected.push({ id: item.id, diagnosticPsm: spec.psm, pageOcrTokenCount: Number(comparison.pageOcrTokenCount ?? 0), variants: comparison.variants, error: null });
        } catch (error) {
          collected.push({ id: item.id, diagnosticPsm: spec.psm, pageOcrTokenCount: 0, variants: [], error: error instanceof Error ? error.message : String(error) });
        }
        setResults([...collected]);
      }
      setStatus("Generalized Candidate比較完了。『総合管理用結果をコピー』でshort JSONを提出できます。");
    } finally {
      setBusy(false);
    }
  }

  async function copyManagementShort() {
    if (!results.length) return;
    try {
      await copyText(JSON.stringify(buildManagementShort(results, formalReady, registryRef.current.size), null, 2));
      setCopyStatus("コピーしました");
    } catch {
      setCopyStatus("コピーできませんでした");
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 12px 60px", color: "#172033", background: "#f7f9fc" }}>
      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>P5 Generalized Semantic Candidate比較</h1>
        <p><b>CURRENT / A Split-Token / B Generalized Fuzzy / C Soft Header-Bandを同一OCR tokenで比較します。</b></p>
        <p>画像別alias・固定px・GT runtime・PSM runtime変更はありません。</p>
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
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Candidate比較結果</h2>
        <button onClick={() => void copyManagementShort()} disabled={busy} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: "#176b34", color: "white", fontWeight: 900 }}>総合管理用結果をコピー</button>
        {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus === "コピーしました" ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
        {results.map((item) => <div key={item.id} style={{ marginTop: 14, borderTop: "1px solid #dbe2ec", paddingTop: 10 }}>
          <div style={{ fontWeight: 900 }}>{item.id} / PSM {item.diagnosticPsm} / tokens {item.pageOcrTokenCount}</div>
          {item.error ? <div style={{ color: "#a11" }}>ERROR: {item.error}</div> : null}
          {item.variants.map((variant) => <div key={variant.variantId} style={{ fontSize: 13, marginTop: 6 }}>{variant.variantId}: headers {variant.mappedHeaderFieldCount}/4 / rows {variant.reconstructedRowCount} / name {variant.nonBlankNameCount} / qty {variant.nonBlankQtyCount} / retail {variant.nonBlankRetailCount} / cost {variant.nonBlankCostCount}</div>)}
        </div>)}
      </section> : null}
    </main>
  );
}
