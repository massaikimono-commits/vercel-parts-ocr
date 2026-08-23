"use client";

import CertificateAuthoritativeReaderV2 from "./certificate-authoritative-reader-v2";
import CertificatePostOcrStateLock from "./certificate-post-ocr-state-lock";

export default function CertificateFinalNativeFix() {
  return (
    <>
      <CertificateAuthoritativeReaderV2 />
      <CertificatePostOcrStateLock />
    </>
  );
}
