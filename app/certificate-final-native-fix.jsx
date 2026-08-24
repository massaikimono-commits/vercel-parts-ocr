"use client";

import CertificateAuthoritativeReaderV2 from "./certificate-authoritative-reader-v2";
import CertificatePostOcrStateLock from "./certificate-post-ocr-state-lock";
import CertificateReactPropsDebug from "./certificate-react-props-debug";

export default function CertificateFinalNativeFix() {
  return (
    <>
      <CertificateAuthoritativeReaderV2 />
      <CertificatePostOcrStateLock />
      <CertificateReactPropsDebug />
    </>
  );
}
