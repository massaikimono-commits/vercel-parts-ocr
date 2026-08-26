"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function isKeiItem(item) {
  const f = String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((x) => x.trim());
  return f[0] === "K";
}

export default function CertificateKeiBaseline() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2" && location.pathname !== "/vehicle-workflow-fast") return;
    let stopped = false;
    let sent = false;

    const reset = (event) => {
      const node = event.target;
      if (!(node instanceof HTMLInputElement) || node.type !== "file") return;
      const section = node.closest("section.card");
      if (!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る")) return;
      sent = false;
    };

    const tick = () => {
      if (stopped || sent) return;
      const items = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      if (!items.some(isKeiItem)) return;
      const patch = { vehicleClass: "軽自動車" };
      window.__vehicleCertificateQrPriority = {
        ...(window.__vehicleCertificateQrPriority || {}),
        ...patch,
      };
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
      sent = true;
    };

    document.addEventListener("change", reset, true);
    const timer = window.setInterval(tick, 250);
    tick();
    return () => {
      stopped = true;
      document.removeEventListener("change", reset, true);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
