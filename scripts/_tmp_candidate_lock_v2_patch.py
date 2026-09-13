from pathlib import Path
import re
p=Path('app/eval/certificate-qr-live-scan/page.jsx'); s=p.read_text()
def one(a,b,n):
    global s
    if s.count(a)!=1: raise SystemExit(f'{n}: {s.count(a)} matches')
    s=s.replace(a,b)
one('const LIVE_SCAN_REVISION = "live-poc-v4-registered-remaining-one-candidate-lock-12";','const LIVE_SCAN_REVISION = "live-poc-v5-remaining-one-spatial-candidate-lock-v2";','revision')
one('const CANDIDATE_LOCK_VARIANT = "TEMP_LOCK_12";\nconst CANDIDATE_LOCK_HOLD_RESCUE_FRAMES = 12;','const CANDIDATE_LOCK_VARIANT_HOLD_12 = "HOLD_FIRST_CONTAINING_12";\nconst CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY = "CONTAINING_TARGETS_ONLY";\nconst CANDIDATE_LOCK_DEFAULT_VARIANT = CANDIDATE_LOCK_VARIANT_HOLD_12;\nconst CANDIDATE_LOCK_HOLD_FRAMES = 12;','constants')
one('''    if (position) candidate.positions.push({\n      frameId,\n      x: position.nx,\n      y: position.ny,\n      engine: hit.engine,\n      subRoiId,\n    });''','''    if (position) candidate.positions.push({\n      frameId,\n      x: position.nx,\n      y: position.ny,\n      engine: hit.engine,\n      subRoiId,\n      decodeIntegrityPass: Boolean(hit.decodeIntegrityPass),\n    });''','safe-position')
one('    candidateLockHoldRescueFrames: CANDIDATE_LOCK_HOLD_RESCUE_FRAMES,','    candidateLockX: null,\n    candidateLockY: null,\n    candidateLockContainingRoiIds: [],\n    candidateLockHoldFrames: CANDIDATE_LOCK_HOLD_FRAMES,','state')
one('    candidateLockHoldRescueFrames: Number(state?.candidateLockHoldRescueFrames || CANDIDATE_LOCK_HOLD_RESCUE_FRAMES),','    candidateLockX: Number.isFinite(state?.candidateLockX) ? state.candidateLockX : null,\n    candidateLockY: Number.isFinite(state?.candidateLockY) ? state.candidateLockY : null,\n    candidateLockContainingRoiIds: Array.isArray(state?.candidateLockContainingRoiIds) ? state.candidateLockContainingRoiIds : [],\n    candidateLockHoldFrames: Number(state?.candidateLockHoldFrames || CANDIDATE_LOCK_HOLD_FRAMES),','snapshot')
pat=re.compile(r'function candidateLockTargetFromEvidence\(evidenceMap\) \{.*?\n\}\n\nfunction createSubRoiStats\(\)',re.S)
rep=r'''function candidateLockVariantFromLocation() {
  try {
    const raw = new URLSearchParams(window.location.search).get("lockVariant");
    if (raw === CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY) return CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY;
    if (raw === CANDIDATE_LOCK_VARIANT_HOLD_12) return CANDIDATE_LOCK_VARIANT_HOLD_12;
  } catch {}
  return CANDIDATE_LOCK_DEFAULT_VARIANT;
}

function containingSubRoisForPoint(x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return [];
  return SUB_ROIS.filter((roi) => px >= roi.x && px <= roi.x + roi.w && py >= roi.y && py <= roi.y + roi.h)
    .sort((a,b) => Math.abs(px-(a.x+a.w/2))+Math.abs(py-(a.y+a.h/2))-(Math.abs(px-(b.x+b.w/2))+Math.abs(py-(b.y+b.h/2))));
}

function confirmedRawDiagnosticIds(state, evidenceMap) {
  return new Set([...evidenceMap.values()].filter((entry)=>entry?.confirmed)
    .map((entry)=>state?.diagnosticIdByDecoded?.get?.(entry.canonical)||null).filter(Boolean));
}

function candidateLockTargetFromSafeObservation(state, evidenceMap, preferredFrame = null) {
  const confirmedIds = confirmedRawDiagnosticIds(state, evidenceMap);
  return [...(state?.rawCandidates?.values?.() || [])]
    .filter((candidate)=>Boolean(candidate?.decodeIntegrityPass) && !confirmedIds.has(candidate?.diagnosticId))
    .map((candidate)=>{
      const safe=(candidate?.positions||[]).filter((position)=>position?.decodeIntegrityPass!==false)
        .map((position)=>({frameId:Number(position?.frameId),x:Number(position?.x),y:Number(position?.y)}))
        .filter((position)=>Number.isFinite(position.frameId)&&Number.isFinite(position.x)&&Number.isFinite(position.y));
      if(!safe.length) return null;
      const latest=Math.max(...safe.map((position)=>position.frameId));
      const first=Math.min(...safe.map((position)=>position.frameId));
      const recent=safe.filter((position)=>position.frameId>=latest-3);
      const x=medianNumber(recent.map((position)=>position.x));
      const y=medianNumber(recent.map((position)=>position.y));
      const containing=containingSubRoisForPoint(x,y);
      if(!containing.length) return null;
      return {diagnosticId:candidate.diagnosticId||null,firstSeenFrame:first,lastSeenFrame:latest,x:Number(x.toFixed(4)),y:Number(y.toFixed(4)),roi:containing[0],containingRoiIds:containing.map((roi)=>roi.id),observedOnPreferredFrame:Number.isFinite(Number(preferredFrame))&&latest===Number(preferredFrame)};
    }).filter(Boolean)
    .sort((a,b)=>Number(b.observedOnPreferredFrame)-Number(a.observedOnPreferredFrame)||Number(b.lastSeenFrame)-Number(a.lastSeenFrame)||Number(a.firstSeenFrame)-Number(b.firstSeenFrame))[0]||null;
}

function refreshCandidateLockSpatialTarget(state, rescueState) {
  const candidate=state?.rawCandidates?.get?.(rescueState?.candidateLockDiagnosticId)||null;
  if(!candidate||!candidate.decodeIntegrityPass) return null;
  const safe=(candidate.positions||[]).filter((position)=>position?.decodeIntegrityPass!==false)
    .map((position)=>({frameId:Number(position.frameId),x:Number(position.x),y:Number(position.y)}))
    .filter((position)=>Number.isFinite(position.frameId)&&Number.isFinite(position.x)&&Number.isFinite(position.y));
  if(!safe.length) return null;
  const latest=Math.max(...safe.map((position)=>position.frameId));
  const recent=safe.filter((position)=>position.frameId>=latest-3);
  const x=medianNumber(recent.map((position)=>position.x));
  const y=medianNumber(recent.map((position)=>position.y));
  const containing=containingSubRoisForPoint(x,y);
  if(!containing.length) return null;
  return {diagnosticId:candidate.diagnosticId||null,lastSeenFrame:latest,x:Number(x.toFixed(4)),y:Number(y.toFixed(4)),roi:containing[0],containingRoiIds:containing.map((roi)=>roi.id)};
}

function createSubRoiStats()'''
s,n=pat.subn(rep,s,count=1)
if n!=1: raise SystemExit(f'helper replacement: {n}')
st=s.index('      if (\n        !rescueState.active &&\n        remainingOne &&\n        !normalNovelStructural &&\n        stalledFrames >= LOCAL_RESCUE_STALL_FRAMES\n      ) {')
marker='        const target = SUB_ROIS.find((roi) => roi.id === rescueState.targetRoiId) || null;'
en=s.index(marker,st)+len(marker)
block='''      const requestedLockVariant = candidateLockVariantFromLocation();
      const safeSpatialCandidate = remainingOne
        ? candidateLockTargetFromSafeObservation(countingIntegrityRef.current, evidenceRef.current, frameId)
        : null;

      if (remainingOne && !rescueState.candidateLockApplied && safeSpatialCandidate) {
        rescueState.candidateLockVariant = requestedLockVariant;
        rescueState.candidateLockApplied = true;
        rescueState.candidateLockTargetRoiId = safeSpatialCandidate.roi.id;
        rescueState.candidateLockDiagnosticId = safeSpatialCandidate.diagnosticId;
        rescueState.candidateLockStartFrame = frameId;
        rescueState.candidateLockEndFrame = null;
        rescueState.candidateLockReleaseReason = null;
        rescueState.candidateLockX = safeSpatialCandidate.x;
        rescueState.candidateLockY = safeSpatialCandidate.y;
        rescueState.candidateLockContainingRoiIds = safeSpatialCandidate.containingRoiIds;
        rescueState.candidateLockHoldFrames = CANDIDATE_LOCK_HOLD_FRAMES;
        if (rescueState.active) rescueState.targetRoiId = safeSpatialCandidate.roi.id;
        if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
        rescueState.targetHistory.push({frameId,targetRoiId:safeSpatialCandidate.roi.id,reason:"candidate-safe-spatial-first-observed"});
      }

      if (remainingOne && rescueState.candidateLockApplied) {
        const refreshed = refreshCandidateLockSpatialTarget(countingIntegrityRef.current, rescueState);
        if (refreshed) {
          rescueState.candidateLockTargetRoiId = refreshed.roi.id;
          rescueState.candidateLockX = refreshed.x;
          rescueState.candidateLockY = refreshed.y;
          rescueState.candidateLockContainingRoiIds = refreshed.containingRoiIds;
        }
      }

      const lockAgeFrames = Number.isFinite(rescueState.candidateLockStartFrame)
        ? Math.max(0, frameId - Number(rescueState.candidateLockStartFrame)) : null;
      const candidateLockActive = remainingOne && rescueState.candidateLockApplied && (
        rescueState.candidateLockVariant === CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY ||
        (rescueState.candidateLockVariant === CANDIDATE_LOCK_VARIANT_HOLD_12 && Number.isFinite(lockAgeFrames) && lockAgeFrames < CANDIDATE_LOCK_HOLD_FRAMES)
      );

      if (rescueState.candidateLockApplied && rescueState.candidateLockVariant === CANDIDATE_LOCK_VARIANT_HOLD_12 && !candidateLockActive && !Number.isFinite(rescueState.candidateLockEndFrame)) {
        rescueState.candidateLockEndFrame = Math.max(Number(rescueState.candidateLockStartFrame || frameId), frameId - 1);
        rescueState.candidateLockReleaseReason = "hold-window-complete";
        if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
        rescueState.targetHistory.push({frameId,targetRoiId:rescueState.targetRoiId,reason:"candidate-lock-release"});
      }

      if (!rescueState.active && remainingOne && !normalNovelStructural && stalledFrames >= LOCAL_RESCUE_STALL_FRAMES) {
        const scheduledTarget = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
        const lockTarget = candidateLockActive ? SUB_ROIS.find((roi)=>roi.id===rescueState.candidateLockTargetRoiId)||null : null;
        const target = lockTarget || scheduledTarget;
        if (target) {
          rescueState.active = true;
          rescueState.activatedFrame = frameId;
          rescueState.targetRoiId = target.id;
          rescueState.triggerCount += 1;
          rescueState.variantCursor = 0;
          if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
          rescueState.targetHistory.push({frameId,targetRoiId:target.id,reason:lockTarget?"candidate-lock-rescue-activation":"activation"});
        }
      }

      if (rescueState.active && remainingOne) {
        if (candidateLockActive) {
          const containingIds = Array.isArray(rescueState.candidateLockContainingRoiIds) ? rescueState.candidateLockContainingRoiIds : [];
          const ranked = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current);
          const lockTarget = ranked.find((roi)=>containingIds.includes(roi.id)) || SUB_ROIS.find((roi)=>roi.id===rescueState.candidateLockTargetRoiId) || null;
          if (lockTarget) {
            const previousTargetRoiId = rescueState.targetRoiId;
            rescueState.targetRoiId = lockTarget.id;
            rescueState.candidateLockTargetRoiId = lockTarget.id;
            if (previousTargetRoiId !== lockTarget.id) {
              if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
              rescueState.targetHistory.push({frameId,targetRoiId:lockTarget.id,previousTargetRoiId,reason:rescueState.candidateLockVariant===CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY?"candidate-lock-containing-only-follow":"candidate-lock-hold-follow"});
            }
          }
        } else if (rescueState.rescueFrameCount > 0 && rescueState.rescueFrameCount % LOCAL_RESCUE_RETARGET_EVERY_FRAMES === 0) {
          const retarget = selectSubRois(frameId, evidenceRef.current, subRoiStatsRef.current)[0] || null;
          if (retarget) {
            const previousTargetRoiId = rescueState.targetRoiId;
            rescueState.targetRoiId = retarget.id;
            if (previousTargetRoiId !== retarget.id) {
              rescueState.retargetCount = Number(rescueState.retargetCount || 0) + 1;
              if (!Array.isArray(rescueState.targetHistory)) rescueState.targetHistory = [];
              rescueState.targetHistory.push({frameId,targetRoiId:retarget.id,previousTargetRoiId,reason:"scheduled-retarget"});
              if (rescueState.targetHistory.length > 96) rescueState.targetHistory = rescueState.targetHistory.slice(-96);
            }
          }
        }

        const target = SUB_ROIS.find((roi) => roi.id === rescueState.targetRoiId) || null;'''
s=s[:st]+block+s[en:]
one('        rescueState.candidateLockReleaseReason = "confirmed-during-lock";','        rescueState.candidateLockReleaseReason = "confirmed-after-spatial-lock";','release')
marker='function managementShortFromLiveFull(full, runtimeHead = null) {\n  const counting = full?.countingIntegrityDiagnostic || {};'
compact='''function managementShortFromLiveFull(full, runtimeHead = null) {
  const latency = full?.remainingOneLatencyDiagnostic || {};
  const completion = full?.completion || full?.parserSeparatedEvaluation?.currentCompletion || {};
  const lockGuard = latency?.rescueAttemptDiagnostic?.candidateLockRetargetGuardCounterfactual || {};
  const currentConfirmed = full?.confirmedQrCount ?? full?.parserSeparatedEvaluation?.currentConfirmedCount ?? null;
  const expected = completion?.expectedQrCount ?? completion?.expected ?? full?.parserSeparatedEvaluation?.currentCompletion?.expectedQrCount ?? null;
  const complete = Boolean(completion?.complete ?? full?.parserSeparatedEvaluation?.currentCompletion?.complete);
  const vehicleKind = completion?.kind ?? full?.parserSeparatedEvaluation?.currentCompletion?.kind ?? "unknown";
  const currentMissing = Number(full?.parserSeparatedEvaluation?.currentConfirmedMissingFromSeparatedCount || 0);
  const duplicate = Boolean(full?.countingIntegrityDiagnostic?.duplicatePayloadPhysicalQrCandidateDetected);
  return {
    schema: "icb-live-candidate-lock-management-short-v2",
    HEAD: full?.evaluation?.head || runtimeHead || null,
    vehicleKind,
    confirmed: currentConfirmed,
    expected,
    complete,
    finalQrWaitFrames: full?.parserSeparatedEvaluation?.acquisitionLatencyDiagnostic?.finalQrWaitFrames ?? null,
    firstSeenToConfirmationFrames: latency?.firstSeenToConfirmationFrames ?? null,
    lockVariant: latency?.candidateLockVariant || "CURRENT",
    lockApplied: Boolean(latency?.candidateLockApplied),
    lockStartFrame: latency?.candidateLockStartFrame ?? null,
    covered: lockGuard?.actualCoveredAttemptsAfterFirstSeen ?? latency?.rescueAttemptDiagnostic?.attemptContainingCandidatePositionCount ?? null,
    missed: lockGuard?.actualMissedAttemptsAfterFirstSeen ?? latency?.rescueAttemptDiagnostic?.attemptMissingCandidatePositionCount ?? null,
    outside: lockGuard?.actualFramesSpentOutsideCandidateRegion ?? null,
    regression: {currentRecognizedLoss: currentMissing, duplicateIntegrityPass: !duplicate},
    decision: complete && currentMissing === 0 && !duplicate ? "POC_RUN_COMPLETE" : "HOLD",
    productionChanged: false,
  };

  const counting = full?.countingIntegrityDiagnostic || {};'''
one(marker,compact,'short')
s=s.replace('candidateLockHoldRescueFrames: Number(rescueState?.candidateLockHoldRescueFrames || CANDIDATE_LOCK_HOLD_RESCUE_FRAMES),','candidateLockHoldFrames: Number(rescueState?.candidateLockHoldFrames || CANDIDATE_LOCK_HOLD_FRAMES),')
p.write_text(s)
t=Path('scripts/certificate-qr-live-unknown-safe-contract-test.mjs'); ts=t.read_text()
old='''{\n  const page = fs.readFileSync("app/eval/certificate-qr-live-scan/page.jsx", "utf8");\n  assert(page.includes('const CANDIDATE_LOCK_VARIANT = "TEMP_LOCK_12";'));\n  assert(page.includes('const CANDIDATE_LOCK_HOLD_RESCUE_FRAMES = 12;'));\n  assert(page.includes('completionBeforeRescue.kind === "registered"'));\n  assert(page.includes('candidateLockTargetFromEvidence(evidenceRef.current)'));\n  assert(page.includes('rescueState.rescueFrameCount < CANDIDATE_LOCK_HOLD_RESCUE_FRAMES'));\n  assert(page.includes('candidateLockReleaseReason = "hold-window-complete"'));\n  assert(page.includes('candidateLockReleaseReason = "confirmed-during-lock"'));\n}\n\nconsole.log("Registered remaining-one Candidate-Lock PoC wiring tests passed.");'''
new='''{\n  const page = fs.readFileSync("app/eval/certificate-qr-live-scan/page.jsx", "utf8");\n  assert(page.includes('const CANDIDATE_LOCK_VARIANT_HOLD_12 = "HOLD_FIRST_CONTAINING_12";'));\n  assert(page.includes('const CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY = "CONTAINING_TARGETS_ONLY";'));\n  assert(page.includes('const CANDIDATE_LOCK_HOLD_FRAMES = 12;'));\n  assert(page.includes('candidateLockTargetFromSafeObservation(countingIntegrityRef.current, evidenceRef.current, frameId)'));\n  assert(page.includes('reason:"candidate-safe-spatial-first-observed"'));\n  assert(page.includes('decodeIntegrityPass: Boolean(hit.decodeIntegrityPass)'));\n  assert(page.includes('rescueState.candidateLockVariant === CANDIDATE_LOCK_VARIANT_CONTAINING_ONLY'));\n  assert(page.includes('"candidate-lock-containing-only-follow"'));\n  assert(page.includes('"candidate-lock-hold-follow"'));\n  assert(page.includes('candidateLockReleaseReason = "hold-window-complete"'));\n  assert(page.includes('candidateLockReleaseReason = "confirmed-after-spatial-lock"'));\n  assert(page.includes('schema: "icb-live-candidate-lock-management-short-v2"'));\n  assert(page.includes('productionChanged: false'));\n}\n\nconsole.log("Remaining-one spatial Candidate-Lock v2 and MANAGEMENT_SHORT wiring tests passed.");'''
if old not in ts: raise SystemExit('test tail not found')
t.write_text(ts.replace(old,new))
