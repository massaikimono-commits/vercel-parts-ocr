export const CERTIFICATE_PDF_FINAL_OWNER = "structured-v3";

export function isCertificatePdfStructuredFinal(detail) {
  return Boolean(detail && detail.__certificatePdfFinalOwner === CERTIFICATE_PDF_FINAL_OWNER);
}

export function createCertificatePdfRunOwnership() {
  let currentRunId = 0;
  let committedRunId = 0;
  return {
    beginRun() { currentRunId += 1; committedRunId = 0; return currentRunId; },
    isCurrent(runId) { return runId === currentRunId; },
    claimCommit(runId) { if (runId !== currentRunId || committedRunId === runId) return false; committedRunId = runId; return true; },
    invalidate() { currentRunId += 1; committedRunId = 0; },
  };
}

const TERMINAL_STATES = new Set(["completed", "fallback", "error", "cancelled"]);
const IDENTITY_BOUNDARIES = [
  "所有者の氏名又は名称", "所有者の住所", "使用者の氏名又は名称", "使用者の住所", "使用の本拠の位置",
  "1.基本情報", "2.所有者・使用者情報", "2.使用者・所有者情報", "2.使用者情報", "3.車両詳細情報", "4.備考",
];
function compactIdentity(value) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim(); }
function isIdentityBoundaryContaminated(value) {
  const dense = compactIdentity(value);
  if (!dense) return true;
  return IDENTITY_BOUNDARIES.some((label) => dense.includes(compactIdentity(label)));
}

export function createCertificatePdfCompletionContract(ownership) {
  const states = new Map(); let currentRunId = null;
  return {
    beginRun() { if (currentRunId !== null && states.get(currentRunId) === "processing") states.set(currentRunId, "cancelled"); currentRunId = ownership.beginRun(); states.set(currentRunId, "processing"); return currentRunId; },
    isActive(runId) { return ownership.isCurrent(runId) && states.get(runId) === "processing"; },
    settle(runId, state) { if (!TERMINAL_STATES.has(state) || states.get(runId) !== "processing") return false; if (state !== "cancelled" && !ownership.isCurrent(runId)) return false; states.set(runId, state); return true; },
    cancel(runId) { return this.settle(runId, "cancelled"); },
    state(runId) { return states.get(runId) || null; },
    invalidate() { const runId = currentRunId; const cancelled = runId !== null && this.cancel(runId); ownership.invalidate(); currentRunId = null; return cancelled ? runId : null; },
  };
}

function applyFinalStructuralOwnership(patch) {
  const finalPatch = { ...patch };
  const evidence = patch?.__genericStructuralEvidence;
  if (!evidence || typeof evidence !== "object") return finalPatch;

  for (const groupName of ["vehicle", "axles", "specification"]) {
    const group = evidence[groupName];
    if (group?.reason || !group?.slots) continue;
    for (const [key, slot] of Object.entries(group.slots)) {
      if (!slot?.parsed) continue;
      // '-' is a resolved empty slot. Preserve the sentinel through the current
      // sparse React form merge; converting it to "" would mean "no update" and
      // could resurrect a stale neighbouring/legacy value.
      finalPatch[key] = slot.explicitEmpty ? "-" : String(slot.parsed.value ?? "");
    }
  }

  const identity = evidence.identity;
  if (identity && typeof identity === "object") {
    const identityKeys = { ownerNameRaw: "ownerName", ownerAddressRaw: "ownerAddress", userNameRaw: "userName", userAddressRaw: "userAddress", baseLocationRaw: "baseLocation" };
    for (const [rawKey, valueKey] of Object.entries(identityKeys)) {
      const item = identity[rawKey];
      const source = String(item?.source ?? "").trim();
      if (item && !item.masked && !item.labelAsValueRejected && source && !isIdentityBoundaryContaminated(source)) {
        finalPatch[valueKey] = source;
      } else if (isIdentityBoundaryContaminated(finalPatch[valueKey])) {
        // Boundary labels/section headings are never valid business values. An empty
        // result is safer than publishing semantic contamination into the final form.
        finalPatch[valueKey] = "";
      }
    }
  }
  return finalPatch;
}

export function commitCertificatePdfFinal({ ownership, runId, patch, writePdf, clearQr, dispatch }) {
  if (!ownership.claimCommit(runId)) return null;
  const finalPatch = { ...applyFinalStructuralOwnership(patch), __certificatePdfFinalOwner: CERTIFICATE_PDF_FINAL_OWNER, __certificatePdfRunId: runId };
  writePdf(finalPatch); clearQr(); dispatch(finalPatch); return finalPatch;
}
