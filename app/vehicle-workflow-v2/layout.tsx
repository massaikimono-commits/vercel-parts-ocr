import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateLayoutRecognitionV2 from "../certificate-layout-recognition-v2";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is authoritative whenever available.
// 2. One shared label-anchored OCR engine finds labels dynamically and reads only unresolved values.
// 3. Field guards validate values but never infer identity data from unrelated fields such as addresses.
//
// Old field-specific Tesseract passes are intentionally not mounted here. Keeping one OCR fallback
// avoids duplicate workers on iPhone Safari and makes the same recognition engine reusable by parts slips.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateIdentityQrRecovery />
      <CertificateLayoutRecognitionV2 />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateTestSummary />
    </>
  );
}
