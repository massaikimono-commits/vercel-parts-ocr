"use client";

import CertificateAuthoritativeReaderV2 from "./certificate-authoritative-reader-v2";
import CertificatePostOcrAuthoritativeReplay from "./certificate-post-ocr-authoritative-replay";

export default function CertificateFinalNativeFix() {
  return (
    <>
      <CertificateAuthoritativeReaderV2 />
      <CertificatePostOcrAuthoritativeReplay />
    </>
  );
}
