import CertificateGeometryFix from "../certificate-geometry-fix";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateGeometryFix />
    </>
  );
}
