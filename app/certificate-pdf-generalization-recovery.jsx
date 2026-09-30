"use client";

import { useLayoutEffect } from "react";
import { clusterPhysicalRows, detectAxleLayout, parseTwoAxleVehicleRows } from "./lib/certificate-pdf-row-semantics.mjs";
import { isCurrentPdfRun, isPdfRunContinuation, pdfRunForEvent } from "./certificate-pdf-run-identity";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";

function tokenFromItem(item, width, height) {
  const text = String(item?.str || "").normalize("NFKC").trim();
  if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  return {
    text,
    x: Number(tr[4] || 0) / Math.max(1, width),
    y: 1 - Number(tr[5] || 0) / Math.max(1, height),
    w: Math.max(Number(item?.width || 0), 1) / Math.max(1, width),
    h: Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, height),
  };
}

async function extractGenericPatch(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    let best = null;
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages || 1, 8); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const tokens = (content.items || []).map((item) => tokenFromItem(item, viewport.width, viewport.height)).filter(Boolean);
      const rows = clusterPhysicalRows(tokens);
      const layout = detectAxleLayout(rows);
      const score = layout === "two-axis" ? 20 : layout === "four-axis" ? 10 : 0;
      if (!best || score > best.score) best = { rows, layout, score, pageNumber };
    }
    if (!best || best.layout !== "two-axis") return { patch: {}, layout: best?.layout || "unknown", pageNumber: best?.pageNumber || 1 };
    return { patch: parseTwoAxleVehicleRows(best.rows), layout: best.layout, pageNumber: best.pageNumber };
  } finally {
    await pdf.destroy?.().catch?.(() => {});
  }
}

export default function CertificatePdfGeneralizationRecovery() {
  useLayoutEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let pending = null;
    let latest = null;
    let latestRunId = 0;
    let dispatching = false;

    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file" || isPdfRunContinuation(event)) return;
      const file = input.files?.[0];
      if (!file || !(file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))) return;
      const runId = pdfRunForEvent(event);
      latest = null;
      latestRunId = runId;
      const copy = file.slice(0, file.size, file.type);
      pending = extractGenericPatch(copy).then((result) => {
        if (!dead && isCurrentPdfRun(runId, "GeneralizationRecovery")) latest = result;
        return result;
      }).catch((error) => {
        if (isCurrentPdfRun(runId, "GeneralizationRecovery")) console.warn("certificate pdf generalization recovery", error);
        return null;
      });
    };

    const onAuthoritative = async (event) => {
      if (dispatching) return;
      const detail = event?.detail;
      if (!detail || typeof detail !== "object") return;
      const runId = latestRunId;
      if (!runId || !isCurrentPdfRun(runId, "GeneralizationRecovery")) return;
      const result = latest || (pending ? await pending : null);
      if (dead || !isCurrentPdfRun(runId, "GeneralizationRecovery") || result?.layout !== "two-axis") return;
      const patch = result?.patch || {};
      if (!Object.keys(patch).length) return;
      const merged = { ...detail, ...patch, __pdfGeneralizationEvidence: { layout: result.layout, pageNumber: result.pageNumber, fields: Object.keys(patch) } };
      if (JSON.stringify(merged) === JSON.stringify(detail)) return;
      dispatching = true;
      try {
        window[PDF_PRIORITY_KEY] = merged;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: merged }));
      } finally {
        dispatching = false;
      }
    };

    window.addEventListener("change", onChange, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    return () => {
      dead = true;
      window.removeEventListener("change", onChange, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative);
    };
  }, []);
  return null;
}
