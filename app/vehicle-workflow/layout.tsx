import VehicleCertificateRouteEnhancers from "../vehicle-certificate-route-enhancers";

export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VehicleCertificateRouteEnhancers />
    </>
  );
}
