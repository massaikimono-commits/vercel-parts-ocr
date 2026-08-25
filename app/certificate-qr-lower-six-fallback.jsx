"use client";

// QR recovery is now handled by certificate-qr-reader.jsx in at most two sweeps.
// Keeping this component mounted as a no-op avoids duplicate ZXing rescans on iPhone.
export default function CertificateQrLowerSixFallback() {
  return null;
}
