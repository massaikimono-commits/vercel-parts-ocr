"use client";

import { useEffect } from "react";

function compact(value: string) {
  return (value || "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function sectionByHeading(text: string) {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes(text)
  ) || null;
}

function inputByLabel(sectionTitle: string, labelText: string) {
  const section = sectionByHeading(sectionTitle);
  if (!section) return null;

  for (const label of Array.from(section.querySelectorAll("label"))) {
    const title = (label.querySelector("span")?.textContent || label.textContent || "").trim();
    if (compact(title) !== compact(labelText)) continue;
    const input = label.querySelector("input");
    if (input) return input as HTMLInputElement;
  }

  return null;
}

function nativeSetInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function correctChassis(value: string) {
  const normalized = compact(value)
    .toUpperCase()
    .replace(/[＿_]/g, "-")
    .replace(/[‐‑‒–—―ー]/g, "-");

  // On Isuzu NKR chassis numbers the OCR can insert a false "S"
  // between NKR and the numeric series (e.g. NKRS85-7028220).
  // The actual chassis family is NKR85, so only this very specific
  // false-positive shape is corrected.
  if (/^NKRS\d{1,4}-\d{4,10}$/.test(normalized)) {
    return normalized.replace(/^NKRS(?=\d)/, "NKR");
  }

  return normalized;
}

export default function CertificateChassisCorrectionFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;

    let running = false;

    const run = () => {
      if (running) return;
      running = true;
      try {
        const detail = inputByLabel("車検証読み取り情報", "車台番号");
        const basic = inputByLabel("基本情報", "車台番号");

        for (const input of [detail, basic]) {
          if (!input?.value) continue;
          const corrected = correctChassis(input.value);
          if (corrected && corrected !== compact(input.value).toUpperCase()) {
            nativeSetInput(input, corrected);
          }
        }
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const timer = window.setInterval(run, 350);
    run();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
