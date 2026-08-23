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

function basicFuelSelect() {
  const section = sectionByHeading("基本情報");
  if (!section) return null;
  const labels = Array.from(section.querySelectorAll("label"));
  for (const label of labels) {
    const text = (label.textContent || "").trim();
    if (!text.startsWith("燃料")) continue;
    const select = label.querySelector("select");
    if (select) return select as HTMLSelectElement;
  }
  return null;
}

function detailFuelInput() {
  const section = sectionByHeading("車検証読み取り情報");
  if (!section) return null;
  const labels = Array.from(section.querySelectorAll("label"));
  for (const label of labels) {
    const title = (label.querySelector("span")?.textContent || label.textContent || "").trim();
    if (compact(title) !== compact("燃料の種類")) continue;
    const input = label.querySelector("input");
    if (input) return input as HTMLInputElement;
  }
  return null;
}

function nativeSetSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function nativeSetInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function ensureLightOilOption(select: HTMLSelectElement) {
  const current = select.value;
  let lightOil = Array.from(select.options).find((option) => option.value === "軽油" || option.text === "軽油");
  const diesel = Array.from(select.options).find((option) => option.value === "ディーゼル" || option.text === "ディーゼル");

  if (!lightOil && diesel) {
    diesel.value = "軽油";
    diesel.text = "軽油";
    lightOil = diesel;
  }

  if (!lightOil) {
    lightOil = document.createElement("option");
    lightOil.value = "軽油";
    lightOil.text = "軽油";
    const other = Array.from(select.options).find((option) => option.value === "その他" || option.text === "その他");
    if (other) select.insertBefore(lightOil, other);
    else select.appendChild(lightOil);
  }

  return current;
}

function ocrDebugText() {
  return Array.from(document.querySelectorAll("details pre"))
    .map((node) => node.textContent || "")
    .join("\n");
}

export default function CertificateFuelClassificationFix() {
  useEffect(() => {
    let running = false;

    const run = () => {
      if (running) return;
      running = true;
      try {
        const select = basicFuelSelect();
        if (!select) return;

        const previous = ensureLightOilOption(select);
        const detail = detailFuelInput();
        const detailValue = detail?.value || "";
        const debug = ocrDebugText();
        const lightOilDetected = /軽油|ディーゼル/.test(detailValue) || /軽油|ディーゼル/.test(debug) || previous === "ディーゼル";

        if (!lightOilDetected) return;

        if (detail && /ディーゼル/.test(detailValue)) {
          nativeSetInput(detail, "軽油");
        } else if (detail && !detailValue && /軽油/.test(debug)) {
          nativeSetInput(detail, "軽油");
        }

        const current = select.value;
        if (current === "" || current === "その他" || current === "ディーゼル") {
          nativeSetSelect(select, "軽油");
        }
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => run());
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(run, 700);
    run();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
