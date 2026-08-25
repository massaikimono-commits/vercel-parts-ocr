import CertificateFastBaseReader from "../certificate-fast-base-reader";
import CertificateUserNameGuard from "../certificate-user-name-guard";
import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateOcrPipelineController from "../certificate-ocr-pipeline-controller";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. The fast base reader intercepts the legacy page file-change handler so the old ~39 sequential
//    cell OCR calls do not run. It performs one full-document OCR pass (two only when the first is poor).
// 2. QR and the full-text parser populate fields from that shared evidence. The lightweight lower-six
//    QR fallback is the only automatic QR retry; the old broad K0/K2 identity rescan is intentionally
//    not mounted because unresolved identity fields are cheaper and safer to hand to v13 OCR.
// 3. The pipeline controller validates the populated core fields. v6 runs only as a true fallback.
// 4. v7 -> v8 -> v9 run in order without extra OCR, then v13 re-reads only unresolved weak cells.
// 5. The user-name guard remembers a safe complete name during the current read and prevents a later
//    empty/stub result from erasing it.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFastBaseReader />
      <CertificateUserNameGuard />
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateOcrPipelineController />
      <CertificateTestSummary />
    </>
  );
}
