import CertificateCalibratedFix from "../certificate-calibrated-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateCalibratedFix />
    </>
  );
}
