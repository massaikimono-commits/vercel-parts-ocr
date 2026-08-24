"use client";

// The experimental six-code QR fallback was intentionally disabled because
// its wide multi-pass canvas scan can starve iPhone Safari while the main OCR
// is running. The normal certificate QR reader remains enabled. We will bring
// six-code support back as a lightweight post-OCR scan instead of competing
// with OCR for memory/CPU.
export default function CertificateQrLowerSixFallback() {
  return null;
}
