import VehicleCertificateRouteEnhancers from "../vehicle-certificate-route-enhancers";

export default function VehicleWorkflowFastLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VehicleCertificateRouteEnhancers />
    </>
  );
}
