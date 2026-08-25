import CertificateFulltextFix from "../certificate-fulltext-fix";
import CertificateClassificationNumberGuard from "../certificate-classification-number-guard";
import CertificateRegistrationNumberGuard from "../certificate-registration-number-guard";
import CertificateChassisNumberGuard from "../certificate-chassis-number-guard";
import CertificateEngineModelQrGuard from "../certificate-engine-model-qr-guard";
import CertificateIdentityQrRecovery from "../certificate-identity-qr-recovery";
import CertificateLayoutRecognitionV6 from "../certificate-layout-recognition-v6";
import CertificateLayoutConsolidationV7 from "../certificate-layout-consolidation-v7";
import CertificateEvidenceSafetyV8 from "../certificate-evidence-safety-v8";
import CertificateExistingEvidenceV9 from "../certificate-existing-evidence-v9";
import CertificateTargetedCellRecoveryV12 from "../certificate-targeted-cell-recovery-v12";
import CertificateTestSummary from "../certificate-test-summary";

// Vehicle certificate recognition pipeline for /vehicle-workflow-v2:
// 1. QR is authoritative whenever available.
// 2. Shared OCR v6 finds semantically valid labels, detects ruled cells, and re-reads only
//    the necessary cell/right/below neighbours.
// 3. v7 does not run more OCR. It consolidates already-existing OCR evidence.
// 4. v8 is a final no-extra-OCR safety layer. It rescues only strongly structured evidence
//    and clears incomplete/unsupported values instead of guessing.
// 5. v9 reuses only existing OCR diagnostics to recover model-consistent chassis codes and
//    complete user-company names; it never runs additional OCR or injects sample values.
// 6. v12 is a conditional fallback for unresolved chassis/user/engine fields. It locates the
//    printed field label first, then high-resolution OCRs only that label's right-hand value cell.
//    This follows the form geometry instead of fixed photo Y coordinates.
// 7. Field guards validate final values but never inject sample-specific values.
//
// Older field-specific OCR passes, layout v2/v3/v4/v5, and fixed-position v10/v11 fallbacks are intentionally not mounted.
export default function VehicleWorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CertificateFulltextFix />
      <CertificateClassificationNumberGuard />
      <CertificateIdentityQrRecovery />
      <CertificateLayoutRecognitionV6 />
      <CertificateRegistrationNumberGuard />
      <CertificateChassisNumberGuard />
      <CertificateEngineModelQrGuard />
      <CertificateLayoutConsolidationV7 />
      <CertificateEvidenceSafetyV8 />
      <CertificateExistingEvidenceV9 />
      <CertificateTargetedCellRecoveryV12 />
      <CertificateTestSummary />
    </>
  );
}
