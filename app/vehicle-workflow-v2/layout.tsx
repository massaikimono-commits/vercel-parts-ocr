import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateTopCellsFix from "../certificate-top-cells-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateTopCellsFix />
    </>
  );
}
