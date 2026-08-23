import CertificateRowPriorityFix from "../certificate-row-priority-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateRowPriorityFix />
    </>
  );
}
