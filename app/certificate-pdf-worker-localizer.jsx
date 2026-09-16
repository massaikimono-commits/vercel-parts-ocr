"use client";

import { useLayoutEffect } from "react";

export default function CertificatePdfWorkerLocalizer() {
  useLayoutEffect(() => {
    let cancelled = false;

    void import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
