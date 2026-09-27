"use client";

import { useEffect } from "react";
import {
  beginCertificatePdfCounterfactualTrace,
  getCertificatePdfCounterfactualTraceRunId,
  isCertificatePdfCounterfactualTraceEnabled,
  observeCertificatePdfCounterfactualTrace,
} from "./certificate-pdf-counterfactual-trace";

const AUTH_EVENT = "vehicle-certificate-authoritative";
let nextObserverId = 0;

function runIdForEvent(event) {
  const detail = event?.detail || {};
  return String(
    detail?.__certificatePdfRunId ||
    detail?.runId ||
    getCertificatePdfCounterfactualTraceRunId() ||
    `auth-${Date.now()}`
  );
}

export default function CertificatePdfCounterfactualTraceObserver() {
  useEffect(() => {
    if (!isCertificatePdfCounterfactualTraceEnabled()) return undefined;
    const observerId = `auth-observer-${++nextObserverId}`;
    const onAuthoritative = (event) => {
      const runId = runIdForEvent(event);
      if (!getCertificatePdfCounterfactualTraceRunId()) {
        beginCertificatePdfCounterfactualTrace(runId, { observerId, source: "AUTH_EVENT" });
      }
      observeCertificatePdfCounterfactualTrace(runId, "AUTH_EVENT_CAPTURE", event?.detail || {}, {
        owner: event?.detail?.__certificatePdfFinalOwner || event?.detail?.owner || null,
        writer: event?.detail?.__certificatePdfWriter || event?.detail?.writer || "AUTH_EVENT",
        invocation: observerId,
      });
      queueMicrotask(() => {
        observeCertificatePdfCounterfactualTrace(runId, "AUTH_EVENT_POST_LISTENERS", event?.detail || {}, {
          owner: event?.detail?.__certificatePdfFinalOwner || event?.detail?.owner || null,
          writer: "AUTH_EVENT_POST_LISTENERS",
          invocation: observerId,
        });
      });
    };
    window.addEventListener(AUTH_EVENT, onAuthoritative, true);
    return () => window.removeEventListener(AUTH_EVENT, onAuthoritative, true);
  }, []);
  return null;
}
