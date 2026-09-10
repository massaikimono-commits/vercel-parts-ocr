export const A216_RULE = Object.freeze({
  name: "A21_6_PRIVACY_SAFE_CHARACTER_CLASS_AUDIT",
  diagnosticOnly: true,
  formalParserChanged: false,
  formalDecoderChanged: false,
  gateRelaxationAllowed: false,
  qrRerunAllowed: false,
});

function exactCountFromRoundedRatio(length, ratio) {
  const n = Number(length || 0);
  const r = Number(ratio || 0);
  if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(r)) return null;
  const matches = [];
  for (let count = 0; count <= n; count += 1) {
    if (Number((count / n).toFixed(4)) === r) matches.push(count);
  }
  return matches.length === 1 ? matches[0] : null;
}

function shapeKey(shape = {}) {
  return JSON.stringify({
    length: Number(shape.length || 0),
    printableRatio: Number(shape.printableRatio || 0),
    asciiVisibleRatio: Number(shape.asciiVisibleRatio || 0),
    alnumKnownSymbolRatio: Number(shape.alnumKnownSymbolRatio || 0),
    separatorPattern: shape.separatorPattern || "none",
    recognizedSchemaClass: shape.recognizedSchemaClass || "unknown",
  });
}

export function analyzeCharacterClassShape(shape = {}) {
  const length = Number(shape.length || 0);
  const asciiVisibleCount = exactCountFromRoundedRatio(length, shape.asciiVisibleRatio);
  const alnumKnownSymbolCount = exactCountFromRoundedRatio(length, shape.alnumKnownSymbolRatio);
  const printableCount = exactCountFromRoundedRatio(length, shape.printableRatio);
  const nonAsciiCount = asciiVisibleCount == null ? null : length - asciiVisibleCount;
  const asciiOtherCount = asciiVisibleCount == null || alnumKnownSymbolCount == null
    ? null
    : asciiVisibleCount - alnumKnownSymbolCount;

  return {
    length,
    printableCount,
    asciiVisibleCount,
    nonAsciiCount,
    alnumKnownSymbolCombinedCount: alnumKnownSymbolCount,
    asciiOtherCount,
    alnumCount: null,
    knownSymbolCount: null,
    perPositionCharacterClass: null,
    separatorPattern: shape.separatorPattern || "none",
    recognizedSchemaClass: shape.recognizedSchemaClass || "unknown",
    exactReasonForAsciiRatio:
      asciiVisibleCount == null ? "NOT_EXACTLY_RECONSTRUCTABLE" : `${asciiVisibleCount}/${length}_ASCII_VISIBLE`,
    exactReasonForAlnumKnownSymbolRatio:
      alnumKnownSymbolCount == null ? "NOT_EXACTLY_RECONSTRUCTABLE" : `${alnumKnownSymbolCount}/${length}_ALNUM_PLUS_KNOWN_SYMBOL`,
    missingEvidence: [
      "alnumCount",
      "knownSymbolCount",
      "perPositionCharacterClass",
    ],
  };
}

export function analyzeA216PersistedEvidence(detail = {}) {
  const rows = [];
  for (const record of Array.isArray(detail.records) ? detail.records : []) {
    for (const item of Array.isArray(record.C) ? record.C : []) {
      if (!item?.payloadFingerprint) continue;
      rows.push({ ...item, imageId: record.imageId || "unknown" });
    }
  }

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.payloadFingerprint)) groups.set(row.payloadFingerprint, []);
    groups.get(row.payloadFingerprint).push(row);
  }

  const fingerprintGroups = [...groups.entries()].map(([fingerprint, items]) => {
    const shapes = [...new Set(items.map((x) => shapeKey(x.payloadShape)))];
    const decoders = [...new Set(items.map((x) => x.decoder || "unknown"))];
    const images = [...new Set(items.map((x) => x.imageId))];
    const positions = [...new Set(items.map((x) => `${x.imageId}:${x.candidateIndex ?? "?"}:${x.physicalPositionRelation || "?"}`))];
    const analysis = analyzeCharacterClassShape(items[0]?.payloadShape || {});
    return {
      fingerprint,
      occurrences: items.length,
      images,
      decoders,
      physicalPositionGroupCount: positions.length,
      stableAggregateShape: shapes.length === 1,
      ...analysis,
    };
  });

  const structuralSignatures = [...new Set(fingerprintGroups.map((g) => JSON.stringify({
    length: g.length,
    printableCount: g.printableCount,
    asciiVisibleCount: g.asciiVisibleCount,
    nonAsciiCount: g.nonAsciiCount,
    alnumKnownSymbolCombinedCount: g.alnumKnownSymbolCombinedCount,
    asciiOtherCount: g.asciiOtherCount,
    separatorPattern: g.separatorPattern,
    recognizedSchemaClass: g.recognizedSchemaClass,
  })) )];

  return {
    schema: "icb-certificate-qr-stage-a21-6-character-class-audit-v1",
    evaluationHead: detail.evaluationHead || null,
    rawSuccessCount: rows.length,
    uniqueFingerprintCount: groups.size,
    fingerprintGroups,
    aggregateStructureIdenticalAcrossFingerprints: fingerprintGroups.length > 0 && structuralSignatures.length === 1,
    exactFindings: {
      definitionAsciiVisible: "ASCII codepoint 32..126",
      definitionAlnumKnownSymbol: "[0-9A-Za-z] plus [ ._+*-[]()]",
      ratioPrecision: "source ratios rounded to 4 decimals",
    },
    limitations: {
      alnumVsKnownSymbolSplitRecoverable: false,
      perPositionCharacterClassRecoverable: false,
      reason: "A21.4 persisted evidence stores only aggregate ratios/shape and privacy-safe fingerprint; raw/canonical payload and per-position classes were intentionally not persisted.",
      rerunAuthorized: false,
    },
    isolation: {
      formalParserChanged: false,
      formalDecoderChanged: false,
      gateRelaxed: false,
      gtRuntime: false,
      expectedCountRuntime: false,
      diagnosticOnly: true,
    },
  };
}
