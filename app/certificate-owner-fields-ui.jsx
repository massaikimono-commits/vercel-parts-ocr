"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function display(detail, semantic, raw, status) {
  const state = String(detail?.[status] || "");
  const value = String(detail?.[semantic] || "").trim();
  if (value) return value;
  if (state === "MASKED") return "マスキング（原文保持）";
  const rawValue = String(detail?.[raw] || "").trim();
  return rawValue || "未記載";
}

export default function CertificateOwnerFieldsUi() {
  useEffect(() => {
    const ensure = (detail = {}) => {
      const card = Array.from(document.querySelectorAll("section.card")).find((s) => s.querySelector("h2")?.textContent?.includes("車検証読み取り情報"));
      if (!card) return;
      let box = card.querySelector("[data-owner-fields]");
      if (!box) {
        box = document.createElement("div");
        box.dataset.ownerFields = "1";
        box.style.cssText = "margin:0 0 14px;padding:14px;border:1px solid #cbd8eb;border-radius:14px;background:#f8fafc;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px";
        card.querySelector(".grid")?.insertAdjacentElement("beforebegin", box);
      }
      const ownerName = display(detail, "ownerName", "ownerNameRaw", "ownerNameStatus");
      const ownerAddress = display(detail, "ownerAddress", "ownerAddressRaw", "ownerAddressStatus");
      const userName = display(detail, "userName", "userNameRaw", "userNameStatus");
      const userAddress = display(detail, "userAddress", "userAddressRaw", "userAddressStatus");
      box.innerHTML = `<div><b>所有者の氏名又は名称</b><div>${escapeHtml(ownerName)}</div></div><div><b>所有者の住所</b><div>${escapeHtml(ownerAddress)}</div></div><div><b>使用者の氏名又は名称</b><div>${escapeHtml(userName)}</div></div><div><b>使用者の住所</b><div>${escapeHtml(userAddress)}</div></div>`;
    };
    const onAuth = (event) => ensure(event?.detail || {});
    window.addEventListener(AUTH_EVENT, onAuth);
    const timer = setTimeout(() => ensure(window.__vehicleCertificatePdfPriority || {}), 0);
    return () => { clearTimeout(timer); window.removeEventListener(AUTH_EVENT, onAuth); };
  }, []);
  return null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
