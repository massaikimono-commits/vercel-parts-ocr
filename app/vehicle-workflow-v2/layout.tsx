import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateFinalCalibration from "../certificate-final-calibration";
import CertificateMicroCellsFix from "../certificate-micro-cells-fix";
import CertificateAuthoritativeFix from "../certificate-authoritative-fix";
import CertificateTemplateRowV2 from "../certificate-template-row-v2";
import CertificateCriticalV3 from "../certificate-critical-v3";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateFinalCalibration />
      <CertificateMicroCellsFix />
      <CertificateAuthoritativeFix />
      <CertificateTemplateRowV2 />
      <CertificateCriticalV3 />
      <CertificateClassificationNumberGuard />
    </>
  );
}
