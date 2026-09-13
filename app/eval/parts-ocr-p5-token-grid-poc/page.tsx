/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useRef, useState } from "react";
import { runP5PsmPrimaryComparison, type P5PsmPrimaryComparison } from "../../ocr/bakeoff/p5-psm-primary-browser";

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

type CompareResult = {
  id: string;
  name: string;
  fingerprint: string;
  imageWidth: number | null;
  imageHeight: number | null;
  previewUrl: string;
  comparison: P5PsmPrimaryComparison | null;
  error: string | null;
};

const RESULT_SCHEMA = "icb.parts-ocr.p5-zero-token-rescue-full-pipeline.v1";
const RESULT_REVISION = "p5-registry-zero-token-rescue-psm-3-6-11-v1";
const EVALUATION_HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
const FORMAL_IMAGE_IDS = Array.from({ length: 12 }, (_, index) => `IMG_${String(675 + index).padStart(4, "0")}`);
const AUTO_TARGET = "IMG_0678";

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
  const [results, setResults] = useState<CompareResult[]>([]);
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
      const base = selected.map((file, index) => ({
        file,
        id: canonicalId(file.name),
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        selectionOrder: index + 1,
      }));
      const [sizes, fingerprints] = await Promise.all([
        Promise.all(base.map((item) => loadImageSize(item.previewUrl))),
        Promise.all(base.map((item) => safeFingerprint(item.file))),
      ]);
      const next: RegisteredImage[] = base.map((item, index) => ({
        ...item,
        imageWidth: sizes[index].width || null,
        imageHeight: sizes[index].height || null,
        fingerprint: fingerprints[index],
      }));
      for (const item of next) registryRef.current.set(item.id, item);
      setRegistered(next);
      const ids = new Set(next.map((item) => item.id));
      const missing = FORMAL_IMAGE_IDS.filter((id) => !ids.has(id));
      const duplicates = next.map((item) => item.id).filter((id, index, all) => id !== "UNMATCHED" && all.indexOf(id) !== index);
      const unmatched = next.filter((item) => item.id === "UNMATCHED").length;
      if (next.length === 12 && missing.length === 0 && duplicates.length === 0 && unmatched === 0) {
        setStatus("正式セット READY 12/12。『自動診断開始』でOCR 0ケースを自動選択し、PSM3 / PSM6 / PSM11をFull P5 Pipeline比較します。");
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
      setStatus("正式12枚registryがありません。対象写真1枚ではなく、正式12枚を再登録してください。");
      return;
    }
    const target = registryRef.current.get(AUTO_TARGET);
    if (!target) {
      setStatus("診断対象をregistryから解決できません。正式12枚を再登録してください。");
      return;
    }

    setBusy(true);
    setCopyStatus("");
    setResults([]);
    setStatus("OCR 0ケースをregistryから自動選択し、PSM3 / PSM6 / PSM11をFull P5 Pipeline比較中です。file pickerは開きません。");
    try {
      const comparison = await runP5PsmPrimaryComparison(target.file);
      setResults([{
        id: target.id,
        name: target.name,
        fingerprint: target.fingerprint,
        imageWidth: target.imageWidth,
        imageHeight: target.imageHeight,
        previewUrl: target.previewUrl,
        comparison,
        error: null,
      }]);
      setStatus("Full P5 Pipeline比較完了。『診断結果をコピー』を1回押して、そのまま総合管理へ貼り付けてください。");
    } catch (error) {
      setResults([{
        id: target.id,
        name: target.name,
        fingerprint: target.fingerprint,
        imageWidth: target.imageWidth,
        imageHeight: target.imageHeight,
        previewUrl: target.previewUrl,
        comparison: null,
        error: error instanceof Error ? error.message : String(error),
      }]);
      setStatus("自動診断でエラーが発生しました。診断結果を確認してください。");
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
      targetMode: "registry-auto-target",
      targetPurpose: "zero-token-rescue-full-pipeline",
      runtimePsmUnchanged: true,
      runtimePsm: "3",
      comparedPsms: ["3", "6", "11"],
      targets: results.map((item) => ({
        imageId: item.id,
        safeImageFingerprint: item.fingerprint,
        width: item.imageWidth,
        height: item.imageHeight,
        error: item.error,
        comparison: item.comparison,
      })),
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
        <h1 style={{ marginTop: 0 }}>P5 Zero-Token Rescue Full Pipeline診断</h1>
        <p><b>正式12枚を一度登録した後は、同一ページセッション中の診断で写真を選び直しません。</b></p>
        <p>OCR 0ケースはregistryから自動選択し、CURRENT PSM3 / PSM6 rescue / PSM11 rescueを同一画像・同一前処理で比較します。</p>
        <p>File objectはブラウザ内memory registryだけに保持し、画像本体はserver・GitHub・Supabase・Vercel bundle・artifactへ送信/保存しません。</p>
        <p>GT row数はruntimeの画像選択・OCR・停止条件・再構成制御には使用しません。</p>
      </section>

      <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 12 }}>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(event) => void registerFormalSet(event.target.files)} />
        {!formalReady ? <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, background: busy ? "#94a3b8" : "#245fce", color: "white", fontWeight: 900 }}>
          正式12枚を登録
        </button> : null}
        <div style={{ marginTop: 10, fontWeight: 900, color: formalReady ? "#176b34" : "#8a5a00" }}>
          {formalReady ? "正式セット READY 12/12" : `登録 ${registered.length}/12`}
        </div>
        <div role="status" aria-live="polite" style={{ marginTop: 8 }}>{status}</div>
        <button disabled={!formalReady || busy} onClick={() => void runAutoDiagnostic()} style={{ width: "100%", border: 0, borderRadius: 12, padding: 14, marginTop: 12, background: !formalReady || busy ? "#94a3b8" : "#176b34", color: "white", fontWeight: 900 }}>
          {busy ? "Full Pipeline比較中…" : "自動診断開始"}
        </button>
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
            <div style={{ fontSize: 11, color: "#667085" }}>fp: {item.fingerprint}</div>
          </div>)}
        </div>
        {!formalReady ? <div style={{ marginTop: 10, color: "#8a1c1c" }}>不足: {missingIds.length} / 未照合: {unmatchedCount} / 重複: {duplicateIds.length}</div> : null}
      </section> : null}

      {results.length > 0 ? <section style={{ background: "white", border: "1px solid #dbe2ec", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>自動比較結果</h2>
        <p>OCR 0ケースをregistryから自動選択済み。ユーザーによる対象画像探索・個別選択はありません。</p>
        <button onClick={() => void copyDiagnostic()} disabled={busy} style={{ width: "100%", border: 0, borderRadius: 12, padding: 13, background: "#176b34", color: "white", fontWeight: 900 }}>診断結果をコピー</button>
        {copyStatus ? <div role="status" aria-live="polite" style={{ marginTop: 8, fontWeight: 900, color: copyStatus === "コピーしました" ? "#176b34" : "#a11" }}>{copyStatus}</div> : null}
        {results.map((item) => <div key={item.id} style={{ marginTop: 16, borderTop: "1px solid #dbe2ec", paddingTop: 12 }}>
          {item.error ? <div style={{ color: "#a11" }}>ERROR: {item.error}</div> : null}
          {item.comparison ? <div style={{ overflowX: "auto", marginTop: 8 }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th align="left">PSM</th><th>tokens</th><th>headers</th><th>clusters</th><th>assigned</th><th>rows</th><th>ms</th><th>manual</th><th>wrong</th></tr></thead>
            <tbody>{item.comparison.variants.map((variant) => <tr key={variant.label}>
              <td>{variant.label}</td><td align="center">{variant.pageOcrTokenCount}</td><td align="center">{variant.mappedHeaderFieldCount}</td><td align="center">{variant.rowClusterCount}</td><td align="center">{variant.columnAssignmentCount}</td><td align="center">{variant.reconstructedRowCount}</td><td align="center">{variant.recognizeElapsedMs ?? "-"}</td><td align="center">{String(variant.manualReviewRequired)}</td><td align="center">{variant.wrongAutoConfirm}</td>
            </tr>)}</tbody>
          </table></div> : null}
        </div>)}
      </section> : null}
    </main>
  );
}
