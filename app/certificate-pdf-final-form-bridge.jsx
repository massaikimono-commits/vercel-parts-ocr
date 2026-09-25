"use client";

import { useLayoutEffect } from "react";
import { isCertificatePdfStructuredFinal } from "./certificate-pdf-single-owner-contract";

const AUTH_EVENT = "vehicle-certificate-authoritative";

// VehicleWorkflowFast historically treats empty strings as sparse/no-update values.
// structured-v3, however, can resolve an explicit '-' slot authoritatively. Preserve
// that distinction at the form-facing event boundary without changing photo/OCR merges.
export function bridgeCertificatePdfFinalForSparseForm(detail) {
  if (!isCertificatePdfStructuredFinal(detail) || !detail?.__genericStructuralEvidence) return detail;
  const evidence = detail.__genericStructuralEvidence;
  for (const groupName of ["vehicle", "axles", "specification"]) {
    const slots = evidence?.[groupName]?.slots;
    if (!slots) continue;
    for (const [key, slot] of Object.entries(slots)) {
      if (slot?.parsed && slot?.explicitEmpty && detail[key] === "") detail[key] = "-";
    }
  }
  return detail;
}

export default function CertificatePdfFinalFormBridge() {
  useLayoutEffect(() => {
    const onAuthority = (event) => {
      try { bridgeCertificatePdfFinalForSparseForm(event?.detail); } catch {}
    };
    // Layout effect is registered before the form's normal useEffect AUTH consumer.
    window.addEventListener(AUTH_EVENT, onAuthority);
    return () => window.removeEventListener(AUTH_EVENT, onAuthority);
  }, []);
  return null;
}
