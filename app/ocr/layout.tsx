import type { ReactNode } from "react";

export default function OCRLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div style={{ maxWidth: 980, margin: "14px auto 0", padding: "0 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <a
            href="/ocr"
            style={{
              display: "block",
              textAlign: "center",
              textDecoration: "none",
              border: "1px solid #cdd7e5",
              borderRadius: 14,
              padding: "12px 10px",
              background: "#fff",
              color: "#2674e8",
              fontWeight: 800,
            }}
          >
            大一用品商会 専用OCR
          </a>
          <a
            href="/ocr/general"
            style={{
              display: "block",
              textAlign: "center",
              textDecoration: "none",
              border: "1px solid #cdd7e5",
              borderRadius: 14,
              padding: "12px 10px",
              background: "#fff",
              color: "#2674e8",
              fontWeight: 800,
            }}
          >
            汎用A4・他社伝票OCR
          </a>
        </div>
      </div>
      {children}
    </>
  );
}
