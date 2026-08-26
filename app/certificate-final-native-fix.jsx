"use client";

import { usePathname } from "next/navigation";
import CertificateAuthoritativeReaderV2 from "./certificate-authoritative-reader-v2";
import CertificateReactPropsDebug from "./certificate-react-props-debug";

export default function CertificateFinalNativeFix() {
  const pathname = usePathname();
  // vehicle-workflow-v2 is the production fast path. It already owns photo OCR
  // and PDF native events, so the old 30+ pass post-OCR reader must not run here.
  if (pathname === "/vehicle-workflow-v2" || pathname === "/vehicle-workflow-fast") {
    return null;
  }
  return (
    <>
      <CertificateAuthoritativeReaderV2 />
      <CertificateReactPropsDebug />
    </>
  );
}
