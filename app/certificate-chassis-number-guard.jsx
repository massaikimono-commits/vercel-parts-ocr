"use client";

import { useEffect } from "react";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .trim();
}

function modelFamily(value = "") {
  const text = norm(value).toUpperCase().replace(/\s+/g, "");
  const tail = text.includes("-") ? text.split("-").pop() || "" : text;
  return /^[A-Z0-9]{3,8}$/.test(tail) && /[A-Z]/.test(tail) && /\d/.test(tail) ? tail : "";
}

function isFamilyCompatible(prefix = "", family = "") {
  const p = norm(prefix).toUpperCase().replace(/\s+/g, "");
  const f = norm(family).toUpperCase().replace(/\s+/g, "");
  if (!p || !f) return true;
  if (p === f) return true;

  // 国内型式では、型式側だけ末尾にボディ/仕様記号が付く例がある。
  // 例: 型式 6AA-ZWE219H / 車台番号 ZWE219-4008770。
  // 車台番号側の系列を先頭に保ち、追加分が英字1〜2文字だけなら同一車系として扱う。
  if (f.startsWith(p)) {
    const extra = f.slice(p.length);
    if (/^[A-Z]{1,2}$/.test(extra)) return true;
  }

  return false;
}

function parseChassis(value = "") {
  const text = norm(value).toUpperCase();
  const compact = text.replace(/\s+/g, "");

  // 17桁VINなど。I/O/QはVINでは使わないため、そのまま厳格判定する。
  const vin = compact.match(/(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{11,17})(?:$|[^A-Z0-9])/i)?.[1] ||
    (/^[A-HJ-NPR-Z0-9]{11,17}$/.test(compact) ? compact : "");
  if (vin && /[A-Z]/.test(vin) && /\d/.test(vin)) {
    return { value: vin, raw: text, suspicious: compact !== vin, kind: "VIN", prefix: "" };
  }

  // 国内で一般的な「型式系プレフィックス-連番」。
  const matches = [...compact.matchAll(/([A-Z0-9]{3,8})-([0-9OQI|]{5,9})/g)];
  if (!matches.length) return { value: "", raw: text, suspicious: Boolean(text), kind: "", prefix: "" };

  const m = matches[matches.length - 1];
  const prefix = m[1] || "";
  const suffix = (m[2] || "")
    .replace(/[OQ]/g, "0")
    .replace(/[I|]/g, "1");

  if (!/[A-Z]/.test(prefix) || !/\d/.test(prefix) || !/^\d{5,9}$/.test(suffix)) {
    return { value: "", raw: text, suspicious: true, kind: "", prefix };
  }

  return {
    value: `${prefix}-${suffix}`,
    raw: text,
    suspicious: `${prefix}-${m[2]}` !== `${prefix}-${suffix}` || compact !== `${prefix}-${m[2]}`,
    kind: "国内形式",
    prefix,
  };
}

function findInput(labelText) {
  for (const label of document.querySelectorAll("label")) {
    const direct = (label.childNodes?.[0]?.textContent || "").trim();
    const span = label.querySelector(":scope > span")?.textContent?.trim() || "";
    const text = direct || span;
    if (text !== labelText) continue;
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
      const input = findInput("車台番号");
      if (!input) return;

      const qrRaw = window.__vehicleCertificateQrPriority?.chassisNumber || "";
      const pdfRaw = window.__vehicleCertificatePdfPriority?.chassisNumber || "";
      const current = input.value || "";
      const source = qrRaw ? "QR" : pdfRaw ? "PDF" : "OCR";
      const raw = qrRaw || pdfRaw || current;
      if (!raw) return;

      const parsed = parseChassis(raw);
      const family = modelFamily(findInput("型式")?.value || "");

      // QR/PDFは既に上流で構造的に確定した情報源なので、OCR向けの車系ガードで破棄しない。
      // OCRだけは誤読防止のため型式との整合性を確認する。
      const familyMismatch = source === "OCR" && parsed.kind === "国内形式" && family && !isFamilyCompatible(parsed.prefix, family);
      const key = `${source}|${raw}|${parsed.value}|${family}|${familyMismatch ? 1 : 0}`;
      if (key === lastKey) return;
      lastKey = key;

      if (parsed.value && !familyMismatch) {
        if (parsed.value !== current) setReactInputValue(input, parsed.value);
        const reason = source === "PDF"
          ? "PDF文字レイヤーで構造確定した車台番号を保持しました。"
          : parsed.kind === "国内形式" && parsed.suspicious
            ? "数字部のO/Q→0、I/|→1のみ安全補正しました。"
            : parsed.kind === "VIN" ? "VIN形式として確認しました。" : "";
        if (parsed.value !== raw || parsed.suspicious || qrRaw || pdfRaw) {
          showDebug(raw, parsed.value, source, reason);
        }
        return;
      }

      if (source === "OCR" && current) {
        setReactInputValue(input, "");
        showDebug(
          raw,
          "",
          source,
          familyMismatch
            ? `型式の車系 ${family} と整合しないため保留（空欄）にしました。`
            : "車台番号の形式として確定できないため保留（空欄）にしました。"
        );
      }
    };

    sync();
    const timer = window.setInterval(sync, 300);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
