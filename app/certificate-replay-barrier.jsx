"use client";

import { useEffect } from "react";

export default function CertificateReplayBarrier() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    const onChange = event => {
      if (!event.__certificatePipelineReplay && !event.__certificateV13Replay) return;
      // Internal replay events still reach other listeners attached on document (v6/v13),
      // but must not continue down to React's delegated file-input handler, which would
      // restart the old ~39-pass certificate OCR.
      event.stopPropagation();
    };

    document.addEventListener("change", onChange, true);
    return () => document.removeEventListener("change", onChange, true);
  }, []);

  return null;
}
