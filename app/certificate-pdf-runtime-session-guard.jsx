"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const RUN_KEY = "__vehicleCertificatePdfRun";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const TERMINAL_RE = /(完了|エラー|フォールバック|引き継ぎ|切り替え|タイムアウト)/;

function card() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  ) || null;
}

function statusBox() {
  return card()?.querySelector("[data-pdf-structured-v3-status]") || null;
}

function fingerprint(file) {
  return `${file?.size || 0}:${file?.lastModified || 0}:${String(file?.name || "").length}`;
}

function clearVisualRunState() {
  const root = card();
  root?.querySelector("[data-pdf-structured-v3-debug]")?.remove();
  root?.querySelector("img[data-pdf-structured-v3-preview]")?.remove();
  const box = statusBox();
  if (box) box.textContent = "PDF構造読み取り v3: 新しい解析runを開始します…";
}

function debugPanel(run) {
  const root = card();
  if (!root) return;
  let details = root.querySelector("[data-pdf-runtime-session-debug]");
  if (!details) {
    details = document.createElement("details");
    details.dataset.pdfRuntimeSessionDebug = "1";
    details.style.marginTop = "10px";
    details.innerHTML = "<summary style='font-weight:800;cursor:pointer'>PDF runtime診断</summary><pre style='white-space:pre-wrap;word-break:break-word;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px'></pre>";
    root.appendChild(details);
  }
  const safe = {
    runId: run.id,
    inputFingerprint: run.fingerprint,
    selectedPage: run.selectedPage ?? null,
    pageTokenCount: run.pageTokenCount ?? null,
    structuredFieldCount: run.structuredFieldCount ?? null,
    structuredMissingRequiredCount: run.structuredMissingRequiredCount ?? null,
    fallbackReason: run.fallbackReason ?? null,
    fallbackStarted: Boolean(run.fallbackStarted),
    fallbackCompleted: Boolean(run.fallbackCompleted),
    fallbackFieldCount: run.fallbackFieldCount ?? null,
    patchFieldCount: run.patchFieldCount ?? 0,
    committedFieldCount: run.committedFieldCount ?? 0,
    staleRunRejected: run.staleRunRejected ?? 0,
    terminalState: run.terminalState ?? "processing",
    processingTimeMs: run.endedAt ? run.endedAt - run.startedAt : Date.now() - run.startedAt,
  };
  const pre = details.querySelector("pre");
  if (pre) pre.textContent = JSON.stringify(safe, null, 2);
}

export default function CertificatePdfRuntimeSessionGuard() {
  useLayoutEffect(() => {
    let sequence = 0;
    let watchdog = null;
    let observer = null;

    const finish = (run, state) => {
      if (window[RUN_KEY]?.id !== run.id || run.endedAt) return;
      run.terminalState = state;
      run.endedAt = Date.now();
      if (watchdog) clearTimeout(watchdog);
      debugPanel(run);
    };

    const watchStatus = (run) => {
      observer?.disconnect();
      const root = card();
      if (!root) return;
      observer = new MutationObserver(() => {
        if (window[RUN_KEY]?.id !== run.id) return;
        const text = statusBox()?.textContent || "";
        if (!TERMINAL_RE.test(text)) return;
        if (/完了/.test(text)) finish(run, "completed");
        else if (/フォールバック|引き継ぎ|切り替え/.test(text)) finish(run, "fallback");
        else if (/エラー/.test(text)) finish(run, "error");
        else if (/タイムアウト/.test(text)) finish(run, "timeout");
      });
      observer.observe(root, { subtree: true, childList: true, characterData: true });
    };

    const onFile = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (input.dataset.pdfStructuredV3PassThrough === "1" || input.dataset.pdfNativeV2PassThrough === "1" || input.dataset.pdfNativePassThrough === "1") return;
      const file = input.files?.[0];
      if (!file || !(file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))) return;

      const previous = window[RUN_KEY];
      if (previous && !previous.endedAt) {
        previous.staleRunRejected = (previous.staleRunRejected || 0) + 1;
        previous.terminalState = "superseded";
        previous.endedAt = Date.now();
      }

      const run = {
        id: `pdf-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
        fingerprint: fingerprint(file),
        startedAt: Date.now(),
        endedAt: null,
        staleRunRejected: 0,
        terminalState: "processing",
        patchFieldCount: 0,
        committedFieldCount: 0,
      };
      window[RUN_KEY] = run;
      window[PDF_PRIORITY_KEY] = null;
      window[QR_PRIORITY_KEY] = null;
      clearVisualRunState();
      debugPanel(run);
      watchStatus(run);

      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (window[RUN_KEY]?.id !== run.id || run.endedAt) return;
        const box = statusBox();
        if (box) {
          box.textContent = "PDF構造読み取り v3 タイムアウト: 解析runを終了しました。もう一度PDFを選択してください。";
          box.style.background = "#fff1f1";
          box.style.borderColor = "#efb7b7";
          box.style.color = "#922";
        }
        finish(run, "timeout");
      }, 30000);
    };

    const onAuthoritative = (event) => {
      const run = window[RUN_KEY];
      if (!run || run.endedAt) return;
      const detail = event?.detail;
      if (!detail || typeof detail !== "object") return;
      const fields = Object.entries(detail).filter(([key, value]) => !key.startsWith("__") && value !== "" && value !== null && value !== undefined).length;
      run.patchFieldCount = Math.max(run.patchFieldCount || 0, fields);
      run.committedFieldCount = Math.max(run.committedFieldCount || 0, fields);
      debugPanel(run);
    };

    window.addEventListener("change", onFile, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative, true);
    return () => {
      window.removeEventListener("change", onFile, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative, true);
      observer?.disconnect();
      if (watchdog) clearTimeout(watchdog);
    };
  }, []);

  return null;
}
