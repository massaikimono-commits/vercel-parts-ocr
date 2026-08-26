import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateFocusedRecovery from "../certificate-focused-recovery";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateRecordDateGuard from "../certificate-record-date-guard";
import CertificateRegistrationDateGuard from "../certificate-registration-date-guard";
import CertificatePdfRowCorrector from "../certificate-pdf-row-corrector";

// Vehicle certificate post-processing for /vehicle-workflow-v2.
// Keep QR and the main OCR as the primary sources. Expensive legacy OCR passes that re-read
// dates/body/registration/chassis are intentionally not mounted; focused guards run only when needed.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificatePdfRowCorrector />
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateFocusedRecovery />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateRecordDateGuard />
      <CertificateRegistrationDateGuard />
    </>
  );
}
