# Parts OCR Stage A16 — Late Candidate Gate Counterfactual

Status: diagnostic-only. A14 runtime acceptance is unchanged.

## Objective

Evaluate whether late-candidate precision can be improved with explainable geometry-only gates while preserving the A14 recoveries and avoiding fixed-12 overfit.

## Counterfactual gates

- G1: `phaseResidual >= threshold`
- G2: `existingPCandidateDistance >= threshold`
- G3: both conditions

Phase residual sweep: `10, 12, 14, 15, 16, 18, 20`.

Existing-P-candidate-distance sweep: `40, 60, 80, 100, 120`.

These values are scoring-only and are not runtime thresholds.

## Required accounting

Candidate-level and net GT effects are separated:

- `candidateCorrect`
- `candidateNewGtPotential`
- `netUniqueGtRecovery`
- `sameGtCompetingCandidate`

This prevents two candidates matching the same previously uncovered GT row from being counted as two net recoveries.

For every gate point report:

- accepted candidate count
- correct accepted
- false accepted
- candidate new-GT potential accepted
- net unique GT recovery
- already-covered duplicate
- same-GT competing candidate
- coverage counterfactual
- false counterfactual
- duplicate counterfactual
- correctRowRegressionVsD
- IMG_0678 row5 retained
- IMG_0685 row1 retained
- IMG_0677 5/5 retained
- IMG_0684 8/8 retained

Optional post-hoc leave-one-image-out reporting is supported for a selected counterfactual point. It does not tune runtime behavior.

## GT policy

GT is post-hoc scoring-only. It must not enter OCR, proposal generation, rowLike, pitch/phase generation, assignment, ranking, dedupe, or runtime acceptance.

## Prohibitions

No A14 acceptance change. No Frozen, Production, OCR engine, PSM, preprocessing, pitch/phase, assignment, dedupe, or Stage B changes. No IMG_0686-specific tuning.
