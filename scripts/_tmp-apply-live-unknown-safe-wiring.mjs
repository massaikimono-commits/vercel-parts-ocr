import fs from "node:fs";

const path = "app/eval/certificate-qr-live-scan/page.jsx";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(search, replacement, label) {
  const index = text.indexOf(search);
  if (index < 0) throw new Error(`missing anchor: ${label}`);
  if (text.indexOf(search, index + search.length) >= 0) throw new Error(`non-unique anchor: ${label}`);
  text = text.slice(0, index) + replacement + text.slice(index + search.length);
}

replaceOnce(
  'import { useEffect, useMemo, useRef, useState } from "react";\n',
  'import { useEffect, useMemo, useRef, useState } from "react";\nimport { evaluateUnknownSafeCompletion } from "./unknown-safe-contract.mjs";\n',
  "import"
);

replaceOnce(
  'function buildPhysicalSlotUi(state, physicalLocatorUi, expectedQrCount, separated) {',
  `function unknownSafeStrictSnapshot(state, evidenceMap) {\n  const separated = parserSeparationCounterfactualSnapshot(state, evidenceMap);\n  const allCandidates = Array.isArray(separated?.allCandidateDiagnostics)\n    ? separated.allCandidateDiagnostics\n    : [];\n  const recognizedConfirmedCount = allCandidates.filter((candidate) =>\n    candidate.genericConfirmationPass && candidate.parserSchemaRecognized\n  ).length;\n  const currentConfirmedCount = Number(separated?.currentConfirmedCount || 0);\n  const kind = separated?.currentCompletion?.kind || null;\n  const expectedQrCount = Number.isInteger(separated?.currentCompletion?.expectedQrCount)\n    ? separated.currentCompletion.expectedQrCount\n    : null;\n  const candidates = allCandidates\n    .filter((candidate) => !candidate.parserSchemaRecognized)\n    .map((candidate) => ({\n      diagnosticId: candidate.diagnosticId,\n      parserSchemaRecognized: false,\n      parserSchemaClass: candidate.parserSchemaClass || "unrecognized-safe",\n      decodeIntegrityPass: Boolean(candidate.decodeIntegrityPass),\n      frameHitCount: Number(candidate.frameHitCount || 0),\n      bothEngineFrameCount: Number(candidate.bothEngineFrameCount || 0),\n      positionClusterCount: Number(candidate.positionClusterCount || 0),\n    }));\n  const result = evaluateUnknownSafeCompletion({\n    kind,\n    expectedQrCount,\n    currentConfirmedCount,\n    recognizedConfirmedCount,\n    candidates,\n  });\n  const rejectReasonCounts = {};\n  for (const candidate of result.candidateResults || []) {\n    for (const reason of candidate.rejectReasons || []) {\n      rejectReasonCounts[reason] = Number(rejectReasonCounts[reason] || 0) + 1;\n    }\n  }\n  return {\n    ...result,\n    evaluationVariant: "UNKNOWN_SAFE_STRICT",\n    source: "same-live-run-parser-separated-evidence",\n    rejectReasonCounts,\n    cameraStopSemanticsChanged: false,\n    currentSemanticsChanged: false,\n    parserSeparatedSemanticsChanged: false,\n  };\n}\n\nfunction buildPhysicalSlotUi(state, physicalLocatorUi, expectedQrCount, separated) {`,
  "strict helper"
);

replaceOnce(
  `      parserSeparatedEvaluation: parserSeparationCounterfactualSnapshot(\n        countingIntegrityRef.current,\n        evidenceRef.current\n      ),\n      productionShapeCandidate: productionShapeCandidateSnapshot(`,
  `      parserSeparatedEvaluation: parserSeparationCounterfactualSnapshot(\n        countingIntegrityRef.current,\n        evidenceRef.current\n      ),\n      unknownSafeStrictEvaluation: unknownSafeStrictSnapshot(\n        countingIntegrityRef.current,\n        evidenceRef.current\n      ),\n      productionShapeCandidate: productionShapeCandidateSnapshot(`,
  "diagnostic snapshot"
);

replaceOnce(
  `  const parserSeparationUi = useMemo(() => parserSeparationCounterfactualSnapshot(\n    countingIntegrityRef.current,\n    evidenceRef.current\n  ), [frameStats.processed, candidates]);\n\n  const productionShapeUi = useMemo(() => productionShapeCandidateSnapshot(`,
  `  const parserSeparationUi = useMemo(() => parserSeparationCounterfactualSnapshot(\n    countingIntegrityRef.current,\n    evidenceRef.current\n  ), [frameStats.processed, candidates]);\n\n  const unknownSafeStrictUi = useMemo(() => unknownSafeStrictSnapshot(\n    countingIntegrityRef.current,\n    evidenceRef.current\n  ), [frameStats.processed, candidates]);\n\n  const productionShapeUi = useMemo(() => productionShapeCandidateSnapshot(`,
  "ui memo"
);

replaceOnce(
  '  const separated = full?.parserSeparatedEvaluation || full?.parserSeparationCounterfactual || {};\n  const completion = full?.completion || {};',
  '  const separated = full?.parserSeparatedEvaluation || full?.parserSeparationCounterfactual || {};\n  const strict = full?.unknownSafeStrictEvaluation || {};\n  const completion = full?.completion || {};',
  "management strict source"
);

replaceOnce(
  `    importantCases: importantCandidates,\n    evaluationPolicy: {`,
  `    unknownSafeStrict: {\n      recognizedConfirmedCount: strict.recognizedConfirmedCount ?? null,\n      eligibleUnknownSafeCount: strict.eligibleUnknownSafeCount ?? null,\n      totalCandidateConfirmed: strict.totalCandidateConfirmed ?? null,\n      expectedQrCount: strict.expectedQrCount ?? null,\n      exactExpected: strict.exactExpected ?? null,\n      completionEligible: strict.completionEligible ?? null,\n      overflow: strict.overflow ?? null,\n      underflow: strict.underflow ?? null,\n      duplicateIntegrityPass: strict.duplicateIntegrityPass ?? null,\n      currentRegression: strict.currentRegression ?? null,\n      holdReasons: strict.holdReasons || [],\n      rejectReasonCounts: strict.rejectReasonCounts || {},\n      payloadIncluded: false,\n    },\n    importantCases: importantCandidates,\n    evaluationPolicy: {`,
  "management strict summary"
);

replaceOnce(
  `          <div style={{ fontWeight: 900 }}>CURRENT vs PARSER_SEPARATED</div>`,
  `          <div style={{ fontWeight: 900 }}>CURRENT vs PARSER_SEPARATED</div>\n          <div style={{ marginTop: 8, padding: 9, borderRadius: 9, background: "#eef7ff", fontSize: 13, lineHeight: 1.6 }}>\n            <strong>UNKNOWN_SAFE_STRICT</strong>\n            {" ／ "}recognized {unknownSafeStrictUi.recognizedConfirmedCount}\n            {" ／ "}eligible unknown {unknownSafeStrictUi.eligibleUnknownSafeCount}\n            {" ／ "}total {unknownSafeStrictUi.totalCandidateConfirmed}/{unknownSafeStrictUi.expectedQrCount ?? "?"}\n            {" ／ "}exact {unknownSafeStrictUi.exactExpected ? "YES" : "NO"}\n            {" ／ "}completion {unknownSafeStrictUi.completionEligible ? "PASS" : "HOLD"}\n            {" ／ "}overflow {unknownSafeStrictUi.overflow ? "YES" : "NO"}\n            {" ／ "}underflow {unknownSafeStrictUi.underflow ? "YES" : "NO"}\n            {" ／ "}duplicate {unknownSafeStrictUi.duplicateIntegrityPass ? "PASS" : "FAIL"}\n            {" ／ "}current regression {unknownSafeStrictUi.currentRegression ? "YES" : "NO"}\n            <div>holdReasons: {(unknownSafeStrictUi.holdReasons || []).join(", ") || "none"}</div>\n            <div>rejectReasons: {JSON.stringify(unknownSafeStrictUi.rejectReasonCounts || {})}</div>\n          </div>`,
  "strict ui"
);

fs.writeFileSync(path, text);
console.log("Applied Live Unknown-Safe evaluation-only wiring.");
