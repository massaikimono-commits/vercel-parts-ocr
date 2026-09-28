"use client";

import { useEffect } from "react";
import {
  beginCertificatePdfCounterfactualTrace,
  exportCertificatePdfCounterfactualTrace,
  getCertificatePdfCounterfactualTraceRunId,
  isCertificatePdfCounterfactualTraceEnabled,
  observeCertificatePdfCounterfactualTrace,
} from "./certificate-pdf-counterfactual-trace";
import { getCertificatePdfFieldProvenance } from "./certificate-pdf-field-provenance";
import { getCertificatePdfProgrammaticChangeOrigin } from "./certificate-pdf-programmatic-change-origin";

const AUTH_EVENT = "vehicle-certificate-authoritative";
let nextObserverId = 0;
let nextSelectionId = 0;

function isPdfInputEvent(event) {
  const input = event?.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file") return false;
  const file = input.files?.[0];
  return Boolean(file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")));
}
function passState(input) {
  return `v3=${input?.dataset?.pdfStructuredV3PassThrough || "0"}:v2=${input?.dataset?.pdfNativeV2PassThrough || "0"}:v1=${input?.dataset?.pdfNativePassThrough || "0"}`;
}
function currentOrAuthRunId(event) {
  const detail = event?.detail || {};
  return String(getCertificatePdfCounterfactualTraceRunId() || detail?.__certificatePdfRunId || detail?.runId || `auth-${Date.now()}`);
}
function observeProvenance(runId, invocation) {
  try {
    const record = getCertificatePdfFieldProvenance();
    if (!record?.fields) return;
    const stages = ["strict", "canonical", "semantic", "weight", "displacement", "final"];
    for (const stage of stages) {
      const values = {};
      for (const [field, trace] of Object.entries(record.fields)) {
        const stageRecord = trace?.stages?.[stage];
        if (stageRecord) values[field] = stageRecord.output ?? stageRecord.selected ?? null;
      }
      observeCertificatePdfCounterfactualTrace(runId, `V3_${stage.toUpperCase()}_VALUES`, values, { owner: "structured-v3", writer: `parseStructured:${stage}`, invocation });
    }
    observeCertificatePdfCounterfactualTrace(runId, "V3_PROVENANCE_TERMINAL", {}, { owner: "structured-v3", writer: "field-provenance", invocation: `${invocation}:${record.terminal || "unknown"}` });
  } catch {}
}

export default function CertificatePdfCounterfactualTraceObserver() {
  useEffect(() => {
    if (!isCertificatePdfCounterfactualTraceEnabled()) return undefined;
    const observerId = `counterfactual-observer-${++nextObserverId}`;
    const onChangeCapture = (event) => {
      if (!isPdfInputEvent(event)) return;
      const input = event.target;
      const file = input.files?.[0];
      if (event.isTrusted) {
        const runId = `pdf-selection-${Date.now()}-${++nextSelectionId}`;
        beginCertificatePdfCounterfactualTrace(runId, { observerId, source: "PDF_SELECTION", fileFingerprint: `s${Number(file?.size) || 0}:m${Number(file?.lastModified) || 0}` });
        observeCertificatePdfCounterfactualTrace(runId, "PDF_SELECTION_CAPTURE", {}, { owner: "input", writer: "user-selection", invocation: `${observerId}:${passState(input)}` });
        return;
      }
      const runId = getCertificatePdfCounterfactualTraceRunId();
      if (!runId) return;
      const origin = getCertificatePdfProgrammaticChangeOrigin(event);
      const before = passState(input);
      observeCertificatePdfCounterfactualTrace(runId, "PROGRAMMATIC_CHANGE_CAPTURE", {}, {
        owner: input?.dataset?.pdfStructuredV3PassThrough === "1" ? "structured-v3" : input?.dataset?.pdfNativeV2PassThrough === "1" ? "native-v2" : "other",
        writer: origin?.programmaticChangeOrigin || "change-event",
        invocation: `${observerId}:originSeq=${origin?.originSequence ?? "none"}:${before}`,
      });
      queueMicrotask(() => {
        observeCertificatePdfCounterfactualTrace(runId, "PROGRAMMATIC_CHANGE_AFTER_LISTENERS", {}, {
          owner: "event-loop",
          writer: origin?.programmaticChangeOrigin || "change-event",
          invocation: `${observerId}:originSeq=${origin?.originSequence ?? "none"}:before=${before}:after=${passState(input)}`,
        });
      });
      observeProvenance(runId, `${observerId}:fallback-boundary`);
    };

    const onAuthoritative = (event) => {
      const detail = event?.detail || {};
      const runId = currentOrAuthRunId(event);
      if (!getCertificatePdfCounterfactualTraceRunId()) beginCertificatePdfCounterfactualTrace(runId, { observerId, source: "AUTH_EVENT" });
      observeProvenance(runId, `${observerId}:auth-boundary`);
      const owner = detail?.__certificatePdfFinalOwner || (detail?.__certificatePdfRunId ? "structured-v3" : "unmarked-authority");
      const writer = detail?.__certificatePdfWriter || (detail?.__certificatePdfFinalOwner ? "V3_AUTH_DISPATCH" : "NON_V3_AUTH_DISPATCH");
      observeCertificatePdfCounterfactualTrace(runId, "AUTH_EVENT_CAPTURE", detail, { owner, writer, invocation: `${observerId}:sourceRun=${detail?.__certificatePdfRunId ?? "none"}` });
      queueMicrotask(() => observeCertificatePdfCounterfactualTrace(runId, "AUTH_EVENT_POST_LISTENERS", detail, { owner, writer: "AUTH_EVENT_POST_LISTENERS", invocation: observerId }));
    };

    window.addEventListener("change", onChangeCapture, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative, true);
    return () => {
      window.removeEventListener("change", onChangeCapture, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative, true);
    };
  }, []);

  if (!isCertificatePdfCounterfactualTraceEnabled()) return null;
  const copyTrace = async () => {
    const text = exportCertificatePdfCounterfactualTrace();
    if (!text) { globalThis.alert?.("Traceはまだありません"); return; }
    try {
      await navigator.clipboard.writeText(text);
      globalThis.alert?.("PDF Traceをコピーしました");
    } catch {
      globalThis.prompt?.("Traceを全選択してコピーしてください", text);
    }
  };
  return (
    <button type="button" onClick={copyTrace} data-certificate-pdf-trace-export="1" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 2147483647, padding: "10px 14px", borderRadius: 8, border: "1px solid currentColor", background: "white", color: "black", fontSize: 14 }}>
      PDF Traceをコピー
    </button>
  );
}
