"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function display(detail, semantic, raw, status) {
  const state = String(detail?.[status] || "");
  const value = String(detail?.[semantic] || "").trim();
  if (value) return value;
  if (state === "MASKED") return "";
  const rawValue = String(detail?.[raw] || "").trim();
  return /^[*＊]+$/.test(rawValue) ? "" : rawValue;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function findField(grid, label) {
  return grid ? Array.from(grid.children).find((el) => el.textContent?.includes(label)) : null;
}

export default function CertificateOwnerFieldsUi() {
  useEffect(() => {
    let latest = window.__vehicleCertificatePdfPriority || {};

    const dispatchField = (key, value) => {
      latest = { ...latest, [key]: value };
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { [key]: value } }));
    };

    const ensure = (detail = {}) => {
      latest = { ...latest, ...detail };
      const card = Array.from(document.querySelectorAll("section.card")).find((s) =>
        s.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
      );
      if (!card) return;

      const grid = card.querySelector(".grid");
      if (!grid) return;
      grid.style.display = "flex";
      grid.style.flexDirection = "column";
      grid.style.gap = "14px";

      let box = card.querySelector("[data-owner-fields]");
      if (!box) {
        box = document.createElement("div");
        box.dataset.ownerFields = "1";
        box.style.cssText = "display:flex;flex-direction:column;gap:14px";
        box.innerHTML = `
          <label style="display:flex;flex-direction:column;gap:7px">
            <span style="font-weight:700">所有者の氏名又は名称</span>
            <input data-owner-input="ownerName" autocomplete="off">
          </label>
          <label style="display:flex;flex-direction:column;gap:7px">
            <span style="font-weight:700">所有者の住所</span>
            <input data-owner-input="ownerAddress" autocomplete="off">
          </label>
        `;
        box.querySelectorAll("[data-owner-input]").forEach((input) => {
          input.addEventListener("input", (event) => {
            const target = event.currentTarget;
            dispatchField(target.dataset.ownerInput, target.value);
          });
        });
      }

      const ownerName = display(latest, "ownerName", "ownerNameRaw", "ownerNameStatus");
      const ownerAddress = display(latest, "ownerAddress", "ownerAddressRaw", "ownerAddressStatus");
      const ownerNameInput = box.querySelector('[data-owner-input="ownerName"]');
      const ownerAddressInput = box.querySelector('[data-owner-input="ownerAddress"]');
      if (ownerNameInput && document.activeElement !== ownerNameInput) ownerNameInput.value = ownerName;
      if (ownerAddressInput && document.activeElement !== ownerAddressInput) ownerAddressInput.value = ownerAddress;

      // Formal display contract: inspection expiry -> Owner -> User -> base location -> vehicle specs.
      const expiryField = findField(grid, "有効期間の満了する日");
      const userField = findField(grid, "使用者の氏名又は名称");
      if (userField) {
        if (box.parentElement !== grid || box.nextElementSibling !== userField) grid.insertBefore(box, userField);
      } else if (expiryField) {
        expiryField.insertAdjacentElement("afterend", box);
      }

      // Issuance-owner data remains reference evidence only. It is intentionally not
      // rendered as a second card here and is never copied into Owner/User by this UI layer.
      const oldProvenance = card.querySelector("[data-owner-provenance]");
      if (oldProvenance) oldProvenance.remove();

      const heading = card.querySelector("h2");
      if (heading) heading.style.display = "none";
      card.style.padding = "0";
      card.style.border = "0";
      card.style.background = "transparent";
      card.style.boxShadow = "none";
    };

    const onAuth = (event) => ensure(event?.detail || {});
    window.addEventListener(AUTH_EVENT, onAuth);
    const timer = setTimeout(() => ensure(window.__vehicleCertificatePdfPriority || {}), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(AUTH_EVENT, onAuth);
    };
  }, []);
  return null;
}
