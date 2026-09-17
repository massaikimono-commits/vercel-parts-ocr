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

      // Keep the PDF/parser association contract untouched. This component only
      // reorganizes the already-authoritative values into the normal vertical form.
      let box = card.querySelector("[data-owner-fields]");
      if (!box) {
        box = document.createElement("div");
        box.dataset.ownerFields = "1";
        box.style.cssText = "margin:0 0 14px;display:flex;flex-direction:column;gap:14px";
        box.innerHTML = `
          <label style="display:flex;flex-direction:column;gap:7px">
            <span style="font-weight:700">所有者の氏名又は名称</span>
            <input data-owner-input="ownerName" autocomplete="off">
          </label>
          <label style="display:flex;flex-direction:column;gap:7px">
            <span style="font-weight:700">所有者の住所</span>
            <input data-owner-input="ownerAddress" autocomplete="off">
          </label>
          <div data-owner-provenance-slot></div>
        `;
        card.querySelector(".grid")?.insertAdjacentElement("beforebegin", box);
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

      const slot = box.querySelector("[data-owner-provenance-slot]");
      let provenance = box.querySelector("[data-owner-provenance]");
      const issuanceName = String(latest?.ownerAtIssuanceNameRaw || "").trim();
      const issuanceAddress = String(latest?.ownerAtIssuanceAddressRaw || "").trim();
      if (issuanceName || issuanceAddress) {
        if (!provenance) {
          provenance = document.createElement("div");
          provenance.dataset.ownerProvenance = "1";
          provenance.style.cssText = "padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;color:#5d6878;font-size:13px;line-height:1.55";
          slot?.appendChild(provenance);
        }
        provenance.innerHTML = `<b>発行時所有者情報（参考）</b><br>${escapeHtml(issuanceName || "未記載")}${issuanceAddress ? `<br>${escapeHtml(issuanceAddress)}` : ""}`;
      } else if (provenance) {
        provenance.remove();
      }

      // The legacy card heading made owner/current-user/issuance-owner look like one
      // semantic block. Hide only that heading/card chrome; preserve its grid so the
      // existing User and base-location inputs remain authoritative and follow below.
      const heading = card.querySelector("h2");
      if (heading) heading.style.display = "none";
      card.style.padding = "0";
      card.style.border = "0";
      card.style.background = "transparent";
      card.style.boxShadow = "none";

      const grid = card.querySelector(".grid");
      if (grid) {
        grid.style.display = "flex";
        grid.style.flexDirection = "column";
        grid.style.gap = "14px";
      }
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
