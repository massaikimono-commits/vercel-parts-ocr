"use client";

import CertificateSingleReadLock from "./certificate-single-read-lock";
import CertificateAuthoritativeReaderV2 from "./certificate-authoritative-reader-v2";
import CertificatePostOcrStateLock from "./certificate-post-ocr-state-lock";

export default function CertificateFinalNativeFix() {
  return (
    <>
      <CertificateSingleReadLock />
      <CertificateAuthoritativeReaderV2 />
      <CertificatePostOcrStateLock />
    </>
  );
}
