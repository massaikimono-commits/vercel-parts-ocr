"use client";

import { useEffect, useMemo, useState } from "react";
import { runPhotoQrDiagnostic } from "../certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated";
import {
  MINIMAL_RUN_IDS,
  runMinimalDiagnosticBatch,
  buildMinimalDiagnosticSummary,
} from "./minimal-contract.mjs";

const FIXED_IDS = Array.from({ length: 8 }, (_, i) => `IMG_${String(940 + i).padStart(4, "0")}.jpeg`);
const RUN_SET = new Set(MINIMAL_RUN_IDS);
const SKIP_IDS = new Set(["IMG_0942.jpeg", "IMG_0944.jpeg"]);
const EXPECTED_AFTER_DECODE = Object.freeze({
  "IMG_0940.jpeg": 6,
  "IMG_0941.jpeg": 6,
  "IMG_0943.jpeg": 6,
  "IMG_0945.jpeg": 6,
  "IMG_0946.jpeg": 6,
  "IMG_0947.jpeg": 5,
});

function normalizeFixedName(file) {
  const leaf = String(file?.name || "").normalize("NFKC").trim().split(/[\\/]/).pop() || "";
  const match = leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
  return match ? `IMG_${match[1]}.jpeg` : null;
}

function mapFixedSet(files) {
  if (files.length !== 8) {
    return { mode: "invalid", rows: [], valid: false, message: `固定評価8枚をまとめて選択してください（現在 ${files.length}枚）。` };
  }
  const exact = new Map();
  let duplicate = false;
  for (const file of files) {
    const id = normalizeFixedName(file);
    if (id && exact.has(id)) duplicate = true;
    if (id && !exact.has(id)) exact.set(id, file);
  }
  if (!duplicate && exact.size === 8 && FIXED_IDS.every((id) => exact.has(id))) {
    return {
      mode: "filename",
      rows: FIXED_IDS.map((id) => ({ id, file: exact.get(id), source: "File.name" })),
      valid: true,
      message: "固定8枚を正式IMG番号へ自動対応しました。サムネイルだけ確認してください。",
    };
  }
  const sorted = [...files].sort((a, b) => Number(a.lastModified || 0) - Number(b.lastModified || 0) || String(a.name).localeCompare(String(b.name)));
  return {
    mode: "metadata-fallback",
    rows: FIXED_IDS.map((id, index) => ({ id, file: sorted[index], source: "metadata-fallback" })),
    valid: true,
    message: "iOSで正式IMG番号を保持していないためmetadata順で対応しました。8枚のサムネイルが固定評価セットであることだけ確認してください。",
  };
}

function sumStats(stats, key) {
  return (stats || []).reduce((sum, item) => sum + Number(item?.[key] || 0), 0);
}
function finiteValues(items, selector) {
  return (items || []).map(selector).map(Number).filter(Number.isFinite);
}
function range(values) {
  if (!values.length) return { count: 0, min: null, max: null, mean: null };
  return {
    count: values.length,
    min: Number(Math.min(...values).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)),
  };
}
function provisionalOwnership(item) {
  if (item?.skippedBecauseASuccess) return "A-current-success";
  if (item?.skippedBecausePhysicalConsensus) return "compact-consensus-success";
  if (item?.overlapRejected) return "geometry-overlap-duplicate";
  if (item?.geometryValid) return "geometry-valid-candidate";
  if (Number(item?.finderCount || 0) >= 3) return "finder-detected-no-valid-quad";
  return "candidate-unresolved";
}

function summarizeRecord(record) {
  const id = record.imageId;
  if (!record.success || !record.matrix) {
    return {
      imageId: id.replace("IMG_", "").replace(".jpeg", ""),
      formalImageId: id,
      diagnosticRecordStatus: "diagnostic-error",
      diagnosticError: record.diagnosticError,
      decodedQrCount: null,
      candidateOwnership: [],
      detectedDecodeFail: null,
      cropCoverage: null,
      resolution: null,
      finderQuad: null,
      anglePerspective: null,
      quietZone: null,
      contrast: null,
      multiQrInterference: null,
      decoderDifference: null,
      parserReject: null,
      dedupeCounting: null,
      nearThreshold: null,
      provisionalCause: "diagnostic-runner-error",
    };
  }

  const m = record.matrix;
  const detection = m.candidateDetection || {};
  const current = m.currentEnsemble || {};
  const geometry = m.geometryStage || {};
  const compact = m.compactSchemaAudit || {};
  const conflicts = m.conflictPositionAudit || {};
  const structural = m.structuralValidation || {};
  const quality = m.qualityDiagnosticAudit || {};
  const geoDiag = geometry.diagnostics || [];
  const qualityRefs = quality.successfulReferences || [];
  const finalCount = Number(geometry.finalUnionCanonicalCount || 0);
  const aCount = Number(current.physicalSafeQrCount || 0);
  const parserEligible = Number(geometry.parserEligibleUnionCanonicalCount || 0);
  const expected = EXPECTED_AFTER_DECODE[id];

  const candidateOwnership = geoDiag.map((item) => ({
    candidateIndex: item.candidateIndex ?? null,
    normalizedCenter: { x: item.x ?? null, y: item.y ?? null },
    provisionalOwnership: provisionalOwnership(item),
    skippedBecauseASuccess: Boolean(item.skippedBecauseASuccess),
    skippedBecausePhysicalConsensus: Boolean(item.skippedBecausePhysicalConsensus),
    finderCount: Number(item.finderCount || 0),
    geometryValid: Boolean(item.geometryValid),
    geometryFailReason: item.geometryFailReason || "unknown",
    overlapRejected: Boolean(item.overlapRejected),
  }));

  const modulePx = finiteValues(geoDiag, (item) => item.modulePx);
  const perspectiveScale = finiteValues(geoDiag, (item) => item.perspectiveScaleSpread);
  const cropWidths = finiteValues(qualityRefs, (item) => item?.coarseCandidateCrop?.cropPixelWidth);
  const lumaContrast = finiteValues(qualityRefs, (item) => item?.coarseCandidateCrop?.localContrastRange);
  const lumaStd = finiteValues(qualityRefs, (item) => item?.coarseCandidateCrop?.localLumaStdDev);
  const laplacian = finiteValues(qualityRefs, (item) => item?.coarseCandidateCrop?.blurIndicatorLaplacianVariance);
  const skew = finiteValues(qualityRefs, (item) => item?.coarseCandidateCrop?.documentSkewDeg);
  const perspectiveDoc = finiteValues(qualityRefs, (item) => item?.coarseCandidateCrop?.perspectiveSpreadDeg);
  const nearThresholdRows = [];
  for (const item of geoDiag) {
    for (const triplet of item.tripletDiagnostics || []) {
      if (["quad-too-small", "qr-center-too-far", "quad-side-spread-too-large"].includes(triplet.rejectedReason)) {
        nearThresholdRows.push({ candidateIndex: item.candidateIndex, tripletRank: triplet.rank, rejectedReason: triplet.rejectedReason, modulePx: triplet.modulePx ?? null });
      }
    }
  }

  const jsSuccess = sumStats(current.stats, "jsqrSuccesses") + sumStats(geometry.stats, "jsqrSuccesses");
  const zxSuccess = sumStats(current.stats, "zxingSuccesses") + sumStats(geometry.stats, "zxingSuccesses");
  const rawDecodedCandidates = Number(current.rawDecodeCandidateCount || 0);
  const coarseCount = Number(detection.coarsePhysicalCandidateCount || 0);
  const finderNoQuad = Number(geometry.finderAtLeast3ButNoValidQuadCount || 0);
  const multiQr = Number(conflicts.multiQrCropConflictCount || 0);
  const ambiguous = Number(conflicts.remainingAmbiguousConflictCount || 0);
  const structuralRejects = Number(structural.samePayloadStructuralFailCount || 0) + Number(structural.singleEngineStructuralFailCount || 0) + Number(structural.ambiguousConflictCount || 0);

  let provisionalCause = "partial-or-successful-decode; inspect unresolved candidates";
  if (finalCount === 0 && finderNoQuad > 0) provisionalCause = "finder-detected-but-no-valid-quad / geometry";
  else if (finalCount === 0 && rawDecodedCandidates > 0) provisionalCause = "decoder-hit-but-structural/parser-reject";
  else if (finalCount === 0 && coarseCount > 0) provisionalCause = "candidate-detected-but-decode-fail";
  else if (multiQr > 0 || ambiguous > 0) provisionalCause = "multi-qr-interference-or-position-conflict";
  else if (structuralRejects > 0) provisionalCause = "structural/parser-rejection-present";
  else if (nearThresholdRows.length > 0) provisionalCause = "geometry-near-threshold-present";
  else if (parserEligible < finalCount) provisionalCause = "parser-eligibility-gap";

  return {
    imageId: id.replace("IMG_", "").replace(".jpeg", ""),
    formalImageId: id,
    diagnosticRecordStatus: "success",
    diagnosticError: null,
    decodedQrCount: finalCount,
    candidateOwnership,
    detectedDecodeFail: {
      coarseCandidateCount: coarseCount,
      rawDecodeCandidateCount: rawDecodedCandidates,
      aPhysicalSafeQrCount: aCount,
      finalSafeUnionQrCount: finalCount,
      estimatedUnresolvedCandidateCount: Math.max(0, coarseCount - finalCount),
    },
    cropCoverage: {
      detectedCandidateCenters: (detection.physicalCandidates || []).map((candidate) => ({ index: candidate.index, x: candidate.x, y: candidate.y })),
      candidatePositionDuplicateRemovedCount: Number(detection.candidatePositionDuplicateRemovedCount || 0),
      qualitySampleCropWidthPx: range(cropWidths),
    },
    resolution: {
      modulePx: range(modulePx),
      qualitySampleLaplacianVariance: range(laplacian),
      normalizeMode: m.normalizeMode || null,
      normalizeConfidence: m.normalizeConfidence ?? null,
    },
    finderQuad: {
      finderAtLeast3ButNoValidQuadCount: finderNoQuad,
      finderOrQuadEstablishedCandidateCount: Number(geometry.finderOrQuadEstablishedCandidateCount || 0),
      geometryKeptCandidateCount: Number(geometry.geometryKeptCandidateCount || 0),
      geometryOverlapMergedCount: Number(geometry.geometryOverlapMergedCount || 0),
      alternateTripletTriedCount: Number(geometry.alternateTripletTriedCount || 0),
      alternateTripletRecoveredCount: Number(geometry.alternateTripletRecoveredCount || 0),
    },
    anglePerspective: {
      candidatePerspectiveScaleSpread: range(perspectiveScale),
      documentSkewDeg: range(skew),
      documentPerspectiveSpreadDeg: range(perspectiveDoc),
      nativeRectifyNetNewCanonicalCount: Number(geometry.nativeRectifyNetNewCanonicalCount || 0),
    },
    quietZone: {
      geometryValidCandidateCount: geoDiag.filter((item) => item.geometryValid && !item.overlapRejected).length,
      quadOrQuietRelatedRejectCount: geoDiag.filter((item) => ["quad-out-of-bounds", "quad-too-small", "quad-side-spread-too-large"].includes(item.geometryFailReason)).length,
    },
    contrast: {
      successfulReferenceSampleCount: qualityRefs.length,
      localContrastRange: range(lumaContrast),
      localLumaStdDev: range(lumaStd),
      note: "diagnostic measurement only; not an acceptance threshold",
    },
    multiQrInterference: {
      multiQrCropConflictCount: multiQr,
      samePhysicalQrConflictCount: Number(conflicts.samePhysicalQrConflictCount || 0),
      positionUncertainConflictCount: Number(conflicts.positionUncertainConflictCount || 0),
      resolvedAsSeparatePhysicalQrCount: Number(conflicts.resolvedAsSeparatePhysicalQrCount || 0),
      remainingAmbiguousConflictCount: ambiguous,
    },
    decoderDifference: {
      jsqrSuccesses: jsSuccess,
      zxingSuccesses: zxSuccess,
      crossEngineConflictCount: Number(structural.crossEngineConflictCount || 0),
      samePayloadStructuralFailCount: Number(structural.samePayloadStructuralFailCount || 0),
      singleEngineStructuralFailCount: Number(structural.singleEngineStructuralFailCount || 0),
    },
    parserReject: {
      parserEligibleUnionQrCount: parserEligible,
      compactPhysicalConsensusAcceptedCount: Number(compact.compactPhysicalConsensusAcceptedCount || 0),
      compactParserRecognizedCount: Number(compact.compactParserRecognizedCount || 0),
      structuralRejectCount: structuralRejects,
    },
    dedupeCounting: {
      candidatePositionDuplicateRemovedCount: Number(detection.candidatePositionDuplicateRemovedCount || 0),
      geometryOverlapMergedCount: Number(geometry.geometryOverlapMergedCount || 0),
      expectedQrCountScoringOnlyAfterDecode: expected,
      countingIntegrityFail: Number.isFinite(expected) ? finalCount > expected : null,
      expectedCountUsedDuringDecode: false,
    },
    nearThreshold: {
      candidateTriplets: nearThresholdRows,
      count: nearThresholdRows.length,
      acceptanceThresholdChanged: false,
    },
    provisionalCause,
  };
}

export default function CertificateQrMinimalDiagnosticPage() {
  const [files, setFiles] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [status, setStatus] = useState("固定評価8枚をまとめて選択してください。");
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState(null);
  const mapping = useMemo(() => mapFixedSet(files), [files]);

  useEffect(() => {
    const next = {};
    for (const row of mapping.rows || []) next[row.id] = URL.createObjectURL(row.file);
    setThumbs(next);
    return () => { for (const url of Object.values(next)) URL.revokeObjectURL(url); };
  }, [mapping]);

  const runMinimal = async () => {
    if (!mapping.valid || running) return;
    setRunning(true);
    setSummary(null);
    try {
      const evaluationHead = new URLSearchParams(window.location.search).get("head") || null;
      if (!/^[0-9a-f]{40}$/i.test(String(evaluationHead || ""))) {
        throw new Error("Preview HEADがURLへ固定されていません。管理側Preview URLを開き直してください。");
      }
      const byId = new Map(mapping.rows.map((row) => [row.id, row]));
      const runRows = MINIMAL_RUN_IDS.map((id) => byId.get(id)).filter(Boolean);
      if (runRows.length !== 6 || runRows.some((row, index) => row.id !== MINIMAL_RUN_IDS[index])) {
        throw new Error("Minimal batch input不整合");
      }
      setStatus("Minimal Diagnostic実行中… 6枚をdirect runnerで順番に診断しています。0942 / 0944は投入していません。");
      const records = await runMinimalDiagnosticBatch(runRows, runPhotoQrDiagnostic);
      const out = buildMinimalDiagnosticSummary({ evaluationHead, records, summarize: summarizeRecord });
      setSummary(out);
      const errors = out.diagnosticErrorImageCount;
      setStatus(errors
        ? `完了。6/6 result recordを保持しました（diagnostic error ${errors}件）。summaryをコピーしてください。`
        : "完了。6/6 result recordを取得しました。下のsummaryコピーだけ押してください。"
      );
    } catch (error) {
      setSummary(null);
      setStatus(`FAIL: ${error?.message || error}`);
    } finally {
      setRunning(false);
    }
  };

  const copySummary = async () => {
    if (!summary) return;
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    setStatus("総合管理用短縮summaryをコピーしました。ChatGPTへそのまま貼り付けてください。");
  };

  return <main style={{ fontFamily: "system-ui,sans-serif", maxWidth: 980, margin: "0 auto", padding: 16 }}>
    <h1 style={{ fontSize: 22, marginBottom: 6 }}>Photo QR Minimal Diagnostic</h1>
    <div style={{ fontSize: 13, fontWeight: 800 }}>操作は「8枚選択 → 開始 → summaryコピー」だけです。</div>
    <div style={{ fontSize: 12, marginTop: 5 }}>Formal 28/47 preserved / direct diagnostic runner / 0942・0944は既存証拠 / iframe bridgeなし</div>

    <section style={{ marginTop: 14, border: "1px solid #aaa", borderRadius: 12, padding: 12 }}>
      <label style={{ display: "block", fontWeight: 850, fontSize: 15 }}>① 固定評価8枚をまとめて選択</label>
      <input type="file" accept="image/*" multiple disabled={running} onChange={(e) => { setFiles([...e.target.files]); setSummary(null); setStatus("8枚を確認中…"); }} style={{ marginTop: 8 }} />
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>{mapping.message}</div>
      {mapping.valid && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 12 }}>
          {mapping.rows.map((row) => <div key={row.id} style={{ border: SKIP_IDS.has(row.id) ? "2px solid #888" : "2px solid #2f6fe4", borderRadius: 10, padding: 7, background: SKIP_IDS.has(row.id) ? "#f3f3f3" : "#fff" }}>
            <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 900 }}>{row.id}</div>
            <div style={{ fontSize: 11, fontWeight: 800, margin: "3px 0" }}>{SKIP_IDS.has(row.id) ? "SKIP（既存証拠）" : "RUN対象"}</div>
            {thumbs[row.id] && <img src={thumbs[row.id]} alt={row.id} style={{ display: "block", width: "100%", height: 110, objectFit: "contain", background: "#eee", borderRadius: 7 }} />}
          </div>)}
        </div>
        <button onClick={runMinimal} disabled={running} style={{ marginTop: 12, width: "100%", padding: "13px 16px", fontSize: 17, fontWeight: 900 }}>
          {running ? "診断中…" : "② Minimal Diagnostic開始"}
        </button>
      </>}
      <div style={{ marginTop: 10, fontWeight: 800, fontSize: 13 }}>{status}</div>
    </section>

    {summary && <section style={{ marginTop: 14, border: "2px solid #34a853", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 900 }}>Minimal Diagnostic完了</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>selected 6 / result records 6 / diagnostic errors {summary.diagnosticErrorImageCount}</div>
      <button onClick={copySummary} style={{ marginTop: 10, width: "100%", padding: "13px 16px", fontSize: 16, fontWeight: 900 }}>
        ③ 総合管理用短縮summaryをコピー
      </button>
    </section>}
  </main>;
}
