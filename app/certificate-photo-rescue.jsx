"use client";

import CertificatePhotoDerivedV2 from "./certificate-photo-derived-v2";
import CertificatePhotoCriticalOcrV2 from "./certificate-photo-critical-ocr-v2";

export default function CertificatePhotoRescue() {
  return (
    <>
      <CertificatePhotoDerivedV2 />
      <CertificatePhotoCriticalOcrV2 />
    </>
  );
}
