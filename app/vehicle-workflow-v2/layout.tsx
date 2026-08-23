import CertificateRowPriorityFix from "../certificate-row-priority-fix";
import CertificateFuelClassificationFix from "../certificate-fuel-classification-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateRowPriorityFix />
      <CertificateFuelClassificationFix />
    </>
  );
}
