import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateRecordDateGuard from "../certificate-record-date-guard";
import CertificateRegistrationDateGuard from "../certificate-registration-date-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateIdentityOcrFallback from "../certificate-identity-ocr-fallback";

// Vehicle certificate post-processing for /vehicle-workflow-v2.
// QR is the primary source. OCR fallbacks are restricted to unresolved fields only;
// broad legacy re-reads are intentionally not mounted.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateRecordDateGuard />
      <CertificateRegistrationDateGuard />
      <CertificateIdentityQrRecovery />
      <CertificateIdentityOcrFallback />
    </>
  );
}
