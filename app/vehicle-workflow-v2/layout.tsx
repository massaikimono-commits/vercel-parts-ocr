import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateFinalCalibration from "../certificate-final-calibration";
import CertificateMicroCellsFix from "../certificate-micro-cells-fix";
import CertificateAuthoritativeFix from "../certificate-authoritative-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateFinalCalibration />
      <CertificateMicroCellsFix />
      <CertificateAuthoritativeFix />
    </>
  );
}
