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

function normalizePatch(detail) {
  const patch = { ...detail };
  const ownerName = classify(patch.ownerNameRaw ?? patch.ownerName ?? "");
  const ownerAddress = classify(patch.ownerAddressRaw ?? patch.ownerAddress ?? "");
  const userName = classify(patch.userNameRaw ?? patch.userName ?? "");
  const userAddress = classify(patch.userAddressRaw ?? patch.userAddress ?? "");

  const apply = (key, rawKey, stateKey, item) => {
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
    ownerNameStatus: ownerName.status,
    ownerAddressStatus: ownerAddress.status,
    userNameStatus: userName.status,
    userAddressStatus: userAddress.status,
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
