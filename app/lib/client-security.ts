export function safeActionError(action: string, error?: unknown) {
  if (process.env.NODE_ENV !== "production" && error) {
    console.error("[icb]", action, error);
  }
  return `${action}を処理できませんでした。ログイン状態と通信環境を確認して、もう一度お試しください。`;
}

export function clearSensitiveLocalState() {
  try {
    localStorage.removeItem("parts-active-vehicle");
    localStorage.removeItem("parts-before-ocr-ids");

    const raw = localStorage.getItem("parts-data");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.map((part) => {
          if (!part || typeof part !== "object") return part;
          const {
            vehicleId: _vehicleId,
            vehicleNumber: _vehicleNumber,
            registration: _registration,
            chassis: _chassis,
            linkedAt: _linkedAt,
            ...rest
          } = part;
          return rest;
        });
        localStorage.setItem("parts-data", JSON.stringify(sanitized));
      }
    }
  } catch {
    // ログアウト自体は失敗させない。
  }
}
