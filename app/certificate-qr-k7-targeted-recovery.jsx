"use client";

// K7 is now covered by the unified quick QR reader. This legacy targeted pass stays
// mounted as a no-op so it cannot add another six ZXing decodes after the main scan.
export default function CertificateQrK7TargetedRecovery() {
  return null;
}
