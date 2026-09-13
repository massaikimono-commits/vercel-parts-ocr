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

const RESULT_SCHEMA = "icb.parts-ocr.p5-semantic-mapping-root-cause.v1";
const RESULT_REVISION = "p5-semantic-root-cause-0675-0678-0684-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
const FORMAL_IMAGE_IDS = Array.from({ length: 12 }, (_, index) => `IMG_${String(675 + index).padStart(4, "0")}`);
const AUTO_TARGETS = [
  { id: "IMG_0675", psm: "3" as const, role: "existing-success-token-case" },
  { id: "IMG_0678", psm: "6" as const, role: "zero-token-rescue-diagnostic" },
  { id: "IMG_0684", psm: "3" as const, role: "existing-success-reconstruction-case" },
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
        setStatus("正式セット READY 12/12。『自動診断開始』で3ケースを自動選択し、semantic mapping原因を診断します。");
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
      setStatus("Semantic mapping診断完了。『診断結果をコピー』を1回押して、そのまま総合管理へ貼り付けてください。");
    } finally {
      setBusy(false);
    }
  }

  async function copyDiagnostic() {
    if (!results.length) return;
    const payload = {
      schema: RESULT_SCHEMA,
      revision: RESULT_REVISION,
      evaluationHead: EVALUATION_HEAD,
      registryReady: formalReady,
      registrySize: registryRef.current.size,
      runtimePsmUnchanged: true,
      runtimePsm: "3",
      psm11ExcludedFromLane: true,
      targets: results.map((item) => ({ imageId: item.id, diagnosticPsm: item.diagnosticPsm, safeImageFingerprint: item.fingerprint, width: item.imageWidth, height: item.imageHeight, error: item.error, diagnostic: item.diagnostic })),
      privacy: { rawRecognizedTextIncluded: false, rawTsvIncluded: false, imageIncluded: false },
      tuningChanged: false,
      productionChanged: false,
      gtRuntimeUsed: false,
    };
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
        <p><b>正式12枚を一度登録後、0675/0678/0684相当はregistryから自動選択します。個別画像の再選択はありません。</b></p>
        <p>0675/0684はPSM3、0678はPSM6 diagnostic rescueのみ。runtime PSM3は変更しません。</p>
        <p>JSONにはOCR本文を出さず、hash・文字種・normalized geometry・lexicon距離・隣接証拠・reject reasonだけを出します。</p>
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
        <button onClick={() => void copyDiagnostic()} disabled={busy} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: "#176b34", color: "white", fontWeight: 900 }}>診断結果をコピー</button>
        {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus === "コピーしました" ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
        {results.map((item) => <div key={item.id} style={{ marginTop: 14, borderTop: "1px solid #dbe2ec", paddingTop: 10 }}>
          <div style={{ fontWeight: 900 }}>{item.id} / diagnostic PSM {item.diagnosticPsm}</div>
          {item.error ? <div style={{ color: "#a11" }}>ERROR: {item.error}</div> : null}
          {item.diagnostic ? <div style={{ fontSize: 13, marginTop: 6 }}>tokens: {item.diagnostic.variant.pageOcrTokenCount} / mapped headers: {item.diagnostic.variant.mappedHeaderFieldCount} / rows: {item.diagnostic.variant.reconstructedRowCount} / candidates: {item.diagnostic.variant.semanticRootCause?.candidates?.length ?? 0}</div> : null}
        </div>)}
      </section> : null}
    </main>
  );
}
