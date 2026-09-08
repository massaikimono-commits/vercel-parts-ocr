# Parts OCR Stage A15 — Late Candidate Precision Decomposition

Stage A15 is diagnostic-only. It does not change Stage A14 acceptance behavior.

## Baseline
- A12 P is the phase-lock reference.
- A13 loss decomposition: PASS.
- A14 late reconsideration mechanism: PASS, precision insufficient.
- A14 formal yellow-12 result: 42/54 coverage, 73 false, 3 duplicate, D regression 0.
- A14 late candidates: considered 12, accepted 11, correct post-hoc 3, false post-hoc 8.

## Goal
Decompose all 12 A14-considered candidates into correct / false / rejected and compare geometry-only diagnostic features. No new threshold is selected in Stage A15.

The three correct late candidates are additionally classified as:
- NEW_GT_RECOVERY
- ALREADY_COVERED_GT_DUPLICATE
- OTHER

## Required diagnostics
Candidate-level telemetry includes phase residual, nearest phase-position distance, selected pitch, phase consensus support, rowLike score/components, candidate geometry, height/width proxies, vertical gap, neighboring accepted-row support, horizontal/column alignment proxies, existing-P candidate distance, and the original late-reconsideration reason.

OCR payload text is intentionally excluded.

## Protected rows/images
- IMG_0678 row5 recovery
- IMG_0685 row1 recovery
- IMG_0677 must remain 5/5
- IMG_0684 must remain 8/8

## Prohibited changes
No OCR engine, PSM, preprocessing, pitch, phase, assignment, dedupe, A14 acceptance, per-image special tuning, Frozen, Production, or Stage B changes.

## State
- Stage A15: GO
- Stage B: HOLD
- Production: HOLD
- Adopted HEAD: none
