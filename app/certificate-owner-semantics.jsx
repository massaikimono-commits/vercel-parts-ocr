"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";

function norm(value) {
  return String(value ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function isMasked(value) {
  const t = norm(value).replace(/\s/g, "");
  return Boolean(t) && /^[＊*]+$/.test(t);
}

function semanticPerson(value) {
  const t = norm(value);
  if (!t || isMasked(t)) return "";
  return t;
}

function normalizePatch(detail) {
  const patch = { ...detail };
  const rawOwnerName = norm(patch.ownerNameRaw ?? patch.ownerName ?? "");
  const rawOwnerAddress = norm(patch.ownerAddressRaw ?? patch.ownerAddress ?? "");
  const rawUserName = norm(patch.userNameRaw ?? patch.userName ?? "");
  const rawUserAddress = norm(patch.userAddressRaw ?? patch.userAddress ?? "");

  if (rawOwnerName) patch.ownerNameRaw = rawOwnerName;
  if (rawOwnerAddress) patch.ownerAddressRaw = rawOwnerAddress;
  if (rawUserName) patch.userNameRaw = rawUserName;
  if (rawUserAddress) patch.userAddressRaw = rawUserAddress;

  const ownerName = semanticPerson(rawOwnerName);
  const ownerAddress = semanticPerson(rawOwnerAddress);
  const userName = semanticPerson(rawUserName);
  const userAddress = semanticPerson(rawUserAddress);

  if (ownerName) patch.ownerName = ownerName; else delete patch.ownerName;
  if (ownerAddress) patch.ownerAddress = ownerAddress; else delete patch.ownerAddress;
  if (userName) patch.userName = userName; else if (isMasked(rawUserName)) delete patch.userName;
  if (userAddress) patch.userAddress = userAddress; else if (isMasked(rawUserAddress)) delete patch.userAddress;

  // Japanese inspection-record semantics: when the user field is omitted/masked because it is the same
  // person/address as the owner, expose an explicit resolved value without destroying the raw evidence.
  if (!patch.userName && ownerName) patch.resolvedUserName = ownerName;
  else if (patch.userName) patch.resolvedUserName = patch.userName;
  if (!patch.userAddress && ownerAddress) patch.resolvedUserAddress = ownerAddress;
  else if (patch.userAddress) patch.resolvedUserAddress = patch.userAddress;

  patch.ownerUserSemantics = JSON.stringify({
    ownerNameMasked: isMasked(rawOwnerName), ownerAddressMasked: isMasked(rawOwnerAddress),
    userNameMasked: isMasked(rawUserName), userAddressMasked: isMasked(rawUserAddress),
    resolvedUserNameFromOwner: !userName && Boolean(ownerName),
    resolvedUserAddressFromOwner: !userAddress && Boolean(ownerAddress),
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
