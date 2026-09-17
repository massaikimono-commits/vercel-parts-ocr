"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function value(detail, semantic, raw) {
  const v = String(detail?.[semantic] || "").trim();
  if (v) return v;
  const r = String(detail?.[raw] || "").trim();
  return r || "未記載";
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
      const ownerName = value(detail, "ownerName", "ownerNameRaw");
      const ownerAddress = value(detail, "ownerAddress", "ownerAddressRaw");
      const resolvedUserName = String(detail.resolvedUserName || detail.userName || "").trim() || "未記載";
      const resolvedUserAddress = String(detail.resolvedUserAddress || detail.userAddress || "").trim() || "未記載";
      box.innerHTML = `<div><b>所有者の氏名又は名称</b><div>${escapeHtml(ownerName)}</div></div><div><b>所有者の住所</b><div>${escapeHtml(ownerAddress)}</div></div><div><b>使用者（解決後）</b><div>${escapeHtml(resolvedUserName)}</div></div><div><b>使用者住所（解決後）</b><div>${escapeHtml(resolvedUserAddress)}</div></div>`;
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
