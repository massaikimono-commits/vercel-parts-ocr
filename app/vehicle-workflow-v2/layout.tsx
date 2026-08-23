import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateTopBandFix from "../certificate-top-band-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateTopBandFix />
    </>
  );
}
