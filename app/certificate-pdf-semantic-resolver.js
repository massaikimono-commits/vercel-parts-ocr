function norm(value) {
  return String(value ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function compact(value) {
  return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function allTokens(lines) {
  return (lines || []).flatMap((line) => line.tokens || []);
}

function labelAnchor(lines, label) {
  const wanted = compact(label);
  const matches = [];
  for (const line of lines || []) {
    for (let start = 0; start < (line.tokens || []).length; start += 1) {
      let joined = "";
      for (let end = start; end < line.tokens.length && end < start + 14; end += 1) {
        joined += compact(line.tokens[end].text);
        if (joined.includes(wanted)) { matches.push({ x: line.tokens[start].x, y: line.y, line, start, end, span: end - start }); break; }
        if (joined.length > wanted.length + 22) break;
      }
    }
  }
  return matches.sort((a, b) => a.span - b.span || a.x - b.x)[0] || null;
}

function cellText(tokens, anchor, left, right, bottom) {
  if (!anchor) return "";
  const same = anchor.line.tokens.slice(anchor.end + 1).filter((token) => token.x >= left && token.x < right).map((token) => token.text);
  const below = tokens.filter((token) => token.y > anchor.y + 0.002 && token.y < bottom && token.x >= left && token.x < right).sort((a, b) => a.y - b.y || a.x - b.x).map((token) => token.text);
  return norm([...same, ...below].join(" "));
}

function nextY(lines, anchor, labels, fallback) {
  const values = labels.map((label) => labelAnchor(lines, label)).filter(Boolean).filter((item) => item.y > anchor.y + 0.004).map((item) => item.y);
  return values.length ? Math.min(...values) - 0.002 : Math.min(1, anchor.y + fallback);
}

function parseWeight(raw) {
  const match = norm(raw).replace(/kg/gi, " ").match(/(\d{2,5})(?:\s*[\[［]\s*(\d{2,5})\s*[\]］])?/);
  if (!match) return null;
  const primary = Number(match[1]);
  if (!Number.isFinite(primary) || primary < 100 || primary > 50000) return null;
  const alternate = match[2] ? Number(match[2]) : null;
  return { raw: alternate == null ? String(primary) : `${primary} [${alternate}]`, primary, alternate };
}

function recoverWeights(tokens, lines) {
  const definitions = [["最大積載量", "maxPayloadKg", "maxPayload"], ["車両重量", "vehicleWeightKg", "vehicleWeight"], ["車両総重量", "grossVehicleWeightKg", "grossVehicleWeight"]];
  const anchors = definitions.map(([label]) => labelAnchor(lines, label));
  if (anchors.some((anchor) => !anchor)) return { patch: {}, evidence: {} };
  const ordered = anchors.map((anchor, index) => ({ anchor, index })).sort((a, b) => a.anchor.x - b.anchor.x);
  const bounds = new Map();
  ordered.forEach((current, position) => {
    const previous = ordered[position - 1]?.anchor;
    const next = ordered[position + 1]?.anchor;
    bounds.set(current.index, [previous ? (previous.x + current.anchor.x) / 2 : Math.max(0, current.anchor.x - 0.04), next ? (current.anchor.x + next.x) / 2 : 1]);
  });
  const headerBottom = Math.max(...anchors.map((anchor) => anchor.y));
  const stops = ["車台番号", "前前軸重", "長さ"].map((label) => labelAnchor(lines, label)).filter(Boolean).filter((anchor) => anchor.y > headerBottom + 0.004);
  const bottom = stops.length ? Math.min(...stops.map((anchor) => anchor.y)) - 0.002 : headerBottom + 0.09;
  const patch = {};
  const evidence = {};
  definitions.forEach(([label, key, base], index) => {
    const [left, right] = bounds.get(index);
    const source = cellText(tokens, anchors[index], left, right, bottom);
    const parsed = parseWeight(source);
    evidence[base] = { label, relation: "label-relative-cell", sourceTokens: source, parsed };
    if (!parsed) return;
    patch[key] = parsed.raw;
    patch[`${base}Raw`] = parsed.raw;
    patch[`${base}PrimaryKg`] = parsed.primary;
    patch[`${base}AlternateKg`] = parsed.alternate;
  });
  return { patch, evidence };
}

const IDENTITY_DEFINITIONS = [["所有者の氏名又は名称", "ownerNameRaw", "ownerName"], ["所有者の住所", "ownerAddressRaw", "ownerAddress"], ["使用者の氏名又は名称", "userNameRaw", "userName"], ["使用者の住所", "userAddressRaw", "userAddress"]];

function cleanIdentity(value) {
  return norm(value).replace(/\[\d+\]$/g, "").trim();
}

function recoverIdentity(tokens, lines) {
  const anchors = IDENTITY_DEFINITIONS.map(([label]) => labelAnchor(lines, label));
  const patch = {};
  const evidence = {};
  IDENTITY_DEFINITIONS.forEach(([label, rawKey, valueKey], index) => {
    const anchor = anchors[index];
    if (!anchor) return;
    const same = anchors.filter(Boolean).filter((candidate) => Math.abs(candidate.y - anchor.y) < 0.025).sort((a, b) => a.x - b.x);
    const position = same.indexOf(anchor);
    const previous = same[position - 1];
    const next = same[position + 1];
    const left = previous ? (previous.x + anchor.x) / 2 : Math.max(0, anchor.x - 0.025);
    const right = next ? (anchor.x + next.x) / 2 : 1;
    const lower = anchors.filter(Boolean).filter((candidate) => candidate.y > anchor.y + 0.008 && candidate.x >= left - 0.03 && candidate.x < right + 0.03).sort((a, b) => a.y - b.y)[0];
    const bottom = lower ? lower.y - 0.002 : Math.min(1, anchor.y + 0.075);
    const raw = cellText(tokens, anchor, left, right, bottom);
    let value = cleanIdentity(raw);
    for (const [other] of IDENTITY_DEFINITIONS) value = value.replace(new RegExp(compact(other), "g"), "");
    value = cleanIdentity(value);
    const masked = /^[*＊]+$/.test(compact(value));
    evidence[rawKey] = { semantic: "main-table", label, sourceTokens: raw, masked };
    if (!value || value.length > 180) return;
    patch[rawKey] = value;
    if (!masked) patch[valueKey] = value;
  });
  return { patch, evidence };
}

function recoverOwnerAtIssuance(tokens, lines) {
  const markers = ["本自動車検査証発行時における所有者情報", "自動車検査証発行時における所有者情報"];
  let anchor = null;
  let marker = "";
  for (const candidate of markers) {
    anchor = labelAnchor(lines, candidate);
    if (anchor) { marker = candidate; break; }
  }
  if (!anchor) return { patch: {}, evidence: null };
  const bottom = nextY(lines, anchor, ["その他検査事項", "二次元コード"], 0.17);
  const region = tokens.filter((token) => token.y > anchor.y + 0.001 && token.y < bottom);
  const regionLines = (lines || []).filter((line) => line.y > anchor.y + 0.001 && line.y < bottom);
  let name = "";
  let address = "";
  for (const label of ["所有者の氏名又は名称", "氏名又は名称"]) {
    const item = labelAnchor(regionLines, label);
    if (item) { name = cleanIdentity(cellText(region, item, item.x, 1, nextY(regionLines, item, ["所有者の住所", "住所"], 0.05))); if (name) break; }
  }
  for (const label of ["所有者の住所", "住所"]) {
    const item = labelAnchor(regionLines, label);
    if (item) { address = cleanIdentity(cellText(region, item, item.x, 1, nextY(regionLines, item, ["その他検査事項"], 0.06))); if (address) break; }
  }
  if (!name) {
    const candidates = regionLines.map((line) => norm(line.text)).filter((text) => text && !markers.some((value) => compact(text).includes(compact(value))));
    name = candidates.find((text) => /(株式会社|有限会社|合同会社|法人|組合)/.test(text)) || "";
    if (name && !address) address = candidates.slice(candidates.indexOf(name) + 1, candidates.indexOf(name) + 3).find((text) => text && !/(氏名|名称)/.test(text)) || "";
  }
  const patch = {};
  if (name) patch.ownerAtIssuanceNameRaw = name;
  if (address) patch.ownerAtIssuanceAddressRaw = address;
  return { patch, evidence: { semantic: "owner-at-certificate-issuance", marker, sourceTokens: region.map((token) => token.text).join(" "), name, address } };
}

function recoverDisplacement(tokens, lines) {
  const anchor = labelAnchor(lines, "総排気量又は定格出力");
  if (!anchor) return { patch: {}, evidence: null };
  const bottom = nextY(lines, anchor, ["燃料の種類", "型式指定番号", "類別区分番号"], 0.075);
  const source = cellText(tokens, anchor, Math.max(0, anchor.x - 0.01), 1, bottom);
  const match = source.match(/(\d+(?:\.\d+)?)\s*(L|ℓ|l|kW|KW|kw)\b/i);
  if (!match) return { patch: {}, evidence: { label: "総排気量又は定格出力", sourceTokens: source, parsed: null } };
  const unit = /^(l|ℓ)$/i.test(match[2]) ? "L" : "kW";
  const value = match[1];
  return { patch: { displacementOrRatedOutput: `${value} ${unit}`, displacementOrRatedOutputRaw: norm(match[0]), displacementOrRatedOutputValue: value, displacementOrRatedOutputUnit: unit }, evidence: { label: "総排気量又は定格出力", sourceTokens: source, parsed: { value, unit } } };
}

function validWeight(value) {
  return value === "-" || Boolean(parseWeight(value));
}

function validIdentity(value) {
  const text = cleanIdentity(value);
  return Boolean(text) && text.length <= 180 && !/^[*＊]+$/.test(compact(text));
}

function validDisplacement(value) {
  return /^\d+(?:\.\d+)?\s+(?:L|kW)$/i.test(norm(value));
}

export function resolveCertificatePdfSemanticFields(lines, currentPatch = {}) {
  const tokens = allTokens(lines);
  const recoveredWeights = recoverWeights(tokens, lines);
  const recoveredIdentity = recoverIdentity(tokens, lines);
  const recoveredIssuance = recoverOwnerAtIssuance(tokens, lines);
  const recoveredDisplacement = recoverDisplacement(tokens, lines);
  const candidate = { ...recoveredWeights.patch, ...recoveredIdentity.patch, ...recoveredIssuance.patch, ...recoveredDisplacement.patch };
  const patch = { ...currentPatch };
  const provenance = {};
  const validator = (key, value) => key.endsWith("Kg") ? validWeight(value) : key === "displacementOrRatedOutput" ? validDisplacement(value) : /(?:Name|Address)/.test(key) && !key.endsWith("Raw") ? validIdentity(value) : nonEmpty(value);
  for (const [key, value] of Object.entries(candidate)) {
    if (!validator(key, patch[key]) && validator(key, value)) {
      patch[key] = value;
      provenance[key] = { source: "semantic-pure", locked: true };
    }
  }
  patch.__weightEvidence = recoveredWeights.evidence;
  patch.__identityEvidence = recoveredIdentity.evidence;
  if (recoveredIssuance.evidence) patch.__ownerAtIssuanceEvidence = recoveredIssuance.evidence;
  if (recoveredDisplacement.evidence) patch.__displacementEvidence = recoveredDisplacement.evidence;
  patch.automaticOwnerToUserResolution = false;
  return { patch, provenance };
}
