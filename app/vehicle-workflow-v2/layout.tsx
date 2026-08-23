import CertificateTemplateRowFix from "../certificate-template-row-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateTemplateRowFix />
    </>
  );
}
