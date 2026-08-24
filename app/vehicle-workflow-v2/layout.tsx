import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateMicroCellsFix from "../certificate-micro-cells-fix";
import CertificateAuthoritativeFix from "../certificate-authoritative-fix";
import CertificateTemplateRowV2 from "../certificate-template-row-v2";
import CertificateCriticalV3 from "../certificate-critical-v3";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateFocusedRecovery from "../certificate-focused-recovery";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateRecordDateGuard from "../certificate-record-date-guard";

// Vehicle certificate post-processing guards are mounted here for /vehicle-workflow-v2.
// The legacy final-calibration pass is intentionally not mounted: it repeated many OCR reads
// and could derive a registration area from address text.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateMicroCellsFix />
      <CertificateAuthoritativeFix />
      <CertificateTemplateRowV2 />
      <CertificateCriticalV3 />
      <CertificateClassificationNumberGuard />
      <CertificateFocusedRecovery />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateRecordDateGuard />
    </>
  );
}
