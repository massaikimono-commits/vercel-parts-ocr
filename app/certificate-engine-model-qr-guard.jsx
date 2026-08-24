"use client";

import { useEffect } from "react";

function clean(value = "") {
  return String(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function validEngine(value = "") {
  const text = clean(value);
  if (!text || text.length > 20) return "";
  if (!/[A-Z]/.test(text) || !/\d/.test(text)) return "";
  if (!/^[A-Z0-9-]+$/.test(text)) return "";
  return text;
}

function findEngineInput() {
  for (const label of document.querySelectorAll("label")) {
    const span = label.querySelector(":scope > span")?.textContent?.trim() || "";
    const direct = (label.childNodes?.[0]?.textContent || "").trim();
    if ((span || direct) !== "原動機の型式") continue;
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

function showDebug(before, after) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  );
  if (!card) return;

  let details = document.getElementById("certificate-engine-model-qr-guard-debug");
  if (!details) {
    details = document.createElement("details");
    details.id = "certificate-engine-model-qr-guard-debug";
    details.style.marginTop = "14px";
    details.style.border = "1px solid #d9e0ea";
    details.style.borderRadius = "12px";
    details.style.padding = "12px";
    const summary = document.createElement("summary");
    summary.style.fontWeight = "800";
    summary.textContent = "原動機型式QR優先（確認用）";
    details.appendChild(summary);
    card.appendChild(details);
  }

  let box = details.querySelector("[data-engine-guard-content]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.engineGuardContent = "1";
    box.style.marginTop = "8px";
    box.style.whiteSpace = "pre-wrap";
    details.appendChild(box);
  }
  box.textContent = `QR優先\n補正前: ${before || "(空)"}\nQR: ${after}`;
}

export default function CertificateEngineModelQrGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !location.pathname.startsWith("/vehicle-workflow")) return;

    let lastKey = "";
    const sync = () => {
      const qr = validEngine(window.__vehicleCertificateQrPriority?.engineModel || "");
      if (!qr) return;
      const input = findEngineInput();
      if (!input) return;
      const current = clean(input.value || "");
      const key = `${current}|${qr}`;
      if (key === lastKey) return;
      lastKey = key;
      if (current !== qr) {
        setReactInputValue(input, qr);
        showDebug(current, qr);
      }
    };

    sync();
    const timer = window.setInterval(sync, 300);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
