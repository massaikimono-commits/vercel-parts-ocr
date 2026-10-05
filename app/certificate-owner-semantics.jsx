"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";

function norm(value) {
  return String(value ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function isMasked(value) {
  const t = norm(value).replace(/\s/g, "");
  return Boolean(t) && /^\*+$/.test(t);
}

function classify(raw) {
  const value = norm(raw);
  if (!value) return { rawValue: "", value: "", status: "NOT_PRESENT" };
  if (isMasked(value)) return { rawValue: value, value: "", status: "MASKED" };
  return { rawValue: value, value, status: "VALUE" };
}

function sameAs(raw, source, phrase) {
  if (norm(raw).replace(/\s/g, "") !== phrase) return classify(raw);
  const resolved = classify(source);
  return {
    rawValue: norm(raw),
    value: resolved.status === "VALUE" ? resolved.value : "",
    status: resolved.status === "VALUE" ? "SAME_AS_USER" : "UNRESOLVED_SAME_AS_USER",
  };
}

function normalizePatch(detail) {
  const patch = { ...detail };
  const userName = classify(patch.userNameRaw ?? patch.userName ?? "");
  const userAddress = classify(patch.userAddressRaw ?? patch.userAddress ?? "");
  const ownerName = sameAs(patch.ownerNameRaw ?? patch.ownerName ?? "", userName.value, "使用者に同じ");
  const ownerAddress = sameAs(patch.ownerAddressRaw ?? patch.ownerAddress ?? "", userAddress.value, "使用者住所に同じ");

  const apply = (key, rawKey, stateKey, item) => {
    if (detail.__pdfGeneralizationEvidence?.identityFields?.includes(key)) return;
    if (item.rawValue) patch[rawKey] = item.rawValue; else delete patch[rawKey];
    if (item.value) patch[key] = item.value; else delete patch[key];
    patch[stateKey] = item.status;
  };

  apply("ownerName", "ownerNameRaw", "ownerNameStatus", ownerName);
  apply("ownerAddress", "ownerAddressRaw", "ownerAddressStatus", ownerAddress);
  apply("userName", "userNameRaw", "userNameStatus", userName);
  apply("userAddress", "userAddressRaw", "userAddressStatus", userAddress);

  // Never infer user identity/address from owner data merely because the user field is masked or absent.
  // A future document-rule resolver may populate resolvedUser* only when that equivalence is explicitly proven.
  delete patch.resolvedUserName;
  delete patch.resolvedUserAddress;
  delete patch.resolutionReason;

  patch.ownerUserSemantics = JSON.stringify({
    ownerNameStatus: patch.ownerNameStatus,
    ownerAddressStatus: patch.ownerAddressStatus,
    userNameStatus: patch.userNameStatus,
    userAddressStatus: patch.userAddressStatus,
    automaticOwnerToUserResolution: false,
  });
  return patch;
}

export default function CertificateOwnerSemantics() {
  useEffect(() => {
    let dispatching = false;
    const onAuthoritative = (event) => {
      if (dispatching) return;
      const detail = event?.detail;
      if (!detail || typeof detail !== "object") return;
      const normalized = normalizePatch(detail);
      if (JSON.stringify(normalized) === JSON.stringify(detail)) return;
      dispatching = true;
      try {
        window[PDF_PRIORITY_KEY] = normalized;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: normalized }));
      } finally {
        dispatching = false;
      }
    };
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    return () => window.removeEventListener(AUTH_EVENT, onAuthoritative);
  }, []);
  return null;
}
