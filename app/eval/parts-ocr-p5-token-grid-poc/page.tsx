/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useRef, useState } from "react";
import { runP5SemanticHeaderDiagnostic } from "../../ocr/bakeoff/p5-psm-primary-browser";

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

type SemanticResult = {
  id: string;
  diagnosticPsm: "3" | "6";
  fingerprint: string;
  imageWidth: number | null;
  imageHeight: number | null;
  diagnostic: any;
  error: string | null;
};

type RootCauseClass =
  | "A_TOKEN_FRAGMENTATION"
  | "B_LEXICON_FUZZY"
  | "C_HEADER_BAND_GEOMETRY"
  | "D_COLUMN_ASSOCIATION"
  | "E_OCR_TEXT_QUALITY"
  | "F_COMPOSITE"
  | "NOT_EVALUABLE";

const RESULT_SCHEMA = "icb.parts-ocr.p5-management-short.v1";
const RESULT_REVISION = "p5-management-short-semantic-root-cause-v1";
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

function classifyRootCause(item: SemanticResult): { rootCauseClass: RootCauseClass; rootCauseEvidence: string[] } {
  if (item.error || !item.diagnostic?.variant) {
    return { rootCauseClass: "NOT_EVALUABLE", rootCauseEvidence: ["diagnostic unavailable"].slice(0, 3) };
  }
  const variant = item.diagnostic.variant;
  const semantic = variant.semanticRootCause ?? {};
  const candidates = Array.isArray(semantic.candidates) ? semantic.candidates : [];
  const mapped = Number(variant.mappedHeaderFieldCount ?? 0);
  const tokens = Number(variant.pageOcrTokenCount ?? 0);
  const assigned = Number(variant.columnAssignmentCount ?? 0);
  const rows = Number(variant.reconstructedRowCount ?? 0);
  if (!tokens) {
    return { rootCauseClass: "E_OCR_TEXT_QUALITY", rootCauseEvidence: ["page OCR tokens 0", `mapped fields ${mapped}/4`] };
  }

  const split = candidates.filter((candidate: any) => candidate?.rejectReason === "possible-split-token-fragmentation").length;
  const near = candidates.filter((candidate: any) => candidate?.rejectReason === "near-lexicon-but-current-exact-alias-reject").length;
  const outside = candidates.filter((candidate: any) => candidate?.rejectReason === "outside-observed-header-band").length;
  const poor = candidates.filter((candidate: any) => candidate?.rejectReason === "ocr-or-lexicon-distance-too-large").length;
  const signals = [split > 0, near > 0, outside > 0, poor > 0, mapped > 0 && assigned === 0].filter(Boolean).length;
  const evidence: string[] = [];
  let rootCauseClass: RootCauseClass;

  if (signals >= 2 && mapped < 4) {
    rootCauseClass = "F_COMPOSITE";
    if (split) evidence.push("split adjacency observed");
    if (near) evidence.push("near-lexicon rejects observed");
    if (outside) evidence.push("header-band rejects observed");
    if (poor) evidence.push("OCR/lexicon distance rejects observed");
  } else if (split > 0) {
    rootCauseClass = "A_TOKEN_FRAGMENTATION";
    evidence.push("split adjacency observed");
  } else if (near > 0) {
    rootCauseClass = "B_LEXICON_FUZZY";
    evidence.push("header candidates exist but lexicon reject");
  } else if (outside > 0) {
    rootCauseClass = "C_HEADER_BAND_GEOMETRY";
    evidence.push("header candidates outside observed band");
  } else if (mapped > 0 && assigned === 0) {
    rootCauseClass = "D_COLUMN_ASSOCIATION";
    evidence.push("mapped header exists but column assignment 0");
  } else if (poor > 0 || (candidates.length > 0 && mapped === 0)) {
    rootCauseClass = "E_OCR_TEXT_QUALITY";
    evidence.push("header candidates exist but OCR/lexicon distance large");
  } else {
    rootCauseClass = "NOT_EVALUABLE";
    evidence.push("insufficient discriminating evidence");
  }

  if (mapped < 4) evidence.push(`mapped fields ${mapped}/4`);
  if (rows === 0) evidence.push("reconstructed rows 0");
  return { rootCauseClass, rootCauseEvidence: [...new Set(evidence)].slice(0, 3) };
}

function buildManagementShort(results: SemanticResult[], registryReady: boolean, registrySize: number) {
  return {
    schema: RESULT_SCHEMA,
    revision: RESULT_REVISION,
    evaluationHead: EVALUATION_HEAD,
    registryReady,
    registrySize,
    targets: results.map((item) => {
      const variant = item.diagnostic?.variant;
      const semantic = variant?.semanticRootCause;
      const classified = classifyRootCause(item);
      return {
        imageId: item.id,
        psm: item.diagnosticPsm,
        pageOcrTokenCount: Number(variant?.pageOcrTokenCount ?? 0),
        headerCandidateCount: Array.isArray(semantic?.candidates) ? semantic.candidates.length : 0,
        mappedHeaderFieldCount: Number(variant?.mappedHeaderFieldCount ?? 0),
        rowClusterCount: Number(variant?.rowClusterCount ?? 0),
        columnAssignmentCount: Number(variant?.columnAssignmentCount ?? 0),
        reconstructedRowCount: Number(variant?.reconstructedRowCount ?? 0),
        rootCauseClass: classified.rootCauseClass,
        rootCauseEvidence: classified.rootCauseEvidence,
        wrongAutoConfirm: Number(variant?.wrongAutoConfirm ?? 0),
        manualReviewRequired: Boolean(variant?.manualReviewRequired ?? true),
        processingTimeMs: variant?.recognizeElapsedMs ?? null,
      };
    }),
  };
}

export default function P5TokenGridRealPhotoPocPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const registryRef = useRef<Map<string, RegisteredImage>>(new Map());
  const [registered, setRegistered] = useState<RegisteredImage[]>([]);
  const [results, setResults] = useState<SemanticResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正式12枚を一度登録してください。以後、同じページを開いたままなら写真の再選択は不要です。");
  const [copyStatus, setCopyStatus] = useState("");

  const registeredIds = useMemo(() => new Set(registered.map((item) => item.id)), [registered]);
  const missingIds = FORMAL_IMAGE_IDS.filter((id) => !registeredIds.has(id));
  const duplicateIds = registered.map((item) => item.id).filter((id, index, all) => id !== "UNMATCHED" && all.indexOf(id) !== index);
  const unmatchedCount = registered.filter((item) => item.id === "UNMATCHED").length;
  const formalReady = registered.length === 12 && missingIds.length === 0 && duplicateIds.length === 0 && unmatchedCount === 0;

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
      for (const item of next) registryRef.current.set(item.id, item);
      setRegistered(next);
      const ids = new Set(next.map((item) => item.id));
      const missing = FORMAL_IMAGE_IDS.filter((id) => !ids.has(id));
      const duplicates = next.map((item) => item.id).filter((id, index, all) => id !== "UNMATCHED" && all.indexOf(id) !== index);
      const unmatched = next.filter((item) => item.id === "UNMATCHED").length;
      if (next.length === 12 && missing.length === 0 && duplicates.length === 0 && unmatched === 0) {
        setStatus("正式セット READY 12/12。『自動診断開始』で3ケースを自動診断します。");
      } else {
        registryRef.current.clear();
        setStatus(`正式セット不整合：登録${next.length}/12、不足${missing.length}、未照合${unmatched}、重複${duplicates.length}。正式12枚を再登録してください。`);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function runAutoDiagnostic() {
    if (busy) return;
    if (!formalReady || registryRef.current.size !== 12) {
      setStatus("正式12枚registryがありません。個別画像ではなく、正式12枚を再登録してください。");
      return;
    }
    const targets = AUTO_TARGETS.map((spec) => ({ spec, item: registryRef.current.get(spec.id) }));
    if (targets.some(({ item }) => !item)) {
      setStatus("診断対象をregistryから解決できません。正式12枚を再登録してください。");
      return;
    }

    setBusy(true);
    setCopyStatus("");
    setResults([]);
    setStatus("3ケースをregistryから自動選択し、semantic mapping root causeを診断中です。file pickerは開きません。");
    const collected: SemanticResult[] = [];
    try {
      for (const { spec, item } of targets as Array<{ spec: typeof AUTO_TARGETS[number]; item: RegisteredImage }>) {
        try {
          const diagnostic = await runP5SemanticHeaderDiagnostic(item.file, spec.psm);
          collected.push({ id: item.id, diagnosticPsm: spec.psm, fingerprint: item.fingerprint, imageWidth: item.imageWidth, imageHeight: item.imageHeight, diagnostic, error: null });
        } catch (error) {
          collected.push({ id: item.id, diagnosticPsm: spec.psm, fingerprint: item.fingerprint, imageWidth: item.imageWidth, imageHeight: item.imageHeight, diagnostic: null, error: error instanceof Error ? error.message : String(error) });
        }
        setResults([...collected]);
      }
      setStatus("Semantic mapping診断完了。『総合管理用結果をコピー』で短縮JSONだけ提出できます。");
    } finally {
      setBusy(false);
    }
  }

  async function copyManagementShort() {
    if (!results.length) return;
    const payload = buildManagementShort(results, formalReady, registryRef.current.size);
    try {
      await copyText(JSON.stringify(payload, null, 2));
      setCopyStatus("コピーしました");
    } catch {
      setCopyStatus("コピーできませんでした");
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 12px 60px", color: "#172033", background: "#f7f9fc" }}>
      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>P5 Semantic Mapping Root Cause診断</h1>
        <p><b>正式12枚を一度登録後、3ケースはregistryから自動選択します。個別画像の再選択はありません。</b></p>
        <p>詳細diagnosticは画面内部に保持し、通常コピーはmanagement short JSONだけです。</p>
      </section>

      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void registerFormalSet(event.target.files)} />
        {!formalReady ? <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>正式12枚を登録</button> : null}
        <div style={{ marginTop: 10, fontWeight: 900, color: formalReady ? "#176b34" : "#8a5a00" }}>{formalReady ? "正式セット READY 12/12" : `登録 ${registered.length}/12`}</div>
        <div role="status" aria-live="polite" style={{ marginTop: 8 }}>{status}</div>
        <button disabled={!formalReady || busy} onClick={() => void runAutoDiagnostic()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, marginTop: 12, background: !formalReady || busy ? "#94a3b8" : "#176b34", color: "white", fontWeight: 900 }}>{busy ? "Semantic診断中…" : "自動診断開始"}</button>
      </section>

      {registered.length > 0 ? <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>登録済み正式セット</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
          {registered.map((item) => <div key={`${item.selectionOrder}-${item.fingerprint}`} style={{ border: "1px solid #dbe2ec", borderRadius: 12, padding: 8 }}>
            <div style={{ fontWeight: 900 }}>登録 #{item.selectionOrder}</div>
            <img src={item.previewUrl} alt={`登録${item.selectionOrder}`} style={{ width: "100%", height: 100, objectFit: "contain", background: "#eef2f7", borderRadius: 8, margin: "6px 0" }} />
            <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>{item.name}</div>
            <div style={{ fontSize: 12 }}>{item.imageWidth && item.imageHeight ? `${item.imageWidth} × ${item.imageHeight}px` : "size unavailable"}</div>
            <div style={{ fontSize: 12 }}>識別: {item.id === "UNMATCHED" ? "未照合" : "登録済み"}</div>
          </div>)}
        </div>
        {!formalReady ? <div style={{ marginTop: 10, color: "#8a1c1c" }}>不足: {missingIds.length} / 未照合: {unmatchedCount} / 重複: {duplicateIds.length}</div> : null}
      </section> : null}

      {results.length > 0 ? <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Semantic診断結果</h2>
        <button onClick={() => void copyManagementShort()} disabled={busy} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: "#176b34", color: "white", fontWeight: 900 }}>総合管理用結果をコピー</button>
        {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus === "コピーしました" ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
        {results.map((item) => {
          const short = buildManagementShort([item], formalReady, registryRef.current.size).targets[0];
          return <div key={item.id} style={{ marginTop: 14, borderTop: "1px solid #dbe2ec", paddingTop: 10 }}>
            <div style={{ fontWeight: 900 }}>{item.id} / PSM {item.diagnosticPsm}</div>
            {item.error ? <div style={{ color: "#a11" }}>ERROR: {item.error}</div> : null}
            <div style={{ fontSize: 13, marginTop: 6 }}>tokens: {short.pageOcrTokenCount} / headers: {short.mappedHeaderFieldCount}/4 / rows: {short.reconstructedRowCount} / root: {short.rootCauseClass}</div>
            {item.diagnostic ? <details style={{ marginTop: 8 }}><summary>詳細診断を表示</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 420, overflow: "auto", fontSize: 11 }}>{JSON.stringify(item.diagnostic, null, 2)}</pre></details> : null}
          </div>;
        })}
      </section> : null}
    </main>
  );
}
