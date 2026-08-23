import type { ReactNode } from "react";

const linkStyle = {
  display: "block",
  textAlign: "center" as const,
  textDecoration: "none",
  border: "1px solid #cdd7e5",
  borderRadius: 14,
  padding: "12px 10px",
  background: "#fff",
  color: "#2674e8",
  fontWeight: 800,
};

export default function OCRLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div style={{ maxWidth: 980, margin: "14px auto 0", padding: "0 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <a href="/ocr/auto" style={{ ...linkStyle, background: "#2f6fe4", color: "#fff", borderColor: "#2f6fe4" }}>
            ✨ 自動判定OCR
          </a>
          <a href="/ocr" style={linkStyle}>
            大一用品商会 専用OCR
          </a>
          <a href="/ocr/general" style={linkStyle}>
            汎用A4・他社伝票OCR
          </a>
        </div>
      </div>
      {children}
    </>
  );
}
