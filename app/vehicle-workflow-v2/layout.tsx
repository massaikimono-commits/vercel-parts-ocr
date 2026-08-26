import CertificateReplayBarrier from "../certificate-replay-barrier";
import CertificateFastBaseReader from "../certificate-fast-base-reader";
import CertificateUserNameGuard from "../certificate-user-name-guard";
import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateK3QrRecoveryV6 from "../certificate-k3-qr-recovery-v6";
import CertificateKeiHeightGuardV3 from "../certificate-kei-height-guard-v3";
import CertificateTargetedBandRecoveryV15 from "../certificate-targeted-band-recovery-v15";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is decoded first with the quick two-sweep reader.
// 2. If K3/32 is missing, v6 pauses the later OCR briefly and rechecks only the missed physical QR slot with ZXing TRY_HARDER.
// 3. The base reader performs zero OCR passes and only waits for structured QR evidence.
// 4. v16 (routed through the v15 mount) starts after K3 recovery and reads only remaining fixed bands/cells.
// 5. For kei vehicles, impossible height values are rejected and v3 reads only the width/height cells once.
// 6. Legacy heavy OCR stacks remain unmounted.
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
      <CertificateKeiHeightGuardV3 />
      <CertificateTestSummary />
    </>
  );
}
