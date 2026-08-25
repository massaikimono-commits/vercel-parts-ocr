import CertificateReplayBarrier from "../certificate-replay-barrier";
import CertificateFastBaseReader from "../certificate-fast-base-reader";
import CertificateUserNameGuard from "../certificate-user-name-guard";
import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateK3QrRecoveryV3 from "../certificate-k3-qr-recovery-v3";
import CertificateKeiHeightRecoveryV1 from "../certificate-kei-height-recovery-v1";
import CertificateTargetedBandRecoveryV15 from "../certificate-targeted-band-recovery-v15";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is decoded first with the quick two-sweep reader.
// 2. If K3/32 alone is missing, one lower QR-strip pass recovers only that structured block.
// 3. The base reader performs zero OCR passes and only waits for structured QR evidence.
// 4. v16 (routed through the v15 mount) reads at most four fixed bands/cells for QR gaps.
// 5. If a kei height is still blank/out-of-range, only the height area receives one extra OCR pass.
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
      <CertificateK3QrRecoveryV3 />
      <CertificateTargetedBandRecoveryV15 />
      <CertificateKeiHeightRecoveryV1 />
      <CertificateTestSummary />
    </>
  );
}
