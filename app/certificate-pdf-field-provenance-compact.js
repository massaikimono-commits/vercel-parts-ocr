// Diagnostic-only projection. The full observer record and PDF decisions remain untouched.
export const CERTIFICATE_PDF_COMPACT_FIELDS = Object.freeze([
  "maxPayloadKg", "vehicleWeightKg", "grossVehicleWeightKg",
  "lengthCm", "widthCm", "heightCm",
  "frontFrontAxleWeightKg", "frontRearAxleWeightKg", "rearFrontAxleWeightKg", "rearRearAxleWeightKg",
  "frontAxleWeightKg", "rearAxleWeightKg", "displacementOrRatedOutput",
  "modelDesignationNumber", "classificationNumber",
  "ownerName", "ownerAddress", "userName", "userAddress", "baseLocation", "usageBase",
]);

const hasValue = (value) => value !== null && value !== undefined && value !== "";
const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const match = (item, value) => Boolean(text(value)) && (text(item).includes(text(value)) || text(value).includes(text(item)));
const nearby = (items, index, count = 3) => items.slice(Math.max(0, index - 1), Math.max(0, index - 1) + count);

function evidence(provenance) {
  const decision = provenance?.decision;
  const source = decision?.source;
  const selected = decision?.evidence;
  const weight = provenance?.weight;
  const displacement = provenance?.displacement;
  const result = {};
  if (source) result.source = source;
  if (decision?.locked !== undefined) result.locked = decision.locked;
  if (selected) result.evidence = selected;
  if (weight) result.weight = {
    selected: weight.selected ?? weight.value ?? null,
    candidates: Array.isArray(weight.candidates) ? weight.candidates.slice(0, 3).map((item) => ({
      line: item.line, gap: item.gap, dy: item.dy, parsed: item.parsed,
    })) : [],
    omittedCandidateCount: Math.max(0, (weight.candidates?.length || 0) - 3),
  };
  if (displacement) result.displacement = {
    value: displacement.value ?? null, unit: displacement.unit ?? null,
    candidate: displacement.candidate ?? null, evidence: displacement.evidence ?? null,
  };
  return result;
}

function stage(trace, name, finalValue, finalSource) {
  const record = trace.stages?.[name];
  if (!record) return { observed: false, value: null, provenance: null };
  const source = record.provenance?.decision?.source ?? null;
  const result = { value: record.output ?? null, provenance: source };
  if ((record.output !== finalValue || source !== finalSource) && record.provenance?.decision?.evidence)
    result.provenanceDetail = record.provenance.decision.evidence;
  return result;
}

function fieldRecord(full, field) {
  const trace = full.fields[field];
  if (!trace) return { field, observed: false, omittedFromCompact: false };
  const candidates = trace.candidates || [];
  const finalValue = trace.final?.finalSelectedValue ?? null;
  const decisionText = trace.final?.finalProvenance?.decision?.evidence?.candidate;
  const selected = candidates.find((item) => match(item.text, decisionText)) ||
    candidates.find((item) => match(item.text, finalValue) && item.validatorResult === true) ||
    candidates.find((item) => item.validatorResult === true && item.source?.endsWith("-selected")) || null;
  const rejected = candidates.filter((item) => item !== selected && (item.validatorResult === false || item.rejectReason));
  rejected.sort((a, b) => (Math.abs(a.dy ?? 1) + Math.abs(a.dx ?? 1)) - (Math.abs(b.dy ?? 1) + Math.abs(b.dx ?? 1)));
  const labelIndexes = new Set(trace.label?.tokenIndexes || []);
  const rawByIndex = trace.rawItems?.find((item) => selected?.tokenIndexes?.includes(item.index));
  const rawByValue = trace.rawItems?.find((item) => !labelIndexes.has(item.index) && match(item.str, selected?.text || finalValue));
  const raw = rawByIndex || rawByValue || trace.rawItems?.find((item) => !labelIndexes.has(item.index));
  const normalizedByIndex = trace.normalizedTokens?.find((item) => item.rawIndex === raw?.index);
  const normalizedByValue = trace.normalizedTokens?.find((item) => !labelIndexes.has(item.rawIndex) && match(item.text, selected?.text || finalValue));
  const normalized = normalizedByIndex || normalizedByValue || trace.normalizedTokens?.find((item) => !labelIndexes.has(item.rawIndex));
  const valueRow = full.rows?.find((row) => row.memberRawIndexes?.includes(raw?.index));
  const labelRow = trace.label?.rowId ?? null;
  const rows = labelRow !== null ? nearby(full.rows || [], labelRow, 3) : [];
  const candidate = (item) => item ? Object.fromEntries(Object.entries({ text: item.text, source: item.source, dx: item.dx,
    dy: item.dy, validatorResult: item.validatorResult, rejectReason: item.rejectReason,
    rank: item.rank }).filter(([, value]) => value !== null && value !== undefined)) : null;
  const finalSource = trace.final?.finalProvenance?.decision?.source ?? null;
  const readStage = (name) => stage(trace, name, finalValue, finalSource);
  const strict = readStage("strict"), canonical = readStage("canonical");
  const semantic = readStage("semantic"), final = readStage("final");
  const specialized = /WeightKg|maxPayloadKg/.test(field) ?
    { resolver: "weight", ...readStage("weight") } : field === "displacementOrRatedOutput" ?
    { resolver: "displacement", ...readStage("displacement") } :
    { resolver: "not-applicable", value: null, provenance: null };
  return {
    field, finalValue, applyPatchValue: trace.final?.applyPatchValue ?? null,
    applyState: trace.final?.applyState ?? "not-observed",
    finalProvenance: evidence(trace.final?.finalProvenance),
    firstLossStage: trace.firstLossStage ?? null,
    failureClassification: trace.failureClassification ?? "REQUIRES_EXPECTED_VALUE",
    label: { found: Boolean(trace.label?.found), text: trace.label?.text ?? [],
      rowId: labelRow, bounds: trace.label?.bounds ?? null },
    rawMatch: raw ? { found: true, matchBasis: rawByIndex ? "selected-token" : rawByValue ? "value-text" : "nearby-token",
      matchedText: raw.str, rawIndex: raw.index,
      x: raw.transformX, y: raw.transformY, width: raw.width, height: raw.height } : { found: false },
    normalizedMatch: normalized ? { found: true, matchBasis: normalizedByIndex ? "raw-index" : normalizedByValue ? "value-text" : "nearby-token",
      text: normalized.text,
      x: normalized.x, y: normalized.y, w: normalized.w, h: normalized.h,
      rowId: valueRow?.rowId ?? null } : { found: false },
    relevantRows: rows.map((row) => [row.rowId, row.y, row.lineText]),
    candidateSummary: { count: candidates.length, omittedFromCompact: Math.max(0, candidates.length - 2) },
    selectedCandidate: candidate(selected), nearestRejectedCandidate: candidate(rejected[0]),
    strict, canonical, semantic,
    specialized, final,
  };
}

export function projectCertificatePdfFieldProvenanceCompact(full, diagnosticSnapshot = null) {
  try {
    if (!full || !full.fields) return null;
    const checkpoints = diagnosticSnapshot?.checkpoints || [];
    const runStart = checkpoints.find((item) => item.checkpoint === "RUN_STARTED");
    const fields = CERTIFICATE_PDF_COMPACT_FIELDS.map((field) => fieldRecord(full, field));
    const sectionSummary = {};
    for (const trace of Object.values(full.fields)) {
      const section = trace.section?.name || "unassigned";
      sectionSummary[section] = (sectionSummary[section] || 0) + 1;
    }
    const statuses = (name) => ({ observedFields: fields.filter((item) => item[name] && item[name].observed !== false).length,
      missingCount: fields.filter((item) => item[name] && item[name].observed !== false && !hasValue(item[name].value)).length });
    const specializedStatus = (resolver) => ({ observedFields: fields.filter((item) => item.specialized?.resolver === resolver && item.specialized.observed !== false).length,
      missingCount: fields.filter((item) => item.specialized?.resolver === resolver && item.specialized.observed !== false && !hasValue(item.specialized.value)).length });
    return {
      schemaVersion: "certificate-pdf-field-provenance-compact-v1",
      observerVersion: full.schema || "unknown",
      runId: full.run, diagnosticId: full.diagnosticId, page: full.page,
      timestamp: new Date().toISOString(), fileFingerprint: runStart?.metadata?.fileFingerprint ?? "unavailable",
      runState: diagnosticSnapshot?.terminalState ?? full.terminal,
      parseTerminalState: full.terminal,
      pdfSummary: {
        rawItemCount: full.rawItems?.length || 0, normalizedTokenCount: full.normalizedTokens?.length || 0,
        derivedRowCount: full.rows?.length || 0, sectionSummary,
        strictParse: statuses("strict"), canonicalResolver: statuses("canonical"),
        semanticResolver: statuses("semantic"),
        specializedResolver: { weight: specializedStatus("weight"), displacement: specializedStatus("displacement") },
        finalPatch: { appliedFields: fields.filter((item) => item.applyState === "applied" && hasValue(item.applyPatchValue)).length,
          missingFields: fields.filter((item) => item.observed !== false && !hasValue(item.applyPatchValue)).map((item) => item.field) },
      },
      fields,
      rowTupleKeys: ["rowId", "y", "lineText"],
      omittedFromCompact: { fullRawItems: true, fullNormalizedTokens: true, fullRows: true,
        otherFields: Object.keys(full.fields).filter((field) => !CERTIFICATE_PDF_COMPACT_FIELDS.includes(field)),
        fullTraceAvailableVia: "Traceをコピー（完全版）" },
    };
  } catch { return null; }
}
