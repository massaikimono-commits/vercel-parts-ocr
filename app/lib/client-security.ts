export function safeActionError(action: string, error?: unknown) {
  if (process.env.NODE_ENV !== "production" && error) {
    console.error("[icb]", action, error);
  }
  return `${action}を処理できませんでした。ログイン状態と通信環境を確認して、もう一度お試しください。`;
}

export function clearSensitiveLocalState() {
  try {
    sessionStorage.removeItem("parts-active-vehicle");
    sessionStorage.removeItem("parts-before-ocr-ids");
    // 旧バージョンで残った一時キーも掃除する。
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


export function spreadsheetSafeCell(value: unknown) {
  const text = String(value ?? "");
  if (/^[\t\r\n]/.test(text) || /^[\s]*[=+\-@]/.test(text)) {
    return "'" + text;
  }
  return text;
}
