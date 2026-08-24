import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateLayoutRecognitionV4 from "../certificate-layout-recognition-v4";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is authoritative whenever available.
// 2. Shared OCR v4 validates label meaning, infers ruled-cell boundaries from neighboring
//    labels, then re-reads only the value cell across multiple image variants.
// 3. Field guards validate values but never infer identity data from addresses or sample-specific values.
//
// Older field-specific OCR passes and layout v2/v3 are intentionally not mounted here.
// Keeping one OCR fallback avoids duplicate workers on iPhone Safari and keeps the same
// recognition foundation reusable by parts slips.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateIdentityQrRecovery />
      <CertificateLayoutRecognitionV4 />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateTestSummary />
    </>
  );
}
