import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateLayoutRecognitionV5 from "../certificate-layout-recognition-v5";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is authoritative whenever available.
// 2. Shared OCR v5 filters label candidates by document semantics before spatial consensus,
//    tightens ruled-table columns, and re-reads only the preferred value cell.
// 3. Plate-region correction uses only OCR text from the registration-number cell and a
//    registration-region vocabulary; customer addresses are never used to infer a plate.
// 4. Field guards validate values but never inject sample-specific values.
//
// Older field-specific OCR passes and layout v2/v3/v4 are intentionally not mounted here.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateIdentityQrRecovery />
      <CertificateLayoutRecognitionV5 />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateTestSummary />
    </>
  );
}
