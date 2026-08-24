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

function fieldInput(labelText) {
  for (const label of document.querySelectorAll("label")) {
    const span = label.querySelector(":scope > span")?.textContent?.trim() || "";
    const direct = (label.childNodes?.[0]?.textContent || "").trim();
    if ((span || direct) !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function modelCore() {
  const detail = fieldInput("型式")?.value || "";
  const text = clean(detail);
  if (!text) return "";
  const parts = text.split("-").filter(Boolean);
  return parts.at(-1) || text;
}

function editDistance(a = "", b = "") {
  const x = clean(a);
  const y = clean(b);
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (x[i - 1] === y[j - 1] ? 0 : 1)
      );
      prev = old;
    }
  }
  return row[y.length];
}

function looksModelContaminated(engine = "") {
  const current = clean(engine);
  const model = modelCore();
  if (!current || !model || model.length < 4) return false;
  if (current === model) return true;
  if (current.startsWith(model)) {
    const tail = current.slice(model.length).replace(/-/g, "");
    if (tail.length >= 1 && tail.length <= 8) return true;
  }

  // OCRで型式の1文字を余計に拾ったケースも除外する。
  // 例: 型式 MK53S に対し原動機欄が MKS53SR0 のように連結された場合。
  for (const prefixLength of [model.length, model.length + 1]) {
    if (current.length <= prefixLength) continue;
    const prefix = current.slice(0, prefixLength);
    const tail = current.slice(prefixLength).replace(/-/g, "");
    if (tail.length >= 1 && tail.length <= 8 && editDistance(prefix, model) <= 1) return true;
  }
  return false;
}

function setReactInputValue(input, value) {
  if (!(input instanceof HTMLInputElement) || input.value === value) return;
  const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
  const props = key ? input[key] : null;
  if (typeof props?.onChange === "function") {
    props.onChange({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} });
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showDebug(source, before, after) {
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
  box.textContent = `取得元: ${source}\n補正前: ${before || "(空)"}\n補正後: ${after || "(保留)"}`;
}

export default function CertificateEngineModelQrGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !location.pathname.startsWith("/vehicle-workflow")) return;

    let lastKey = "";
    const sync = () => {
      const input = fieldInput("原動機の型式");
      if (!input) return;
      const current = clean(input.value || "");
      const qr = validEngine(window.__vehicleCertificateQrPriority?.engineModel || "");
      const key = `${current}|${qr}|${modelCore()}`;
      if (key === lastKey) return;
      lastKey = key;

      if (qr) {
        if (current !== qr) setReactInputValue(input, qr);
        showDebug("QR(K2)", current, qr);
        return;
      }

      if (looksModelContaminated(current)) {
        setReactInputValue(input, "");
        showDebug("OCR保留（型式混入）", current, "");
      }
    };

    sync();
    const timer = window.setInterval(sync, 300);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
