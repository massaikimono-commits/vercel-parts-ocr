// Pure, side-effect-free missing-field resolver for Certificate PDF Native v3.
//
// Contract:
// - never overwrites a non-empty strict field
// - no PDF/vehicle/registration-specific hard-codes
// - resolves from label semantics + relative token geometry + field validators
// - does not dispatch events, mutate window state, or own PDF input

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value) {
  return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function tokens(lines) {
  return (lines || []).flatMap((line, lineIndex) =>
    (line?.tokens || []).map((token) => ({ ...token, lineIndex }))
  );
}

function anchorTokens(all, labels) {
  const wanted = labels.map(compact);
  return all.filter((token) => {
    const text = compact(token.text);
    return wanted.some((label) => text.includes(label) || label.includes(text));
  });
}

function near(anchor, all, options = {}) {
  const { maxDy = 0.035, minDx = -0.01, maxDx = 0.42, sameLineBonus = 0.03 } = options;
  return all
    .filter((token) => token !== anchor)
    .map((token) => {
      const dx = token.x - (anchor.x + (anchor.w || 0));
      const dy = Math.abs(token.y - anchor.y);
      if (dy > maxDy || dx < minDx || dx > maxDx) return null;
      const sameLine = token.lineIndex === anchor.lineIndex;
      const score = dy * 10 + Math.max(0, dx) - (sameLine ? sameLineBonus : 0);
      return { token, score, dx, dy };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.dx - b.dx);
}

function firstMatch(anchor, all, validator, options) {
  return near(anchor, all, options).find(({ token }) => validator(norm(token.text)))?.token || null;
}

const chassis = (value) => {
  const m = norm(value).toUpperCase().match(/\b([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\b/);
  return m ? m[1].replace(/O/g, "0") : "";
};

const model = (value) => {
  const m = norm(value).toUpperCase().match(/\b((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{2,14})\b/);
  return m ? m[1] : "";
};

const engine = (value) => {
  const text = norm(value).toUpperCase();
  if (!/^[A-Z0-9]{2,10}(?:-[A-Z0-9]{2,10})?$/.test(text)) return "";
  if (["L", "KW"].includes(text)) return "";
  // Model/type values contain a hyphen and can sit close to the engine label in
  // fragmented PDF text layers. Never let an engine recovery consume them.
  if (model(text)) return "";
  return text;
};

const kg = (value) => {
  const m = norm(value).match(/^(-|\d{1,5})\s*kg$/i);
  return m ? (m[1] === "-" ? "-" : String(Number(m[1]))) : "";
};

const cm = (value) => {
  const m = norm(value).match(/^(\d{2,4})\s*cm$/i);
  return m ? String(Number(m[1])) : "";
};

const seats = (value) => {
  const m = norm(value).match(/^(\d{1,2})\s*人$/);
  return m ? String(Number(m[1])) : "";
};

const fuel = (value) => {
  const text = norm(value);
  return ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find((v) => text.includes(v)) || "";
};

const displacement = (value) => {
  const m = norm(value).match(/^(\d+(?:\.\d+)?)\s*(L|kW)$/i);
  if (!m) return "";
  return `${m[1]} ${m[2].toUpperCase()}`;
};

const number = (value, digits) => {
  const re = new RegExp(`^\\d{${digits}}$`);
  const text = norm(value);
  return re.test(text) ? text : "";
};

const FIELD_SPECS = [
  { key: "chassisNumber", labels: ["車台番号"], parse: chassis, maxDx: 0.5 },
  { key: "model", labels: ["型式"], parse: model, maxDx: 0.34 },
  { key: "engineModel", labels: ["原動機の型式"], parse: engine, maxDx: 0.34 },
  { key: "seatingCapacity", labels: ["乗車定員"], parse: seats, maxDx: 0.25 },
  { key: "maxPayloadKg", labels: ["最大積載量"], parse: kg, maxDx: 0.25 },
  { key: "vehicleWeightKg", labels: ["車両重量"], parse: kg, maxDx: 0.25 },
  { key: "grossVehicleWeightKg", labels: ["車両総重量"], parse: kg, maxDx: 0.25 },
  { key: "lengthCm", labels: ["長さ"], parse: cm, maxDx: 0.2 },
  { key: "widthCm", labels: ["幅"], parse: cm, maxDx: 0.2 },
  { key: "heightCm", labels: ["高さ"], parse: cm, maxDx: 0.2 },
  { key: "frontFrontAxleWeightKg", labels: ["前前軸重", "前軸重"], parse: kg, maxDx: 0.24 },
  { key: "frontRearAxleWeightKg", labels: ["前後軸重"], parse: kg, maxDx: 0.24 },
  { key: "rearFrontAxleWeightKg", labels: ["後前軸重"], parse: kg, maxDx: 0.24 },
  { key: "rearRearAxleWeightKg", labels: ["後後軸重", "後軸重"], parse: kg, maxDx: 0.24 },
  { key: "fuel", labels: ["燃料の種類"], parse: fuel, maxDx: 0.3 },
  { key: "modelDesignationNumber", labels: ["型式指定番号"], parse: (v) => number(v, "4,6"), maxDx: 0.25 },
  { key: "classificationNumber", labels: ["類別区分番号"], parse: (v) => number(v, "4"), maxDx: 0.25 },
];

function resolveSimpleField(spec, all) {
  const anchors = anchorTokens(all, spec.labels);
  for (const anchor of anchors) {
    const candidate = firstMatch(anchor, all, (text) => Boolean(spec.parse(text)), { maxDx: spec.maxDx, maxDy: 0.035 });
    if (candidate) {
      const value = spec.parse(candidate.text);
      if (value) return { value, evidence: { label: anchor.text, candidate: candidate.text, method: "anchor-relative" } };
    }
  }
  return null;
}

function resolveDisplacement(all) {
  const anchors = anchorTokens(all, ["総排気量又は定格出力"]);
  for (const anchor of anchors) {
    const candidates = near(anchor, all, { maxDx: 0.38, maxDy: 0.04 });
    for (const { token } of candidates) {
      const value = displacement(token.text);
      if (value) return { value, evidence: { label: anchor.text, candidate: token.text, method: "baseline-affinity" } };
    }
    const numeric = candidates.find(({ token }) => /^\d+(?:\.\d+)?$/.test(norm(token.text)));
    if (!numeric) continue;
    const unit = candidates
      .filter(({ token }) => /^(L|kW)$/i.test(norm(token.text)))
      .sort((a, b) => {
        const ady = Math.abs(a.token.y - numeric.token.y);
        const bdy = Math.abs(b.token.y - numeric.token.y);
        return ady - bdy || Math.abs(a.token.x - numeric.token.x) - Math.abs(b.token.x - numeric.token.x);
      })[0];
    if (!unit) continue;
    const value = displacement(`${numeric.token.text} ${unit.token.text}`);
    if (value) return { value, evidence: { label: anchor.text, candidate: `${numeric.token.text} ${unit.token.text}`, method: "baseline-affinity-split-token" } };
  }
  return null;
}

export function resolveCertificatePdfMissingFields(lines, strictPatch = {}) {
  const patch = { ...strictPatch };
  const provenance = {};
  const all = tokens(lines);
  for (const [key, value] of Object.entries(strictPatch || {})) {
    if (nonEmpty(value)) provenance[key] = { source: "strict", locked: true };
  }
  const putMissing = (key, resolved) => {
    if (!resolved || nonEmpty(patch[key])) return;
    patch[key] = resolved.value;
    provenance[key] = { source: "anchor", locked: true, evidence: resolved.evidence };
  };
  for (const spec of FIELD_SPECS) {
    if (!nonEmpty(patch[spec.key])) putMissing(spec.key, resolveSimpleField(spec, all));
  }
  if (!nonEmpty(patch.displacementOrRatedOutput)) putMissing("displacementOrRatedOutput", resolveDisplacement(all));
  return { patch, provenance };
}
