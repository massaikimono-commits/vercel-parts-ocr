"use client";

import { useEffect, useState } from "react";
import {
  clearCertificateTransferImage,
  consumeCertificateTransferImage,
} from "./guided-capture/certificate-transfer";

export default function GuidedCertificateTransferConsumer() {
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fail = (message: string) => {
      if (cancelled) return;
      setErrorMessage(message);
      sessionStorage.setItem("guided-certificate-transfer-error", message);
    };

    const handoff = async () => {
      const file = await consumeCertificateTransferImage();
      if (!file || cancelled) return;

      const attach = () => {
        if (cancelled) return true;
        const input = document.querySelector<HTMLInputElement>('input[type="file"]');
        if (!input) return false;
        try {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          clearCertificateTransferImage();
          sessionStorage.removeItem("guided-certificate-transfer-error");
          return true;
        } catch {
          fail("Guided Capture画像を自動で渡せませんでした。撮影画像は一時保存したままです。Safariを再読み込みするか、通常の写真選択を利用してください。");
          return true;
        }
      };

      if (attach()) return;
      observer = new MutationObserver(() => {
        if (attach()) observer?.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(() => {
        observer?.disconnect();
        fail("車検証の画像入力を見つけられませんでした。撮影画像は一時保存したままです。画面を再読み込みしてもう一度お試しください。");
      }, 5000);
    };

    void handoff();
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!errorMessage) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: 10,
        right: 10,
        bottom: 12,
        zIndex: 10000,
        maxWidth: 720,
        margin: "0 auto",
        padding: "12px 14px",
        border: "1px solid #e4b648",
        borderRadius: 12,
        background: "#fff8dd",
        color: "#6b5313",
        boxShadow: "0 8px 30px #0002",
        fontWeight: 800,
        lineHeight: 1.5,
      }}
    >
      {errorMessage}
    </div>
  );
}
