"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const norm = (v = "") => String(v).normalize("NFKC").replace(/[\t\u3000]+/g, " ").replace(/ {2,}/g, " ").trim();

function fieldInput(labelText) {
  const card = [...document.querySelectorAll("section.card")].find((node) => node.querySelector("h2")?.textContent?.includes("車検証読み取り情報"));
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}
function setReact(input, value) {
  if (!(input instanceof HTMLInputElement) || !value || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const old = input.value;
  setter?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(old);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function firstRegistrationParts() {
  const raw = norm(window.__vehicleCertificateQrPriority?.firstRegistration || fieldInput("初度登録年月")?.value || "");
  const m = raw.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  return m ? { era: m[1], year: m[2], month: Number(m[3]) } : null;
}
function recoverRegistrationDate(raw) {
  const first = firstRegistrationParts();
  if (!first) return "";
  const text = norm(raw).replace(/平[或戊陰咸戌]/g, "平成").replace(/信和|今和|作和|令禾|令入|命和/g, "令和");
  const label = text.match(/(?:交付年月日|登録年月日)[^令平昭]{0,25}(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(?:[OoQqDdIl|!ZzSsBb]?\s*)?月\s*(\d{1,2})\s*[日H]?/);
  if (!label) return "";
  if (label[1] !== first.era || String(label[2]) !== String(first.year)) return "";
  const day = Number(label[3]);
  if (first.month < 1 || first.month > 12 || day < 1 || day > 31) return "";
  return `${first.era}${first.year}年${first.month}月${day}日`;
}
function showStatus(text) {
  const host = [...document.querySelectorAll("section.card")].find((node) => node.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
  if (!host) return;
  let box = document.getElementById("certificate-date-partial-recovery-v1-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-date-partial-recovery-v1-debug";
    box.style.marginTop = "10px"; box.style.padding = "10px"; box.style.border = "1px solid #d9b45b"; box.style.borderRadius = "12px"; box.style.background = "#fffaf0";
    box.innerHTML = '<summary style="font-weight:800">月抜け日付復元 v1（確認用）</summary><div data-status style="margin-top:8px;font-weight:700"></div>';
    host.appendChild(box);
  }
  const node = box.querySelector("[data-status]"); if (node) node.textContent = text;
}

export default function CertificateDatePartialRecoveryV1() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    const timer = window.setInterval(() => {
      const reg = fieldInput("登録年月日／交付年月日");
      if (!reg || reg.value) return;
      const raw = document.querySelector("#certificate-missing-dates-v5-debug [data-date-status]")?.textContent || "";
      if (!raw) return;
      const value = recoverRegistrationDate(raw);
      if (!value) { showStatus("月抜け候補は未確定 → 空欄維持"); return; }
      setReact(reg, value);
      window.__vehicleCertificateQrPriority = { ...(window.__vehicleCertificateQrPriority || {}), registrationDate: value };
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { registrationDate: value } }));
      showStatus(`交付年月日 ${value} を復元 ✓（OCRの年月日 + 初度登録月の一致条件）`);
    }, 350);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
