import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateFocusedRecovery from "../certificate-focused-recovery";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateRecordDateGuard from "../certificate-record-date-guard";
import CertificateRegistrationDateGuard from "../certificate-registration-date-guard";
import CertificatePdfRowCorrector from "../certificate-pdf-row-corrector";
import CertificatePdfNativeReaderV2 from "../certificate-pdf-native-reader-v2";
import CertificatePdfStructuredReaderV3 from "../certificate-pdf-structured-reader-v3";
import CertificatePdfV3CompletionGuard from "../certificate-pdf-v3-completion-guard";
import CertificatePdfInspectionRecordAdapter from "../certificate-pdf-inspection-record-adapter";
import CertificatePdfSemanticRecovery from "../certificate-pdf-semantic-recovery";
import CertificateOwnerSemantics from "../certificate-owner-semantics";
import CertificateOwnerFieldsUi from "../certificate-owner-fields-ui";
import CertificatePdfWorkerLocalizer from "../certificate-pdf-worker-localizer";
import VehicleCertificateRouteEnhancers from "../vehicle-certificate-route-enhancers";

// Vehicle certificate post-processing for /vehicle-workflow-v2.
// Candidate-only inspection-record recovery is mounted before the adapter so it can
// retain a private PDF copy before the input is cleared. It only merges values recovered
// from their own semantic columns and never sources vehicle weights from axle weights.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CertificatePdfWorkerLocalizer />
      <CertificatePdfV3CompletionGuard />
      <CertificatePdfSemanticRecovery />
      <CertificatePdfInspectionRecordAdapter />
      <CertificatePdfStructuredReaderV3 />
      <CertificatePdfNativeReaderV2 />
      <CertificateOwnerSemantics />
      <CertificateOwnerFieldsUi />
      {children}
      <CertificatePdfRowCorrector />
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateFocusedRecovery />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateRecordDateGuard />
      <CertificateRegistrationDateGuard />
      <VehicleCertificateRouteEnhancers />
    </>
  );
}
