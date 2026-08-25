import CertificateReplayBarrier from "../certificate-replay-barrier";
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
// 1. Internal v6/v13 replay events are blocked from the legacy React file handler so they cannot
//    restart the old ~39-pass OCR. The fast base reader handles the real user file selection once.
// 2. The fast base reader performs one full-document OCR pass (two only when the first is poor).
// 3. QR and the full-text parser populate fields from that shared evidence. The lightweight lower-six
//    QR fallback is the only automatic QR retry; the old broad K0/K2 identity rescan is intentionally
//    not mounted because unresolved identity fields are cheaper and safer to hand to v13 OCR.
// 4. The pipeline controller validates the populated core fields. v6 runs only as a true fallback.
// 5. v7 -> v8 -> v9 run in order without extra OCR, then v13 re-reads only unresolved weak cells.
// 6. The user-name guard remembers a safe complete name during the current read and prevents a later
//    empty/stub result from erasing it.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateReplayBarrier />
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
