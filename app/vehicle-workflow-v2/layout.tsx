import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateOcrPipelineController from "../certificate-ocr-pipeline-controller";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR and the normal/base OCR run first.
// 2. The pipeline controller validates already-populated registration/date/weight/dimension fields.
//    If those core fields are coherent, the expensive generic v6 full-page/cell OCR is skipped.
//    If they are not coherent, v6 is replayed as a fallback for that vehicle only.
// 3. Only after the v6 decision/fallback has finished do the no-extra-OCR v7/v8/v9 stages run.
// 4. v13 is mounted from the start so it keeps the selected image, but it waits for the v6-ready
//    marker and then re-reads only unresolved chassis/user/engine cells.
// 5. Field guards validate final values but never inject sample-specific values.
//
// This keeps the recognition logic generic across vehicles while avoiding duplicate expensive OCR
// on certificates whose core fields were already read correctly by the base OCR/QR path.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateIdentityQrRecovery />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateOcrPipelineController />
      <CertificateTestSummary />
    </>
  );
}
