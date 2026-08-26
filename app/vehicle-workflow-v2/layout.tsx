import CertificateReplayBarrier from "../certificate-replay-barrier";
import CertificateFastBaseReader from "../certificate-fast-base-reader";
import CertificateUserNameGuard from "../certificate-user-name-guard";
import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateK3QrRecoveryV6 from "../certificate-k3-qr-recovery-v6";
import CertificateCriticalCellsV5 from "../certificate-critical-cells-v5";
import CertificateTargetedBandRecoveryV15 from "../certificate-targeted-band-recovery-v15";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is decoded first with the quick two-sweep reader.
// 2. If K3/32 is missing, v6 rechecks only missed QR slots with ZXing TRY_HARDER.
// 3. The base reader performs zero OCR passes and waits for structured QR evidence.
// 4. v16 reads only remaining fixed bands/cells.
// 5. v5 reads only still-missing critical cells: exact issue-date and record-date value cells plus the dimension row for kei height.
//    Date eras are accepted directly when read, or inferred only when a numeric date has one unique chronology-consistent era between first registration and expiry.
// 6. v4 and older date/height fallback stacks remain unmounted to avoid repeated OCR and state races.
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
      <CertificateK3QrRecoveryV6 />
      <CertificateTargetedBandRecoveryV15 />
      <CertificateCriticalCellsV5 />
      <CertificateTestSummary />
    </>
  );
}
