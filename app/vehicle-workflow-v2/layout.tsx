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

// Vehicle certificate post-processing for /vehicle-workflow-v2.
// Native PDF v2 is mounted first so QR-less PDFs can be consumed directly before legacy OCR hooks.
// QR PDFs and weak/image PDFs are passed through to the existing QR/OCR pipeline.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
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
