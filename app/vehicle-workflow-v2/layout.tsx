import CertificateReplayBarrier from "../certificate-replay-barrier";
import CertificateFastBaseReader from "../certificate-fast-base-reader";
import CertificateUserNameGuard from "../certificate-user-name-guard";
import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateK3QrRecoveryV6 from "../certificate-k3-qr-recovery-v6";
import CertificateKeiHeightGuardV4 from "../certificate-kei-height-guard-v4";
import CertificateMissingDatesV1 from "../certificate-missing-dates-v1";
import CertificateDatePartialRecoveryV1 from "../certificate-date-partial-recovery-v1";
import CertificateTargetedBandRecoveryV15 from "../certificate-targeted-band-recovery-v15";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is decoded first with the quick two-sweep reader.
// 2. If K3/32 is missing, v6 pauses later OCR briefly and rechecks only missed QR slots with ZXing TRY_HARDER.
// 3. The base reader performs zero OCR passes and only waits for structured QR evidence.
// 4. v16 starts after K3 recovery and reads only remaining fixed bands/cells.
// 5. If record/registration dates are still blank, v5 reads only those cells in one composite pass.
// 6. A conservative zero-OCR guard can restore a month dropped by OCR only when the date label/year and first-registration month agree.
// 7. For kei vehicles, impossible height values are rejected and v9 reads the width/height band once while accepting common OCR digit confusions.
// 8. Legacy heavy OCR stacks remain unmounted.
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
      <CertificateMissingDatesV1 />
      <CertificateDatePartialRecoveryV1 />
      <CertificateKeiHeightGuardV4 />
      <CertificateTestSummary />
    </>
  );
}
