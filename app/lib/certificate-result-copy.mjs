// Evidence projection only: values come exclusively from the displayed form state.
export const EXTRA_CERTIFICATE_COPY_FIELDS = [
  ["ownerName", "所有者氏名"], ["ownerAddress", "所有者住所"],
  ["frontAxleWeightKg", "前軸重 kg"], ["rearAxleWeightKg", "後軸重 kg"],
  ["displacement", "総排気量"], ["ratedOutput", "定格出力"],
  ["displacementUnit", "排気量単位"], ["ratedOutputUnit", "定格出力単位"],
];

export function certificateCopyValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value !== "string" || /^(undefined|null|NaN|\[object Object\])$/.test(value)) return "";
  return value;
}

export function formatCertificateResult(certificate, displayedFields) {
  const current = certificate && typeof certificate === "object" ? certificate : {};
  const fields = [...displayedFields];
  const known = new Set(fields.map(([key]) => key));
  for (const [key, label] of EXTRA_CERTIFICATE_COPY_FIELDS) {
    if (!known.has(key)) { fields.push([key, label]); known.add(key); }
  }
  for (const key of Object.keys(current)) {
    if (!known.has(key) && certificateCopyValue(current[key]) !== "") fields.push([key, key]);
  }
  return ["車検証読取結果", ...fields.map(([key, label]) => `${label}：${certificateCopyValue(current[key])}`)].join("\n");
}

export async function copyCertificateResultText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Safari permissions may reject Clipboard API; try selection copy. */ }
  const area = document.createElement("textarea");
  try {
    area.value = text;
    area.readOnly = true;
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch { return false; }
  finally { area.remove(); }
}
