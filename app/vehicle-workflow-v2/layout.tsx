import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateLayoutRecognitionV6 from "../certificate-layout-recognition-v6";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is authoritative whenever available.
// 2. Shared OCR v6 finds semantically valid labels, detects the actual ruled cell around
//    each label from image lines, then re-reads only that cell/right/below neighbour.
// 3. Values need support from multiple image variants before being committed.
// 4. Plate-region correction uses only OCR text from the registration-number cell and a
//    registration-region vocabulary; customer addresses are never used to infer a plate.
// 5. Field guards validate values but never inject sample-specific values.
//
// Older field-specific OCR passes and layout v2/v3/v4/v5 are intentionally not mounted here.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateIdentityQrRecovery />
      <CertificateLayoutRecognitionV6 />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateTestSummary />
    </>
  );
}
