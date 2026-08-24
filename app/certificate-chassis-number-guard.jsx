"use client";

import { useEffect } from "react";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .trim();
}

function parseChassis(value = "") {
  const text = norm(value).toUpperCase();
  const compact = text.replace(/\s+/g, "");

  // 17桁VINなど。I/O/QはVINでは使わないため、そのまま厳格判定する。
  const vin = compact.match(/(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{11,17})(?:$|[^A-Z0-9])/i)?.[1] ||
    (/^[A-HJ-NPR-Z0-9]{11,17}$/.test(compact) ? compact : "");
  if (vin && /[A-Z]/.test(vin) && /\d/.test(vin)) {
    return { value: vin, raw: text, suspicious: compact !== vin, kind: "VIN" };
  }

  // 国内で一般的な「型式系プレフィックス-連番」。
  const matches = [...compact.matchAll(/([A-Z0-9]{3,8})-([0-9OQI|]{5,9})/g)];
  if (!matches.length) return { value: "", raw: text, suspicious: Boolean(text), kind: "" };

  const m = matches[matches.length - 1];
  const prefix = m[1] || "";
  const suffix = (m[2] || "")
    .replace(/[OQ]/g, "0")
    .replace(/[I|]/g, "1");

  if (!/[A-Z]/.test(prefix) || !/\d/.test(prefix) || !/^\d{5,9}$/.test(suffix)) {
    return { value: "", raw: text, suspicious: true, kind: "" };
  }

  return {
    value: `${prefix}-${suffix}`,
    raw: text,
    suspicious: `${prefix}-${m[2]}` !== `${prefix}-${suffix}` || compact !== `${prefix}-${m[2]}`,
    kind: "国内形式",
  };
}

function findChassisInput() {
  for (const label of document.querySelectorAll("label")) {
    const direct = (label.childNodes?.[0]?.textContent || "").trim();
    const span = label.querySelector(":scope > span")?.textContent?.trim() || "";
    const text = direct || span;
    if (text !== "車台番号") continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function setReactInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showDebug(before, after, source, reason = "") {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  );
  if (!card) return;

  let details = document.getElementById("certificate-chassis-number-guard-debug");
  if (!details) {
    details = document.createElement("details");
    details.id = "certificate-chassis-number-guard-debug";
    details.style.marginTop = "14px";
    details.style.border = "1px solid #d9e0ea";
    details.style.borderRadius = "12px";
    details.style.padding = "12px";
    const summary = document.createElement("summary");
    summary.style.fontWeight = "800";
    summary.textContent = "車台番号補正（確認用）";
    details.appendChild(summary);
    card.appendChild(details);
  }

  let box = details.querySelector("[data-chassis-guard-content]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.chassisGuardContent = "1";
    box.style.marginTop = "8px";
    box.style.whiteSpace = "pre-wrap";
    details.appendChild(box);
  }
  box.textContent = `${source}優先\n補正前: ${before || "(空)"}\n補正後: ${after || "(保留)"}${reason ? `\n${reason}` : ""}`;
}

export default function CertificateChassisNumberGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !location.pathname.startsWith("/vehicle-workflow")) return;

    let lastKey = "";
    const sync = () => {
      const input = findChassisInput();
      if (!input) return;

      const qrRaw = window.__vehicleCertificateQrPriority?.chassisNumber || "";
      const current = input.value || "";
      const source = qrRaw ? "QR" : "OCR";
      const raw = qrRaw || current;
      if (!raw) return;

      const parsed = parseChassis(raw);
      const key = `${source}|${raw}|${parsed.value}|${parsed.suspicious ? 1 : 0}`;
      if (key === lastKey) return;
      lastKey = key;

      if (parsed.value) {
        if (parsed.value !== current) setReactInputValue(input, parsed.value);
        if (parsed.value !== raw || parsed.suspicious || qrRaw) {
          const reason = parsed.kind === "国内形式" && parsed.suspicious
            ? "数字部のO/Q→0、I/|→1のみ安全補正しました。"
            : parsed.kind === "VIN" ? "VIN形式として確認しました。" : "";
          showDebug(raw, parsed.value, source, reason);
        }
        return;
      }

      if (!qrRaw && current) {
        setReactInputValue(input, "");
        showDebug(raw, "", source, "車台番号の形式として確定できないため保留（空欄）にしました。");
      }
    };

    sync();
    const timer = window.setInterval(sync, 300);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
