"use client";

import { useEffect } from "react";
import { consumeCertificateTransferImage } from "./guided-capture/certificate-transfer";

export default function GuidedCertificateTransferConsumer() {
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
          return true;
        } catch {
          sessionStorage.setItem("guided-certificate-transfer-error", "撮影画像を自動で渡せませんでした。通常の写真選択から続けてください。");
          return true;
        }
      };

      if (attach()) return;
      observer = new MutationObserver(() => {
        if (attach()) observer?.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(() => observer?.disconnect(), 5000);
    };

    void handoff();
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
