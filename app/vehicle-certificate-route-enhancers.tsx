import CertificatePriorityFix from "./certificate-priority-fix";
import CertificateEssentialFieldsFix from "./certificate-essential-fields-fix";
import CertificateRowPriorityFix from "./certificate-row-priority-fix";
import CertificateFuelClassificationFix from "./certificate-fuel-classification-fix";
import CertificateChassisCorrectionFix from "./certificate-chassis-correction-fix";
import CertificateConsistencyFix from "./certificate-consistency-fix";
import CertificatePdfNativeReader from "./certificate-pdf-native-reader";
import CertificatePdfBridge from "./certificate-pdf-bridge";
import CertificateQrFast from "./certificate-qr-fast";
import CertificateQrRescue from "./certificate-qr-rescue";
import CertificateQrLowerSixFallback from "./certificate-qr-lower-six-fallback";
import CertificateKeiBaseline from "./certificate-kei-baseline";
import CertificateQrApply from "./certificate-qr-apply-fixed";
import CertificatePhotoRescue from "./certificate-photo-rescue";
import CertificateFinalNativeFix from "./certificate-final-native-fix";
import GuidedCertificateTransferConsumer from "./guided-certificate-transfer-consumer";

// Common vehicle-certificate enhancement stack.
// This component is mounted only by vehicle-workflow route layouts so schedule,
// customer, loaner and other normal screens do not load the certificate helpers.
export default function VehicleCertificateRouteEnhancers() {
  return (
    <>
      <GuidedCertificateTransferConsumer />
      <CertificatePriorityFix />
      <CertificateEssentialFieldsFix />
      <CertificateRowPriorityFix />
      <CertificateFuelClassificationFix />
      <CertificateChassisCorrectionFix />
      <CertificateConsistencyFix />
      <CertificatePdfNativeReader />
      <CertificatePdfBridge />
      <CertificateQrFast />
      <CertificateQrRescue />
      <CertificateQrLowerSixFallback />
      <CertificateKeiBaseline />
      <CertificateQrApply />
      <CertificatePhotoRescue />
      <CertificateFinalNativeFix />
    </>
  );
}
