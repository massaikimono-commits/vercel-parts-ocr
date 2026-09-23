// Preview-only, in-memory observations. Nothing in this module decides a PDF field.
const LABELS = Object.freeze({
  registrationNumber: ["自動車登録番号又は車両番号", "車両番号"],
  chassisNumber: ["車台番号"], model: ["型式"], vehicleName: ["車名"],
  registrationDate: ["登録年月日", "交付年月日"], firstRegistration: ["初度登録年月", "初度検査年月"],
  vehicleClass: ["自動車の種別"], purpose: ["用途"], privateBusiness: ["自家用・事業用の別"],
  bodyShape: ["車体の形状"], seatingCapacity: ["乗車定員"],
  maxPayloadKg: ["最大積載量"], vehicleWeightKg: ["車両重量"], grossVehicleWeightKg: ["車両総重量"],
  lengthCm: ["長さ"], widthCm: ["幅"], heightCm: ["高さ"],
  frontFrontAxleWeightKg: ["前前軸重", "前軸重"], frontRearAxleWeightKg: ["前後軸重"],
  rearFrontAxleWeightKg: ["後前軸重"], rearRearAxleWeightKg: ["後後軸重", "後軸重"],
  displacementOrRatedOutput: ["総排気量又は定格出力"],
  modelDesignationNumber: ["型式指定番号"], classificationNumber: ["類別区分番号"],
  engineModel: ["原動機の型式"], fuel: ["燃料の種類"], inspectionExpiry: ["有効期間の満了する日"],
  ownerName: ["所有者の氏名又は名称"], ownerAddress: ["所有者の住所"],
  userName: ["使用者の氏名又は名称"], userAddress: ["使用者の住所"],
  baseLocation: ["使用の本拠の位置"],
});
export const CERTIFICATE_PDF_FIELD_FAILURE_CLASSES = Object.freeze([
  "RAW_ABSENT", "NORMALIZATION_LOSS", "ROW_SPLIT", "ROW_MERGE", "SECTION_MISASSIGN",
  "LABEL_ANCHOR_MISSING", "LABEL_ANCHOR_WRONG", "CANDIDATE_EMPTY", "CANDIDATE_WRONG",
  "GEOMETRY_WINDOW_REJECT", "UNIT_ASSOCIATION_FAILURE", "VALIDATOR_REJECT", "RANKING_WRONG",
  "STRICT_PARSE_LOSS", "CANONICAL_RESOLVER_LOSS", "SEMANTIC_RESOLVER_LOSS",
  "FINAL_SELECTION_WRONG", "PATCH_LOSS", "CORRECT", "NOT_APPLICABLE",
]);
const records = new Map();
let currentId = null;
const clone = (value) => JSON.parse(JSON.stringify(value));
const compact = (value) => String(value ?? "").normalize("NFKC").replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
const normalizedRaw = (value) => String(value || "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
function sectionFor(field) {
  if (/WeightKg|maxPayloadKg/.test(field)) return "weight-or-axle";
  if (/^(length|width|height)Cm$/.test(field)) return "dimensions";
  if (/^(owner|user)/.test(field) || field === "baseLocation") return "identity";
  if (/^(modelDesignationNumber|classificationNumber)$/.test(field)) return "classification";
  if (field === "displacementOrRatedOutput" || field === "engineModel" || field === "fuel") return "powertrain";
  return "vehicle-information";
}

export function isCertificatePdfFieldProvenanceEnabled(locationLike = globalThis.location) {
  const host = String(locationLike?.hostname || "").toLowerCase();
  return (host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) &&
    new URLSearchParams(locationLike?.search || "").get("certificatePdfProvenance") === "1";
}

export function beginCertificatePdfFieldProvenance(diagnosticId, runId) {
  try {
    if (diagnosticId == null) return;
    currentId = diagnosticId;
    records.clear();
    records.set(diagnosticId, { schema: "certificate-pdf-field-provenance-v1", run: runId, diagnosticId,
      page: null, rawItems: [], normalizedTokens: [], rows: [], fields: {},
      classificationOptions: CERTIFICATE_PDF_FIELD_FAILURE_CLASSES, terminal: "processing" });
  } catch {}
}

export function observeCertificatePdfFieldRaw(diagnosticId, page, items, tokens) {
  try {
    const record = records.get(diagnosticId);
    if (!record || diagnosticId !== currentId) return;
    record.page = page;
    record.rawItems = (items || []).map((item, index) => ({
      index, str: String(item?.str ?? ""), transformX: Number(item?.transform?.[4] ?? 0),
      transformY: Number(item?.transform?.[5] ?? 0), width: Number(item?.width ?? 0),
      height: Number(item?.height ?? 0), fontName: String(item?.fontName ?? ""), hasEOL: Boolean(item?.hasEOL),
    }));
    // tokenFromItem drops empty strings; recover the original index without touching parser tokens.
    let normalizedIndex = 0;
    record.normalizedTokens = record.rawItems.flatMap((raw) => {
      if (!normalizedRaw(raw.str)) return [];
      const token = tokens[normalizedIndex++];
      return token ? [{ rawIndex: raw.index, text: token.text, x: token.x, y: token.y, w: token.w, h: token.h }] : [];
    });
  } catch {}
}

export function observeCertificatePdfFieldRows(diagnosticId, lines) {
  try {
    const record = records.get(diagnosticId);
    if (!record || diagnosticId !== currentId) return;
    record.rows = (lines || []).map((line, rowId) => {
      const used = new Set();
      const memberRawIndexes = (line.tokens || []).map((token) => {
        const match = record.normalizedTokens.find((candidate) => !used.has(candidate.rawIndex) &&
          candidate.text === token.text && candidate.x === token.x && candidate.y === token.y);
        if (match) used.add(match.rawIndex);
        return match?.rawIndex ?? null;
      });
      return { rowId, y: line.y, memberRawIndexes, memberTexts: (line.tokens || []).map((token) => token.text), lineText: line.text };
    });
    for (const [field, labels] of Object.entries(LABELS)) {
      const labelRows = record.rows.filter((row) => labels.some((label) => compact(row.lineText).includes(compact(label))));
      const row = labelRows[0] || null;
      const tokenIndexes = row?.memberRawIndexes?.filter((index) => index !== null) || [];
      const anchorTokens = record.normalizedTokens.filter((token) => tokenIndexes.includes(token.rawIndex));
      const bounds = anchorTokens.length ? {
        x: Math.min(...anchorTokens.map((token) => token.x)),
        y: row.y, right: Math.max(...anchorTokens.map((token) => token.x + token.w)),
      } : null;
      // Diagnostic candidates include rejected geometry. They are not parser candidates or parser ranks.
      const neighbors = row ? record.normalizedTokens.filter((token) =>
        token.y >= row.y - 0.03 && token.y <= row.y + 0.10 && !tokenIndexes.includes(token.rawIndex)) : [];
      record.fields[field] = {
        field, section: { name: sectionFor(field), assignmentEvidence: row ?
          { method: "label-present-in-derived-row", rowId: row.rowId } : { method: "label-not-found", rowId: null } },
        label: { text: labels, found: Boolean(row), tokenIndexes, bounds, rowId: row?.rowId ?? null },
        rawItems: row ? record.rawItems.filter((item) => tokenIndexes.includes(item.index) || neighbors.some((token) => token.rawIndex === item.index)) : [],
        normalizedTokens: [...anchorTokens, ...neighbors], rows: row ? labelRows : [],
        candidates: neighbors.map((token) => ({ text: token.text, tokenIndexes: [token.rawIndex],
          source: "diagnostic-neighborhood", dx: bounds ? token.x - bounds.right : null,
          dy: token.y - row.y, validatorInput: token.text, validatorResult: null,
          rejectReason: "not-evaluated-by-observer", rank: null })),
        stages: {}, final: {}, firstLossStage: null, failureClassification: "REQUIRES_EXPECTED_VALUE",
      };
    }
  } catch {}
}

export function observeCertificatePdfFieldStage(diagnosticId, stage, input, candidate, output, provenance = {}) {
  try {
    const record = records.get(diagnosticId);
    if (!record || diagnosticId !== currentId) return;
    for (const field of Object.keys(record.fields)) {
      const trace = record.fields[field];
      const weightBase = field === "maxPayloadKg" ? "maxPayload" : field.replace(/Kg$/, "");
      const evidence = { decision: provenance?.[field] ?? null,
        weight: candidate?.__weightEvidence?.[weightBase] ?? candidate?.__weightEvidenceV3?.[weightBase] ?? null,
        identity: candidate?.__identityEvidence?.[field] ?? null,
        displacement: field === "displacementOrRatedOutput" ?
          candidate?.__displacementEvidence ?? candidate?.__displacementEvidenceV3 ?? null : null };
      if (evidence.decision?.evidence?.candidate) {
        trace.candidates.push({ text: evidence.decision.evidence.candidate, tokenIndexes: [],
          source: `${stage}-selected`, dx: null, dy: null,
          validatorInput: evidence.decision.evidence.candidate, validatorResult: true,
          rejectReason: null, rank: null });
      }
      if (stage === "weight" && Array.isArray(evidence.weight?.candidates)) {
        evidence.weight.candidates.forEach((item, index) => trace.candidates.push({
          text: item.line, tokenIndexes: [], source: "weight-resolver-ranked",
          dx: item.gap, dy: item.dy, validatorInput: item.line, validatorResult: Boolean(item.parsed),
          rejectReason: null, rank: index + 1,
        }));
      }
      trace.stages[stage] = { input: input?.[field] ?? null, candidate: candidate?.[field] ?? null,
        selected: output?.[field] ?? null, rejected: null, output: output?.[field] ?? null, provenance: clone(evidence) };
      if (stage === "strict") trace.final.parseStructuredValue = output?.[field] ?? null;
      if (stage === "canonical") trace.final.canonicalValue = output?.[field] ?? null;
      if (stage === "semantic") trace.final.semanticValue = output?.[field] ?? null;
      if (stage === "weight" || stage === "displacement") trace.final.specializedResolverValue = output?.[field] ?? null;
      if (stage === "final") {
        trace.final.finalSelectedValue = output?.[field] ?? null;
        trace.final.finalProvenance = clone(evidence);
      }
    }
  } catch {}
}

export function observeCertificatePdfFieldApply(diagnosticId, patch, applied) {
  try {
    const record = records.get(diagnosticId);
    if (!record || diagnosticId !== currentId) return;
    for (const [field, trace] of Object.entries(record.fields)) {
      trace.final.applyPatchValue = applied ? patch?.[field] ?? null : null;
      trace.final.applyState = applied ? "applied" : "not-applied";
    }
  } catch {}
}

export function terminalCertificatePdfFieldProvenance(diagnosticId, state) {
  try { const record = records.get(diagnosticId); if (record) record.terminal = String(state); } catch {}
}

export function getCertificatePdfFieldProvenance(diagnosticId = currentId) {
  try { const record = records.get(diagnosticId); return record ? clone(record) : null; } catch { return null; }
}

// Classification needs a user-provided expected value; no ground truth enters the runtime parser.
export function classifyCertificatePdfFieldTrace(trace, expected, pageRecord = null) {
  if (!trace || expected == null) return { firstLossStage: null, failureClassification: "REQUIRES_EXPECTED_VALUE" };
  const wanted = compact(expected);
  if (compact(trace.final?.finalSelectedValue) === wanted && trace.final?.applyState === "applied")
    return { firstLossStage: null, failureClassification: "CORRECT" };
  const rawItems = pageRecord?.rawItems || trace.rawItems || [];
  const allPartsPresent = (values) => String(expected).trim().split(/\s+/).every((part) =>
    values.some((value) => compact(value).includes(compact(part))));
  const raw = rawItems.some((item) => compact(item.str).includes(wanted)) ||
    compact(rawItems.map((item) => item.str).join(" ")).includes(wanted) ||
    allPartsPresent(rawItems.map((item) => item.str));
  const tokens = pageRecord?.normalizedTokens || trace.normalizedTokens || [];
  const normalized = tokens.some((token) => compact(token.text).includes(wanted)) ||
    compact(tokens.map((token) => token.text).join(" ")).includes(wanted) ||
    allPartsPresent(tokens.map((token) => token.text));
  if (!raw && !normalized && !pageRecord) return { firstLossStage: null, failureClassification: "UNDETERMINED_REVIEW_EVIDENCE" };
  if (!raw && !normalized) return { firstLossStage: "RAW PDF.js ITEM", failureClassification: "RAW_ABSENT" };
  if (raw && !normalized) return { firstLossStage: "NORMALIZED TOKEN", failureClassification: "NORMALIZATION_LOSS" };
  const row = (pageRecord?.rows || trace.rows)?.some((item) => compact(item.lineText).includes(wanted));
  if (!row) return { firstLossStage: "DERIVED ROW", failureClassification: "ROW_SPLIT" };
  if (!trace.label?.found) return { firstLossStage: "LABEL ANCHOR", failureClassification: "LABEL_ANCHOR_MISSING" };
  for (const [stage, label] of [["strict", "STRICT_PARSE_LOSS"], ["canonical", "CANONICAL_RESOLVER_LOSS"], ["semantic", "SEMANTIC_RESOLVER_LOSS"]]) {
    if (compact(trace.stages?.[stage]?.output) === wanted) continue;
    if (compact(trace.stages?.[stage]?.input) === wanted) return { firstLossStage: stage, failureClassification: label };
  }
  if (compact(trace.final?.finalSelectedValue) === wanted) return { firstLossStage: "APPLY PATCH", failureClassification: "PATCH_LOSS" };
  return { firstLossStage: "CANDIDATE / VALIDATOR / RANK / FINAL SELECT", failureClassification: "UNDETERMINED_REVIEW_EVIDENCE" };
}
