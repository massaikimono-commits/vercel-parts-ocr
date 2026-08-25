import CertificateReplayBarrier from "../certificate-replay-barrier";
import CertificateFastBaseReader from "../certificate-fast-base-reader";
import CertificateUserNameGuard from "../certificate-user-name-guard";
import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateTargetedBandRecoveryV15 from "../certificate-targeted-band-recovery-v15";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is decoded first with the quick two-sweep reader.
// 2. The base reader performs zero OCR passes and only waits for structured QR evidence.
// 3. v15 reads at most four fixed bands/cells to fill only the information QR could not provide.
// 4. Legacy v6/v7/v8/v9 and the 27-cell v14 recovery are intentionally not mounted here.
// 5. Safety guards remain mounted so later state updates cannot overwrite trusted values.
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
      <CertificateTargetedBandRecoveryV15 />
      <CertificateTestSummary />
    </>
  );
}
