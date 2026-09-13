from pathlib import Path

page_path = Path('app/eval/certificate-qr-live-scan/page.jsx')
test_path = Path('scripts/certificate-qr-live-unknown-safe-contract-test.mjs')
page = page_path.read_text()
test = test_path.read_text()


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)

page = replace_once(
    page,
    'const LIVE_SCAN_REVISION = "live-poc-v3-candidate-lock-null-semantics-1";',
    'const LIVE_SCAN_REVISION = "live-poc-v4-registered-remaining-one-candidate-lock-12";',
    'revision',
)

page = replace_once(
    page,
    'const LOCAL_RESCUE_RETARGET_EVERY_FRAMES = 6;\nconst GUIDE_ROI = Object.freeze({ x: .04, y: .43, w: .92, h: .44 });',
    'const LOCAL_RESCUE_RETARGET_EVERY_FRAMES = 6;\nconst CANDIDATE_LOCK_VARIANT = "TEMP_LOCK_12";\nconst CANDIDATE_LOCK_HOLD_RESCUE_FRAMES = 12;\nconst GUIDE_ROI = Object.freeze({ x: .04, y: .43, w: .92, h: .44 });',
    'candidate lock constants',
)

page = replace_once(
    page,
    '    targetHistory: [],\n    retargetCount: 0,\n    variantStats: Object.fromEntries(LOCAL_RESCUE_VARIANTS.map((variant) => [',
    '    targetHistory: [],\n    retargetCount: 0,\n    candidateLockVariant: "CURRENT",\n    candidateLockApplied: false,\n    candidateLockTargetRoiId: null,\n    candidateLockDiagnosticId: null,\n    candidateLockStartFrame: null,\n    candidateLockEndFrame: null,\n    candidateLockReleaseReason: null,\n    candidateLockHoldRescueFrames: CANDIDATE_LOCK_HOLD_RESCUE_FRAMES,\n    variantStats: Object.fromEntries(LOCAL_RESCUE_VARIANTS.map((variant) => [',
    'rescue state candidate lock fields',
)

page = replace_once(
    page,
    '    targetHistory: Array.isArray(state?.targetHistory) ? state.targetHistory.slice(-24) : [],\n    retargetCount: Number(state?.retargetCount || 0),\n    variantStats: state?.variantStats || {},',
    '    targetHistory: Array.isArray(state?.targetHistory) ? state.targetHistory.slice(-24) : [],\n    retargetCount: Number(state?.retargetCount || 0),\n    candidateLockVariant: state?.candidateLockVariant || "CURRENT",\n    candidateLockApplied: Boolean(state?.candidateLockApplied),\n    candidateLockTargetRoiId: state?.candidateLockTargetRoiId || null,\n    candidateLockDiagnosticId: state?.candidateLockDiagnosticId || null,\n    candidateLockStartFrame: Number.isFinite(state?.candidateLockStartFrame) ? state.candidateLockStartFrame : null,\n    candidateLockEndFrame: Number.isFinite(state?.candidateLockEndFrame) ? state.candidateLockEndFrame : null,\n    candidateLockReleaseReason: state?.candidateLockReleaseReason || null,\n    candidateLockHoldRescueFrames: Number(state?.candidateLockHoldRescueFrames || CANDIDATE_LOCK_HOLD_RESCUE_FRAMES),\n    variantStats: state?.variantStats || {},',
    'rescue snapshot candidate lock fields',
)

old_last_novel = '''function lastNovelCanonicalFrame(evidenceMap) {
  let last = 0;
  for (const entry of evidenceMap.values()) {
    last = Math.max(last, Number(entry?.firstSeenFrame || 0));
  }
  return last;
}

function createSubRoiStats() {'''
new_last_novel = '''function lastNovelCanonicalFrame(evidenceMap) {
  let last = 0;
  for (const entry of evidenceMap.values()) {
    last = Math.max(last, Number(entry?.firstSeenFrame || 0));
  }
  return last;
}

function candidateLockTargetFromEvidence(evidenceMap) {
  const candidate = [...evidenceMap.values()]
    .filter((entry) =>
      !entry?.confirmed &&
      entry?.parserSchemaClass === "registered-slash" &&
      Array.isArray(entry?.guidePositions) &&
      entry.guidePositions.length > 0
    )
    .sort((a, b) =>
      Number(b?.lastSeenFrame || 0) - Number(a?.lastSeenFrame || 0) ||
      Number(b?.frameIds?.size || 0) - Number(a?.frameIds?.size || 0)
    )[0] || null;
  if (!candidate) return null;

  const positions = candidate.guidePositions
    .slice(-12)
    .map((position) => ({ x: Number(position?.nx), y: Number(position?.ny) }))
    .filter((position) => Number.isFinite(position.x) && Number.isFinite(position.y));
  if (!positions.length) return null;
  const x = medianNumber(positions.map((position) => position.x));
  const y = medianNumber(positions.map((position) => position.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const containing = SUB_ROIS
    .filter((roi) => x >= roi.x && x <= roi.x + roi.w && y >= roi.y && y <= roi.y + roi.h)
    .sort((a, b) => {
      const da = Math.abs(x - (a.x + a.w / 2)) + Math.abs(y - (a.y + a.h / 2));
      const db = Math.abs(x - (b.x + b.w / 2)) + Math.abs(y - (b.y + b.h / 2));
      return da - db;
    });
  const roi = containing[0] || null;
  if (!roi) return null;
  return {
    roi,
    diagnosticId: candidate.diagnosticId || null,
    firstSeenFrame: Number.isFinite(candidate.firstSeenFrame) ? candidate.firstSeenFrame : null,
    lastSeenFrame: Number.isFinite(candidate.lastSeenFrame) ? candidate.lastSeenFrame : null,
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
  };
}

function createSubRoiStats() {'''
page = replace_once(page, old_last_novel, new_last_novel, 'candidate lock target helper')

old_activation = '''        const target = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
        if (target) {
          rescueState.active = true;
          rescueState.activatedFrame = frameId;
          rescueState.targetRoiId = target.id;
          rescueState.triggerCount += 1;
          rescueState.variantCursor = 0;
          if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
          rescueState.targetHistory.push({
            frameId,
            targetRoiId: target.id,
            reason: "activation",
          });
        }'''
new_activation = '''        const scheduledTarget = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
        const candidateLock = completionBeforeRescue.kind === "registered"
          ? candidateLockTargetFromEvidence(evidenceRef.current)
          : null;
        const target = candidateLock?.roi || scheduledTarget;
        if (target) {
          rescueState.active = true;
          rescueState.activatedFrame = frameId;
          rescueState.targetRoiId = target.id;
          rescueState.triggerCount += 1;
          rescueState.variantCursor = 0;
          rescueState.candidateLockVariant = completionBeforeRescue.kind === "registered"
            ? CANDIDATE_LOCK_VARIANT
            : "CURRENT";
          rescueState.candidateLockApplied = Boolean(candidateLock);
          rescueState.candidateLockTargetRoiId = candidateLock?.roi?.id || null;
          rescueState.candidateLockDiagnosticId = candidateLock?.diagnosticId || null;
          rescueState.candidateLockStartFrame = candidateLock ? frameId : null;
          rescueState.candidateLockEndFrame = null;
          rescueState.candidateLockReleaseReason = candidateLock ? null : "no-containing-candidate-at-activation";
          rescueState.candidateLockHoldRescueFrames = CANDIDATE_LOCK_HOLD_RESCUE_FRAMES;
          if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
          rescueState.targetHistory.push({
            frameId,
            targetRoiId: target.id,
            reason: candidateLock ? "candidate-lock-activation" : "activation",
          });
        }'''
page = replace_once(page, old_activation, new_activation, 'candidate lock activation')

old_retarget = '''      if (rescueState.active && remainingOne) {
        if (
          rescueState.rescueFrameCount > 0 &&
          rescueState.rescueFrameCount % LOCAL_RESCUE_RETARGET_EVERY_FRAMES === 0
        ) {'''
new_retarget = '''      if (rescueState.active && remainingOne) {
        const candidateLockActive =
          rescueState.candidateLockApplied &&
          rescueState.candidateLockVariant === CANDIDATE_LOCK_VARIANT &&
          rescueState.rescueFrameCount < CANDIDATE_LOCK_HOLD_RESCUE_FRAMES;
        if (
          rescueState.candidateLockApplied &&
          !candidateLockActive &&
          !Number.isFinite(rescueState.candidateLockEndFrame)
        ) {
          rescueState.candidateLockEndFrame = Math.max(
            Number(rescueState.candidateLockStartFrame || frameId),
            frameId - 1
          );
          rescueState.candidateLockReleaseReason = "hold-window-complete";
          if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
          rescueState.targetHistory.push({
            frameId,
            targetRoiId: rescueState.targetRoiId,
            reason: "candidate-lock-release",
          });
        }
        if (
          !candidateLockActive &&
          rescueState.rescueFrameCount > 0 &&
          rescueState.rescueFrameCount % LOCAL_RESCUE_RETARGET_EVERY_FRAMES === 0
        ) {'''
page = replace_once(page, old_retarget, new_retarget, 'candidate lock retarget guard')

page = replace_once(
    page,
    '      const evidenceUpdate = updateEvidence(frameId, grouped, q, selectedRois);\n\n      for (const [canonical, group] of grouped.entries()) {',
    '      const evidenceUpdate = updateEvidence(frameId, grouped, q, selectedRois);\n      if (\n        evidenceUpdate.completion.complete &&\n        rescueState.candidateLockApplied &&\n        !Number.isFinite(rescueState.candidateLockEndFrame)\n      ) {\n        rescueState.candidateLockEndFrame = frameId;\n        rescueState.candidateLockReleaseReason = "confirmed-during-lock";\n      }\n\n      for (const [canonical, group] of grouped.entries()) {',
    'candidate lock completion release',
)

page = replace_once(
    page,
    '    remainingOneRescueFrameCount: Number(rescueState?.rescueFrameCount || 0),\n    rescueAttemptDiagnostic: {',
    '    remainingOneRescueFrameCount: Number(rescueState?.rescueFrameCount || 0),\n    candidateLockVariant: rescueState?.candidateLockVariant || "CURRENT",\n    candidateLockApplied: Boolean(rescueState?.candidateLockApplied),\n    candidateLockTargetRoiId: rescueState?.candidateLockTargetRoiId || null,\n    candidateLockDiagnosticId: rescueState?.candidateLockDiagnosticId || null,\n    candidateLockStartFrame: Number.isFinite(rescueState?.candidateLockStartFrame) ? rescueState.candidateLockStartFrame : null,\n    candidateLockEndFrame: Number.isFinite(rescueState?.candidateLockEndFrame) ? rescueState.candidateLockEndFrame : null,\n    candidateLockReleaseReason: rescueState?.candidateLockReleaseReason || null,\n    candidateLockHoldRescueFrames: Number(rescueState?.candidateLockHoldRescueFrames || CANDIDATE_LOCK_HOLD_RESCUE_FRAMES),\n    rescueAttemptDiagnostic: {',
    'latency candidate lock fields',
)

page = replace_once(
    page,
    '    remainingOneRescueFrameCount: latencyFull.remainingOneRescueFrameCount,\n    candidateRescueHitFrameCount: latencyFull.candidateRescueHitFrameCount,',
    '    remainingOneRescueFrameCount: latencyFull.remainingOneRescueFrameCount,\n    candidateLockVariant: latencyFull.candidateLockVariant || "CURRENT",\n    candidateLockApplied: Boolean(latencyFull.candidateLockApplied),\n    candidateLockTargetRoiId: latencyFull.candidateLockTargetRoiId || null,\n    candidateLockStartFrame: latencyFull.candidateLockStartFrame ?? null,\n    candidateLockEndFrame: latencyFull.candidateLockEndFrame ?? null,\n    candidateLockReleaseReason: latencyFull.candidateLockReleaseReason || null,\n    candidateLockHoldRescueFrames: latencyFull.candidateLockHoldRescueFrames ?? null,\n    candidateRescueHitFrameCount: latencyFull.candidateRescueHitFrameCount,',
    'management short candidate lock fields',
)

assert 'completionBeforeRescue.kind === "registered"' in page
assert 'candidateLockTargetFromEvidence(evidenceRef.current)' in page
assert 'rescueState.rescueFrameCount < CANDIDATE_LOCK_HOLD_RESCUE_FRAMES' in page
assert 'CANDIDATE_LOCK_VARIANT = "TEMP_LOCK_12"' in page
assert 'candidateLockApplied: Boolean(state?.candidateLockApplied)' in page

marker = 'console.log("Live unknown-safe contract and evaluation wiring tests passed.");'
if marker not in test:
    raise SystemExit('test marker missing')
extra = '''\n{\n  const page = fs.readFileSync("app/eval/certificate-qr-live-scan/page.jsx", "utf8");\n  assert(page.includes('const CANDIDATE_LOCK_VARIANT = "TEMP_LOCK_12";'));\n  assert(page.includes('const CANDIDATE_LOCK_HOLD_RESCUE_FRAMES = 12;'));\n  assert(page.includes('completionBeforeRescue.kind === "registered"'));\n  assert(page.includes('candidateLockTargetFromEvidence(evidenceRef.current)'));\n  assert(page.includes('rescueState.rescueFrameCount < CANDIDATE_LOCK_HOLD_RESCUE_FRAMES'));\n  assert(page.includes('candidateLockReleaseReason = "hold-window-complete"'));\n  assert(page.includes('candidateLockReleaseReason = "confirmed-during-lock"'));\n}\n\nconsole.log("Registered remaining-one Candidate-Lock PoC wiring tests passed.");'''
test = test.replace(marker, marker + extra, 1)

page_path.write_text(page)
test_path.write_text(test)
print('Candidate-Lock PoC patch applied successfully')
