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

function basicControl(labelText: string) {
  const section = sectionByHeading("基本情報");
  if (!section) return null;
  const labels = Array.from(section.querySelectorAll("label"));
  for (const label of labels) {
    const text = (label.textContent || "").trim();
    if (!text.startsWith(labelText)) continue;
    return label.querySelector("input,select") as HTMLInputElement | HTMLSelectElement | null;
  }
  return null;
}

function basicFuelSelect() {
  const control = basicControl("燃料");
  return control instanceof HTMLSelectElement ? control : null;
}

function detailInput(labelText: string) {
  const section = sectionByHeading("車検証読み取り情報");
  if (!section) return null;
  const labels = Array.from(section.querySelectorAll("label"));
  for (const label of labels) {
    const title = (label.querySelector("span")?.textContent || label.textContent || "").trim();
    if (compact(title) !== compact(labelText)) continue;
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

function looksLikeDieselModel(value: string) {
  const model = compact(value).toUpperCase();
  if (!model) return false;

  // Japanese type-designation prefixes commonly used by diesel vehicles.
  if (/^(TKG|QKG|SKG|PKG|LKG|BDG|BKG|PDG|QDG|2KG|2PG|2RG|2DG|2TG|3DA)-/.test(model)) return true;

  // Isuzu commercial-vehicle families. The current NKR/NPR/NLR/NMR/FRR etc. models are light-oil vehicles.
  if (/^(?:[A-Z0-9]{2,5}-)?(?:NKR|NPR|NLR|NMR|NNR|NQR|FRR|FSR|FTR|FVR|GIGA)/.test(model)) return true;

  return false;
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
        const detailFuel = detailInput("燃料の種類");
        const detailModel = detailInput("型式");
        const basicModel = basicControl("型式");
        const detailFuelValue = detailFuel?.value || "";
        const modelValue =
          (basicModel instanceof HTMLInputElement ? basicModel.value : "") ||
          detailModel?.value ||
          "";
        const debug = ocrDebugText();

        const lightOilDetected =
          /軽油|ディーゼル/.test(detailFuelValue) ||
          /軽油|ディーゼル/.test(debug) ||
          previous === "ディーゼル" ||
          looksLikeDieselModel(modelValue);

        if (!lightOilDetected) return;

        // First update the detailed certificate field, then force the basic fuel selector last.
        // This ordering prevents the detailed-field onChange from changing the basic selector back.
        if (detailFuel && detailFuelValue !== "軽油") {
          nativeSetInput(detailFuel, "軽油");
        }

        ensureLightOilOption(select);
        if (select.value !== "軽油") {
          nativeSetSelect(select, "軽油");
        }
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => run());
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(run, 400);
    run();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
