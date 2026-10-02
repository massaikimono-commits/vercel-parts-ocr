import CertificatePdfWorkerLocalizer from "../certificate-pdf-worker-localizer";
import CertificatePdfStructuredReaderV3 from "../certificate-pdf-structured-reader-v3";
import CertificatePdfNativeReaderV2 from "../certificate-pdf-native-reader-v2";
import CertificatePdfRunOwner from "../certificate-pdf-run-owner";
import CertificatePdfGeneralizationRecovery from "../certificate-pdf-generalization-recovery";
import VehicleCertificateRouteEnhancers from "../vehicle-certificate-route-enhancers";

export default function VehicleWorkflowFastLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CertificatePdfWorkerLocalizer />
      <CertificatePdfRunOwner />
      <CertificatePdfGeneralizationRecovery />
      <CertificatePdfStructuredReaderV3 />
      <CertificatePdfNativeReaderV2 />
      {children}
      <VehicleCertificateRouteEnhancers />
    </>
  );
}
