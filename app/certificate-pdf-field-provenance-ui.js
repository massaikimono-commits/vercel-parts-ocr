import { getCertificatePdfFieldProvenance, isCertificatePdfFieldProvenanceEnabled } from "./certificate-pdf-field-provenance";
import { projectCertificatePdfFieldProvenanceCompact } from "./certificate-pdf-field-provenance-compact";

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
      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:8px 0";
      const compactCopy = document.createElement("button");
      compactCopy.type = "button";
      compactCopy.dataset.pdfFieldProvenanceCopyCompact = "1";
      compactCopy.textContent = "短縮Traceをコピー";
      const fullCopy = document.createElement("button");
      fullCopy.type = "button";
      fullCopy.dataset.pdfFieldProvenanceCopyFull = "1";
      fullCopy.textContent = "Traceをコピー（完全版）";
      const fieldSelect = document.createElement("select");
      fieldSelect.dataset.pdfFieldProvenanceField = "1";
      fieldSelect.setAttribute("aria-label", "コピーするfield");
      fieldSelect.style.cssText = "min-height:44px;max-width:100%;font:14px sans-serif";
      const fieldCopy = document.createElement("button");
      fieldCopy.type = "button";
      fieldCopy.dataset.pdfFieldProvenanceCopyField = "1";
      fieldCopy.textContent = "このfieldのTraceをコピー";
      for (const button of [compactCopy, fullCopy, fieldCopy]) {
        button.style.cssText = "min-height:44px;padding:8px 12px;border:1px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;font:700 14px sans-serif;touch-action:manipulation";
      }
      controls.append(compactCopy, fullCopy, fieldSelect, fieldCopy);
      const feedback = document.createElement("div");
      feedback.dataset.pdfFieldProvenanceCopyFeedback = "1";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      const output = document.createElement("textarea");
      output.readOnly = true;
      output.setAttribute("aria-label", "PDF v3 field provenance JSON（短縮・完全版とも長押しでコピー可能）");
      output.style.cssText = "display:block;box-sizing:border-box;width:100%;min-height:120px;padding:8px;border:1px solid #94a3b8;border-radius:6px;background:#f8fafc;color:#0f172a;font:12px/1.4 monospace;user-select:text;-webkit-user-select:text";
      const updateFieldJson = () => {
        const compact = panel.compactTrace;
        const field = compact?.fields?.find((item) => item.field === fieldSelect.value);
        panel.fieldJson = field ? JSON.stringify({ ...compact, fields: [field],
          omittedFromCompact: { ...compact.omittedFromCompact, otherSelectedFields: compact.fields
            .filter((item) => item.field !== fieldSelect.value).map((item) => item.field) } }) : "";
      };
      const copy = async (mode) => {
        if (mode === "field") updateFieldJson();
        panel.dataset.pdfProvenanceView = mode;
        output.value = mode === "compact" ? panel.compactJson || "" :
          mode === "field" ? panel.fieldJson || "" : panel.fullJson || "";
        if (!output.value) return;
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
          await navigator.clipboard.writeText(output.value);
          feedback.textContent = mode === "compact" ? "短縮Traceをコピーしました" :
            mode === "field" ? "このfieldのTraceをコピーしました" : "完全版Traceをコピーしました";
        } catch {
          feedback.textContent = "自動コピーできませんでした。下のJSONを長押ししてコピーしてください";
          output.focus();
          output.select();
        }
      };
      compactCopy.addEventListener("click", () => copy("compact"));
      fullCopy.addEventListener("click", () => copy("full"));
      fieldCopy.addEventListener("click", () => copy("field"));
      fieldSelect.addEventListener("change", () => {
        updateFieldJson();
        if (panel.dataset.pdfProvenanceView === "field") output.value = panel.fieldJson;
      });
      panel.dataset.pdfProvenanceView = "compact";
      panel.append(title, state, run, controls, feedback, output);
      document.body.appendChild(panel);
    }
    const trace = getCertificatePdfFieldProvenance(snapshot?.diagnosticId);
    const ready = snapshot?.checkpoints?.some((item) => item.checkpoint === "FIELD_PROVENANCE_READY");
    const runId = String(snapshot?.diagnosticId ?? "-");
    if (panel.dataset.pdfProvenanceRunId !== runId) {
      panel.dataset.pdfProvenanceRunId = runId;
      panel.dataset.pdfProvenanceView = "compact";
      panel.querySelector("[data-pdf-field-provenance-copy-feedback]").textContent = "";
      panel.querySelector("[data-pdf-field-provenance-field]").replaceChildren();
    }
    panel.fullJson = trace ? JSON.stringify(trace, null, 2) : "";
    const compact = trace && ready ? projectCertificatePdfFieldProvenanceCompact(trace, snapshot) : null;
    panel.compactTrace = compact;
    panel.compactJson = compact ? JSON.stringify(compact) : "";
    const fieldSelect = panel.querySelector("[data-pdf-field-provenance-field]");
    if (compact && !fieldSelect.children.length) {
      for (const field of compact.fields.filter((item) => item.observed !== false)) {
        const option = document.createElement("option");
        option.value = field.field;
        option.textContent = field.field;
        fieldSelect.appendChild(option);
      }
      fieldSelect.value = compact.fields.some((item) => item.field === "vehicleWeightKg" && item.observed !== false) ?
        "vehicleWeightKg" : fieldSelect.children[0]?.value || "";
    }
    const selectedField = compact?.fields?.find((item) => item.field === fieldSelect.value);
    panel.fieldJson = selectedField ? JSON.stringify({ ...compact, fields: [selectedField],
      omittedFromCompact: { ...compact.omittedFromCompact, otherSelectedFields: compact.fields
        .filter((item) => item.field !== fieldSelect.value).map((item) => item.field) } }) : "";
    const output = panel.querySelector("textarea");
    output.value = panel.dataset.pdfProvenanceView === "full" ? panel.fullJson :
      panel.dataset.pdfProvenanceView === "field" ? panel.fieldJson : panel.compactJson;
    panel.querySelector("[data-pdf-field-provenance-state]").textContent = `Trace状態: ${ready ? "FIELD_PROVENANCE_READY" : snapshot ? "解析中" : "PDF選択待ち"}`;
    panel.querySelector("[data-pdf-field-provenance-run]").textContent = `Run: ${snapshot?.runId ?? "-"} / Diagnostic: ${snapshot?.diagnosticId ?? "-"}`;
    panel.querySelector("[data-pdf-field-provenance-copy-compact]").disabled = !compact || !ready;
    panel.querySelector("[data-pdf-field-provenance-copy-full]").disabled = !trace || !ready;
    panel.querySelector("[data-pdf-field-provenance-copy-field]").disabled = !panel.fieldJson || !ready;
    if (!trace || !ready) panel.querySelector("[data-pdf-field-provenance-copy-feedback]").textContent = "";
  } catch {
    // Diagnostic UI must never change PDF processing or its terminal state.
  }
}

export function removeCertificatePdfFieldProvenanceUi() {
  try { document.querySelector(PANEL_SELECTOR)?.remove(); } catch {}
}
