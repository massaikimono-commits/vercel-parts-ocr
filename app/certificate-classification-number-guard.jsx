"use client";

import { useEffect } from "react";

const compact = (v = "") => String(v).normalize("NFKC").replace(/\s+/g, "").trim();

function detailField(labelText) {
  const section = Array.from(document.querySelectorAll("section.card")).find((s) =>
    s.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!section) return null;
  for (const label of Array.from(section.querySelectorAll("label"))) {
    const title = (label.querySelector("span")?.textContent || label.textContent || "").trim();
    if (compact(title) !== compact(labelText)) continue;
    return label.querySelector("input");
  }
  return null;
}

function setInput(input, value) {
  if (!input || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function ocrClassificationAdoption() {
  const text = Array.from(document.querySelectorAll("details pre"))
    .map((x) => x.textContent || "")
    .join("\n");
  const m = text.match(/【類別区分番号\s*採用】\s*([^\n]*)/);
  if (!m) return "";
  const v = (m[1] || "").trim();
  if (!v || v === "未読") return "";
  return v.replace(/\s+/g, "");
}

export default function CertificateClassificationNumberGuard() {
  useEffect(() => {
    let lastKey = "";

    const run = () => {
      const adopted = ocrClassificationAdoption();
      if (!adopted) return;

      const img = document.querySelector("img.preview");
      const key = `${img?.src || "no-image"}|${adopted}`;
      if (key === lastKey) return;

      const input = detailField("類別区分番号");
      if (!input) return;

      // 類別区分番号は写真OCRから自動採用しない。
      // OCRが入れた値と一致している場合だけ空欄へ戻し、以後の手入力は維持する。
      if (compact(input.value) === compact(adopted)) {
        setInput(input, "");
      }
      lastKey = key;
    };

    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(run, 350);
    run();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
