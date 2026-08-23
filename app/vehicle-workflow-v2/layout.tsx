import CertificateFulltextFix from "../certificate-fulltext-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
    </>
  );
}
