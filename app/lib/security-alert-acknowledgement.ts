"use client";

import { useEffect, useState } from "react";

export const SECURITY_ACK_KEY = "icb-security-alert-ack-v1";
type Alert = { alert_code: string; occurred_at: string | null; message: string };
export function securityAlertFingerprint(alert: Alert | null) {
  return alert ? [alert.alert_code, alert.occurred_at || "", alert.message].join("|") : "";
}

// Only the current event is acknowledged. A newer alert always remains visible.
export function useSecurityAlertAcknowledgement(alert: Alert | null) {
  const current = securityAlertFingerprint(alert);
  const [acknowledged, setAcknowledged] = useState("");
  useEffect(() => {
    const read = () => {
      try { setAcknowledged(localStorage.getItem(SECURITY_ACK_KEY) || ""); } catch {}
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [current]);
  function acknowledge() {
    if (!current) return;
    try { localStorage.setItem(SECURITY_ACK_KEY, current); } catch { return; }
    setAcknowledged(current);
  }
  return { acknowledged: Boolean(current && acknowledged === current), acknowledge };
}
