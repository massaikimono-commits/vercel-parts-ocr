function norm(value) {
  return String(value ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}
function compact(value) { return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, ""); }
function nonEmpty(value) { return value !== undefined && value !== null && String(value).trim() !== ""; }
function cx(token) { return Number(token?.cx ?? ((token?.x || 0) + (token?.w || 0) / 2)); }
function allTokens(lines) { return (lines || []).flatMap((line, lineIndex) => (line.tokens || []).map((token) => ({ ...token, lineIndex, cx: cx(token) }))); }

function anchor(lines, label) {
  const wanted = compact(label), matches = [];
  for (let lineIndex = 0; lineIndex < (lines || []).length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let start = 0; start < (line.tokens || []).length; start += 1) {
      let joined = "";
      for (let end = start; end < line.tokens.length && end < start + 18; end += 1) {
        joined += compact(line.tokens[end].text);
        if (joined.includes(wanted)) {
          const first = line.tokens[start], last = line.tokens[end];
          matches.push({ label, line, lineIndex, start, end, y: line.y, left: first.x, right: last.x + (last.w || 0), center: (first.x + last.x + (last.w || 0)) / 2, span: end - start });
          break;
        }
        if (joined.length > wanted.length + 24) break;
      }
    }
  }
  return matches.sort((a,b) => a.span - b.span || a.lineIndex - b.lineIndex || a.left - b.left)[0] || null;
}

function parseNumber(raw, unit) {
  const text = norm(raw);
  const marker = compact(text);
  if (/^[-ー―]+(?:kg|cm)?$/i.test(marker)) return { value: "-", explicitEmpty: true };
  const unitRe = unit === "kg" ? /kg/i : /cm/i;
  if (!unitRe.test(text)) return null;
  const m = text.replace(unitRe, " ").match(/(\d{2,5})(?:\s*[\[［]\s*(\d{2,5})\s*[\]］])?/);
  if (!m) return null;
  const primary = Number(m[1]);
  if (!Number.isFinite(primary)) return null;
  const alternate = m[2] ? Number(m[2]) : null;
  return { value: alternate == null ? String(primary) : `${primary} [${alternate}]`, explicitEmpty: false };
}

function orderedSlots(lines, definitions, unit, options = {}) {
  const anchors = definitions.map((definition) => ({ ...definition, anchor: anchor(lines, definition.label) }));
  if (anchors.some((item) => !item.anchor)) return { patch: {}, evidence: { pattern: options.pattern, reason: "anchor-incomplete" } };
  const headerBottom = Math.max(...anchors.map((item) => item.anchor.y));
  const nextStops = (options.stopLabels || []).map((label) => anchor(lines, label)).filter(Boolean).filter((item) => item.y > headerBottom + 0.003);
  const bottom = nextStops.length ? Math.min(...nextStops.map((item) => item.y)) - 0.001 : Math.min(1, headerBottom + (options.maxDepth || 0.055));
  const tokens = allTokens(lines).filter((token) => token.y >= headerBottom - 0.004 && token.y < bottom);
  const ordered = anchors.slice().sort((a,b) => a.anchor.center - b.anchor.center);
  const patch = {}, evidence = { pattern: options.pattern, bottom, slots: {} };
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index], previous = ordered[index - 1]?.anchor, next = ordered[index + 1]?.anchor;
    const left = previous ? (previous.center + item.anchor.center) / 2 : Math.max(0, item.anchor.left - 0.03);
    const right = next ? (item.anchor.center + next.center) / 2 : 1;
    const owned = tokens.filter((token) => token.cx >= left && token.cx < right && token.lineIndex >= item.anchor.lineIndex);
    const source = norm(owned.map((token) => token.text).join(" "));
    const parsed = parseNumber(source, unit);
    evidence.slots[item.key] = { label: item.label, left, right, source, parsed, explicitEmpty: Boolean(parsed?.explicitEmpty) };
    if (!parsed) continue;
    patch[item.key] = parsed.value;
  }
  return { patch, evidence };
}

const DIMENSIONS = [
  { label: "車両重量", key: "vehicleWeightKg" }, { label: "車両総重量", key: "grossVehicleWeightKg" },
  { label: "長さ", key: "lengthCm" }, { label: "幅", key: "widthCm" }, { label: "高さ", key: "heightCm" },
];
const REGISTERED_AXLES = [
  { label: "前前軸重", key: "frontFrontAxleWeightKg" }, { label: "前後軸重", key: "frontRearAxleWeightKg" },
  { label: "後前軸重", key: "rearFrontAxleWeightKg" }, { label: "後後軸重", key: "rearRearAxleWeightKg" },
];
const LIGHT_AXLES = [ { label: "前軸重", key: "frontAxleWeightKg" }, { label: "後軸重", key: "rearAxleWeightKg" } ];

function recoverVehicleStructure(lines) {
  const dimensions = orderedSlots(lines, DIMENSIONS, "cm", { pattern: "vehicle-weight-dimensions", stopLabels: ["前前軸重", "前軸重", "燃料の種類"], maxDepth: 0.05 });
  // Weight fields and dimensions share the same structural row but have different units.
  const weightDimensions = orderedSlots(lines, DIMENSIONS.slice(0, 2), "kg", { pattern: "vehicle-weight-prefix", stopLabels: ["前前軸重", "前軸重", "燃料の種類"], maxDepth: 0.05 });
  const patch = { ...dimensions.patch, ...weightDimensions.patch };
  return { patch, evidence: { dimensions: dimensions.evidence, weights: weightDimensions.evidence } };
}

function recoverAxles(lines) {
  const registered = REGISTERED_AXLES.every((item) => anchor(lines, item.label));
  if (registered) return orderedSlots(lines, REGISTERED_AXLES, "kg", { pattern: "registered-four-axle", stopLabels: ["燃料の種類", "型式指定番号", "類別区分番号"], maxDepth: 0.05 });
  const light = LIGHT_AXLES.every((item) => anchor(lines, item.label));
  if (light) return orderedSlots(lines, LIGHT_AXLES, "kg", { pattern: "light-two-axle", stopLabels: ["燃料の種類", "型式指定番号", "類別区分番号"], maxDepth: 0.05 });
  return { patch: {}, evidence: { pattern: "none", reason: "axle-anchor-incomplete" } };
}

const IDENTITY = [
  ["所有者の氏名又は名称", "ownerNameRaw", "ownerName"], ["所有者の住所", "ownerAddressRaw", "ownerAddress"],
  ["使用者の氏名又は名称", "userNameRaw", "userName"], ["使用者の住所", "userAddressRaw", "userAddress"],
  ["使用の本拠の位置", "baseLocationRaw", "baseLocation"],
];
const SECTION_LABELS = ["1.基本情報", "2.所有者・使用者情報", "2.使用者・所有者情報", "2.使用者情報", "3.車両詳細情報", "4.備考"];
function cleanIdentity(value) { return norm(value).replace(/\[\s*\d+(?:\s+\d+)*\s*\]\s*$/g, "").trim(); }
function isLabelValue(value) {
  const dense = compact(value);
  return IDENTITY.some(([label]) => dense === compact(label)) || SECTION_LABELS.some((label) => dense === compact(label));
}
function recoverIdentity(lines) {
  const tokens = allTokens(lines), anchors = IDENTITY.map(([label]) => anchor(lines, label));
  const sectionAnchors = SECTION_LABELS.map((label) => anchor(lines, label)).filter(Boolean);
  const patch = {}, evidence = {};
  IDENTITY.forEach(([label, rawKey, valueKey], index) => {
    const current = anchors[index];
    if (!current) return;
    const boundaries = anchors.filter(Boolean).concat(sectionAnchors).filter((candidate) => candidate.lineIndex > current.lineIndex || candidate.y > current.y + 0.003).sort((a,b) => a.lineIndex - b.lineIndex || a.y - b.y);
    const boundary = boundaries[0] || null;
    const bottomLine = boundary ? boundary.lineIndex : Math.min((lines || []).length, current.lineIndex + 3);
    const owned = tokens.filter((token) => {
      if (token.lineIndex < current.lineIndex || token.lineIndex >= bottomLine) return false;
      if (token.lineIndex === current.lineIndex && token.x <= current.right + 0.001) return false;
      return true;
    });
    let value = cleanIdentity(owned.map((token) => token.text).join(" "));
    // Stop defensively if another field/section label survived token reconstruction inside the value.
    const stopTerms = IDENTITY.map(([other]) => other).concat(SECTION_LABELS);
    let cut = value.length;
    for (const term of stopTerms) { const at = compact(value).indexOf(compact(term)); if (at === 0) { cut = 0; break; } }
    if (cut === 0 || isLabelValue(value)) value = "";
    const masked = /^[*＊]+$/.test(compact(value));
    evidence[rawKey] = { label, boundary: boundary?.label || null, source: value, masked, labelAsValueRejected: !value };
    if (!value) return;
    patch[rawKey] = value;
    if (!masked) patch[valueKey] = value;
  });
  return { patch, evidence };
}

function validExisting(key, value) {
  if (!nonEmpty(value)) return false;
  if (/WeightKg$/.test(key) || key === "maxPayloadKg") return value === "-" || /^\d{2,5}(?:\s*\[\s*\d{2,5}\s*\])?$/.test(norm(value));
  if (/^(lengthCm|widthCm|heightCm)$/.test(key)) return /^\d{2,4}$/.test(norm(value));
  if (/(?:Name|Address|Location)$/.test(key) && !key.endsWith("Raw")) return !isLabelValue(value) && norm(value).length <= 180;
  return true;
}

export function resolveCertificatePdfGenericStructuralFields(lines, currentPatch = {}) {
  const structure = recoverVehicleStructure(lines), axles = recoverAxles(lines), identity = recoverIdentity(lines);
  const candidate = { ...structure.patch, ...axles.patch, ...identity.patch };
  const patch = { ...currentPatch }, provenance = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!validExisting(key, patch[key]) && nonEmpty(value)) {
      patch[key] = value;
      provenance[key] = { source: "generic-structural", locked: true };
    }
  }
  patch.__genericStructuralEvidence = { vehicle: structure.evidence, axles: axles.evidence, identity: identity.evidence };
  return { patch, provenance };
}
