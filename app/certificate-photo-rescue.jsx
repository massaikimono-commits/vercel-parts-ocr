"use client";

import { usePathname } from "next/navigation";
import CertificatePhotoDerivedV2 from "./certificate-photo-derived-v2";
import CertificatePhotoCriticalOcrV2 from "./certificate-photo-critical-ocr-v2";

export default function CertificatePhotoRescue() {
  const pathname = usePathname();
  if (pathname === "/vehicle-workflow-v2" || pathname === "/vehicle-workflow-fast") return null;
  return (
    <>
      <CertificatePhotoDerivedV2 />
      <CertificatePhotoCriticalOcrV2 />
    </>
  );
}
