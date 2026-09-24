import { isCertificatePdfStructuredFinal } from "./certificate-pdf-single-owner-contract.js";

// Keep the React form hydration semantics aligned with the PDF FINAL owner.
// Ordinary OCR/photo patches remain sparse merges: empty strings mean "no update".
// A structured-v3 FINAL patch is different: every own string field is authoritative,
// including an explicit empty slot resolved from '-' in the PDF structure.
export function mergeCertificatePatchIntoFields(currentFields = {}, patch = {}) {
  const next = { ...currentFields };
  const structuredFinal = isCertificatePdfStructuredFinal(patch);

  for (const [key, value] of Object.entries(patch || {})) {
    if (key.startsWith("__") || typeof value !== "string") continue;
    const normalized = value.trim();
    if (structuredFinal || normalized) next[key] = normalized;
  }

  return next;
}
