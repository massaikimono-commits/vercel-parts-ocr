import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateFinalCalibration from "../certificate-final-calibration";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateFinalCalibration />
    </>
  );
}
