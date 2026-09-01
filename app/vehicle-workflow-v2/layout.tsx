import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateFocusedRecovery from "../certificate-focused-recovery";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateRecordDateGuard from "../certificate-record-date-guard";
import CertificateRegistrationDateGuard from "../certificate-registration-date-guard";
import CertificatePdfRowCorrector from "../certificate-pdf-row-corrector";
import CertificatePdfNativeReaderV2 from "../certificate-pdf-native-reader-v2";
import CertificatePdfStructuredReaderV3 from "../certificate-pdf-structured-reader-v3";

// Vehicle certificate post-processing for /vehicle-workflow-v2.
// Structured PDF v3 gets the first chance: QR-less PDFs with a healthy text layer are
// parsed as table rows and finish at OCR 0pass. QR PDFs or weak/image PDFs are then
// handed to v2 / the existing QR + OCR pipeline.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CertificatePdfStructuredReaderV3 />
      <CertificatePdfNativeReaderV2 />
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
