import VehicleCertificateRouteEnhancers from "../vehicle-certificate-route-enhancers";

export default function VehicleWorkflowV3Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <VehicleCertificateRouteEnhancers />
    </>
  );
}
