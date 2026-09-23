import { getCertificatePdfFieldProvenance, isCertificatePdfFieldProvenanceEnabled } from "./certificate-pdf-field-provenance";

const PANEL_SELECTOR = "[data-pdf-structured-v3-field-provenance]";

export function showCertificatePdfFieldProvenanceUi(snapshot) {
  try {
    if (!isCertificatePdfFieldProvenanceEnabled() || !document.body) return;
    let panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) {
      panel = document.createElement("section");
      panel.dataset.pdfStructuredV3FieldProvenance = "1";
      panel.setAttribute("aria-label", "PDF v3 Field Provenance");
      panel.style.cssText = "position:fixed;z-index:2147483000;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));max-height:42vh;overflow:auto;box-sizing:border-box;padding:12px;border:2px solid #2563eb;border-radius:12px;background:#fff;color:#172554;box-shadow:0 4px 20px #0004;font:14px/1.4 sans-serif";
      const title = document.createElement("strong");
      title.textContent = "PDF v3 Field Provenance";
      title.style.display = "block";
      const state = document.createElement("div");
      state.dataset.pdfFieldProvenanceState = "1";
      const run = document.createElement("div");
      run.dataset.pdfFieldProvenanceRun = "1";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Traceをコピー";
      copy.style.cssText = "display:block;min-height:44px;margin:8px 0;padding:8px 16px;border:1px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;font:700 16px sans-serif;touch-action:manipulation";
      const feedback = document.createElement("div");
      feedback.dataset.pdfFieldProvenanceCopyFeedback = "1";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      const output = document.createElement("textarea");
      output.readOnly = true;
      output.setAttribute("aria-label", "PDF v3 field provenance JSON（長押しでコピー可能）");
      output.style.cssText = "display:block;box-sizing:border-box;width:100%;min-height:120px;padding:8px;border:1px solid #94a3b8;border-radius:6px;background:#f8fafc;color:#0f172a;font:12px/1.4 monospace;user-select:text;-webkit-user-select:text";
      copy.addEventListener("click", async () => {
        if (!output.value) return;
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
          await navigator.clipboard.writeText(output.value);
          feedback.textContent = "コピーしました";
        } catch {
          feedback.textContent = "自動コピーできませんでした。下のJSONを長押ししてコピーしてください";
          output.focus();
          output.select();
        }
      });
      panel.append(title, state, run, copy, feedback, output);
      document.body.appendChild(panel);
    }
    const trace = getCertificatePdfFieldProvenance(snapshot?.diagnosticId);
    const ready = snapshot?.checkpoints?.some((item) => item.checkpoint === "FIELD_PROVENANCE_READY");
    const output = panel.querySelector("textarea");
    output.value = trace ? JSON.stringify(trace, null, 2) : "";
    panel.querySelector("[data-pdf-field-provenance-state]").textContent = `Trace状態: ${ready ? "FIELD_PROVENANCE_READY" : snapshot ? "解析中" : "PDF選択待ち"}`;
    panel.querySelector("[data-pdf-field-provenance-run]").textContent = `Run: ${snapshot?.runId ?? "-"} / Diagnostic: ${snapshot?.diagnosticId ?? "-"}`;
    panel.querySelector("button").disabled = !trace || !ready;
    if (!trace || !ready) panel.querySelector("[data-pdf-field-provenance-copy-feedback]").textContent = "";
  } catch {
    // Diagnostic UI must never change PDF processing or its terminal state.
  }
}

export function removeCertificatePdfFieldProvenanceUi() {
  try { document.querySelector(PANEL_SELECTOR)?.remove(); } catch {}
}
