"use client";

import { useLayoutEffect } from "react";
import { beginPdfRun, hasPdfRunMark } from "./certificate-pdf-run-identity";

export default function CertificatePdfRunOwner() {
  useLayoutEffect(() => {
    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !(file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))) return;
      if (hasPdfRunMark(event)) return;
      beginPdfRun(event);
    };
    window.addEventListener("change", onChange, true);
    return () => window.removeEventListener("change", onChange, true);
  }, []);
  return null;
}
