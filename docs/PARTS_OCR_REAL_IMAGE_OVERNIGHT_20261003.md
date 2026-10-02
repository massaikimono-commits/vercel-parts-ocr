# Real-image diagnostic continuation — 2026-10-03

Status: diagnostic foundation verified; document-region prototype REJECTED.
No application adoption, main merge, production deployment, or DB operation.

## Input and scoring boundaries
15 HEIC originals were read only. Derived PNGs, local traineddata, OCR tokens,
scoring-only annotations, region crops and results stay in the ignored private
Orchestrator directory; no personal image or OCR text is included in this branch.
The local execution harness never imports ground truth. The separate scorer
requires complete fixed-set results and does not credit blanks on missing rows.

The user-provided yellow scope totals 54 rows, whereas the inherited corrected
manifest totals 60 (0677: 6 versus 5; 0686: 8 versus 3). This comparison explicitly
uses the latter for diagnosis, not formal adoption. White 0699/0700/0701 has 15
session annotations; identity with historical `(3).jpeg` files remains unverified.

## Measurement
P0/P1 bakeoff controls: zero matched and complete rows. These are the current
bakeoff source controls, not proof that the historical Frozen branch was executed.
P5 D-partial at PSM3: yellow 2/60 associated rows, 0/60 complete rows;
name 0, quantity 2, retail 2, cost 0; 29 false rows. White: 0/15, 3 false rows.
P6 document-local D-partial at the same PSM3: yellow 0/60 associated and complete,
75 false rows; white 0/15, 6 false rows. All four field scores are zero.
All 15 images completed without timeout in each measured run.
The P6 architecture therefore regresses and must not replace P5.

## Deliverables
Shared token acquisition handles Tesseract headerless TSV, headered TSV and block
fallback with geometry validation. Tests cover acquisition and fail-closed inputs.
Pure document-region/quad/warp module is an experimental evaluation helper only;
it is not connected to application execution. Multi-paper and pale-paper detection
are insufficient. No per-image coordinates, GT values or expected row counts drive it.
The offline runner executes local Tesseract and preserves fresh result directories.
Browser/Node orientation parity and full rotational robustness are not established.

## Validation
Orchestrator: 93 tests pass (85 inherited plus 8 discovery tests).
Token acquisition 18 assertions; scoring 8; regions 8; P5 4 synthetic cases;
semantic safety and bakeoff contract audit pass.
Full Next build passes with non-secret localhost:9 Supabase build placeholders.
No production credentials are copied or contacted. Initial builds failed because
required public configuration was absent; their evidence is retained.
No browser visual verification, CI or Preview was performed for this candidate.

## Next independent work
1. Resolve the 54/60 formal scoring source conflict and historical white identity.
2. Validate arbitrary column order and context-dependent unit-price header mapping.
3. Evaluate generic multi-document localization with explicit rejection and fallback.
4. Verify orientation parity and browser behavior before adoption.
Do not tune coordinates to these photographs or inject annotated values.
