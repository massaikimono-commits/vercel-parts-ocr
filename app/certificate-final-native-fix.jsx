"use client";

import { useEffect, useState } from "react";
import CertificateAuthoritativeReaderV2 from "./certificate-authoritative-reader-v2";
import CertificateReactPropsDebug from "./certificate-react-props-debug";

export default function CertificateFinalNativeFix() {
  const [pathname, setPathname] = useState("");

  useEffect(() => {
    setPathname(location.pathname);
  }, []);

  // /vehicle-workflow-v2 uses QR first and focused field fallbacks only.
  // Keep the legacy reread available on other routes until those screens are migrated too.
  if (!pathname || pathname === "/vehicle-workflow-v2") return null;

  return (
    <>
      <CertificateAuthoritativeReaderV2 />
      <CertificateReactPropsDebug />
    </>
  );
}
