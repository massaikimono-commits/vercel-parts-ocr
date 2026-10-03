# ICB Parts OCR — Real Photo Recovery / Evaluation

RESULT: NO_IMPROVEMENT / ARCHITECTURE_CHANGE_REQUIRED. No OCR runtime candidate adopted. Formal gates remain HOLD; independent diagnostic work completed.

## Dataset

- DATASET_INVENTORY: 100 image files across Downloads/Desktop/Pictures; 23 HEIC originals, no exact hash duplicate. Full filename/path/dimensions/hash inventory: local ignored `.eval-private/recovery/inventory.json`.
- Current parts photos: 12 yellow + 3 white HEIC, all 4032×3024; all original hashes, sizes and mtimes unchanged. Eight other HEIC are vehicle certificates and excluded.
- YELLOW_FORMAL_SET: user12/54 preserved; existing corrected annotation12/60. Conflicts0677:5vs6,0686:3vs8. Exact historic photo identities unproven.
- WHITE_FORMAL_SET: user3/9 preserved; current HEIC session3/15. Historic `(3).jpeg` correspondence unproven; cancel-line semantics unresolved.
- WHITE_REFERENCE_SET:0622/0623 not located; not merged into either white set.
- ADDITIONAL_REAL_PHOTOS:0 confirmed additional parts photos.
- UNMAPPED_REAL_PHOTOS:15 current parts photographs for formal identity; usable separately as diagnostic60/15.
- Formal4-field accuracy / correct rows / false rows / missed rows / blank correctness: NOT_SCORED, rather than substituted with60/15.

## Phase classification

| Phase | Classification | Result |
|---|---|---|
| Current state / protected refs | NO_OP_VERIFIED | Remote main/frozen unchanged; existing clean worktrees preserved |
| Inventory / diagnostic annotations | REGRESSION_ONLY | Reused manifests; current hash/content review |
| Formal reconciliation | REMEDIATE, HOLD | Historical hashes missing and row scope conflicting |
| Frozen reproduction | IMPLEMENT | New AST extraction harness; exact runOCR source-equivalence proof |
| Failure taxonomy / architecture comparison | REGRESSION_ONLY | Existing architectures, same fixed15 photos and model bytes |
| Formal scoring integrity | IMPLEMENT | Separate scoring-only fail-closed scope gate and tests |
| Candidate runtime | NO_OP_VERIFIED | No evidence-supported full-row improvement; adopt none |
| Build / evidence CI | REGRESSION_ONLY / IMPLEMENT | Historical OCR snapshot build; dedicated non-deploy CI |

## Diagnostic comparison — NOT formal scores

Same per-image PNG bytes, scorer normalization and weighted monotonic row alignment; exact source hashes verified. Yellow60 and white15 scored separately. These missing/false counts refer to scoring alignment, not independent physical row detection GT. Full per-image/row/field evidence: `failure-taxonomy.json`.

| Architecture | Subset | NAME | QUANTITY | LIST_PRICE | PURCHASE_PRICE | Correct rows | Matched rows | False rows | Missed rows | Blank | Timeout | Total ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| frozen-dedicated / FROZEN_ACTUAL_DEDICATED | YELLOW_DIAGNOSTIC_60 | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 2 | 60 | N/A | 0 | 63994 |
| frozen-dedicated / FROZEN_ACTUAL_DEDICATED | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 0 | 15 | 0/15 | 0 | 10602 |
| frozen-general / FROZEN_ACTUAL_GENERAL | YELLOW_DIAGNOSTIC_60 | 0/60 | 3/60 | 2/60 | 1/60 | 0 | 3 | 62 | 57 | N/A | 0 | 66976 |
| frozen-general / FROZEN_ACTUAL_GENERAL | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 27 | 15 | 0/15 | 0 | 11069 |
| p0-p1 / P0_BAKEOFF_CONTROL | YELLOW_DIAGNOSTIC_60 | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 59 | 60 | N/A | 0 | 41410 |
| p0-p1 / P0_BAKEOFF_CONTROL | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 14 | 15 | 0/15 | 0 | 10325 |
| p0-p1 / P1_BAKEOFF_RULES | YELLOW_DIAGNOSTIC_60 | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 36 | 60 | N/A | 0 | 30628 |
| p0-p1 / P1_BAKEOFF_RULES | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 14 | 15 | 0/15 | 0 | 6845 |
| p5-psm3 / D_PARTIAL_HEADER_COLUMN_LATTICE | YELLOW_DIAGNOSTIC_60 | 0/60 | 2/60 | 2/60 | 0/60 | 0 | 2 | 29 | 58 | N/A | 0 | 21839 |
| p5-psm3 / D_PARTIAL_HEADER_COLUMN_LATTICE | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 3 | 15 | 0/15 | 0 | 5917 |
| p5-psm6 / D_PARTIAL_HEADER_COLUMN_LATTICE | YELLOW_DIAGNOSTIC_60 | 0/60 | 2/60 | 2/60 | 0/60 | 0 | 2 | 92 | 58 | N/A | 0 | 90179 |
| p5-psm6 / D_PARTIAL_HEADER_COLUMN_LATTICE | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 16 | 15 | 0/15 | 0 | 13850 |
| p6-psm3 / D_PARTIAL_HEADER_COLUMN_LATTICE | YELLOW_DIAGNOSTIC_60 | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 75 | 60 | N/A | 0 | 36671 |
| p6-psm3 / D_PARTIAL_HEADER_COLUMN_LATTICE | WHITE_SESSION_15 | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 6 | 15 | 0/15 | 0 | 6452 |

All6 run modes completed15 images each (90 measurements); P0/P1 share one acquisition run, token mapping variants share recognition. Do not add variant timings. Shared CPU load makes times observational, not controlled speed benchmarks. Models: Tesseract.js/core5.1.1, same jpn+eng bytes; hashes in `frozen-provenance.json` and `evidence-audit.json`.

BASELINE: actual Frozen6a31ec4 dedicated and general paths, executed separately on all15. Modern P0 is a different bakeoff implementation and is not relabeled Frozen. AST preserved helper definitions and exact runOCR body; original transfer/profile modules retained. Node Skia adaptation is not a Safari/Chrome parity test. Invalid shim probes and invalid inherited headerless-TSV runs excluded.

REGRESSION: P5PSM3→P6PSM3 D-partial yellow matched2→0,false29→75,missed58→60; white false3→6. P5PSM6 yields no additional complete rows and yellow false92 versus PSM3 false29. Frozen general→P5PSM3 D-partial trades fewerfalse rows62→29 for quantity3→2 and purchase1→0; name remains0. No candidate dominates across fields/coverage.

CANDIDATE: none adopted. Existing P1/rule extraction, P5strict/composition/fuzzy/header-band/lattice, and P6 document-local candidates were evaluated; all complete rows0. P2/P4 managed engines remain non-executed architecture options; no new external provider, credentials or network OCR upload introduced.

## Failure taxonomy and integration

Taxonomy includes all requested13 categories. Each incorrect field has a dominant observed failure and confidence; unmatched rows are FALSE_NEGATIVE, unmatched predictions FALSE_POSITIVE. Matched blank mismatches are BLANK_SEMANTICS. Token presence can support FIELD_ASSOCIATION, but repeated numeric values do not establish causality. Recognition/segmentation/geometry causes without independent evidence remain ARCHITECTURE_LIMIT / UNRESOLVED. Column/header counts and token row clustering are separately observed. No timeout observed.

Architecture concerns: Frozen dedicated fixed fractional row lattice cannot cover heterogeneous/composite pages; Frozen general textual/TSV parsing has weak row association. Strict token reconstruction repeatedly lacks4 coherent header anchors. P6 localization changes crop/orientation scope and increases false rows. Neither additional tokens nor fuzzy header matching produces reliable names. Image quality and perspective are not assigned causal labels without geometry evidence.

Boundary audit: photo→shared preprocessing→OCR→parse→captured result arrays was executed through Frozen source extraction. Real browser HEIC decoding, auto route selection, localStorage transfer and visible UI are NOT_VERIFIED in this run. Handoff to ICB owner: audit actual browser decoding/transfer and explicit result ownership; do not treat this offline result-object capture as UI end-to-end acceptance. No ICB general UX changes.

## Validation / delivery / safety

- BRANCH: `eval/parts-real-photo-recovery-20261003`
- SOURCE_HEAD:865aa7ab941831ceab8b883434cb5478a72b1af8 (existing local unpushed diagnostic work preserved). Final HEAD is the commit containing this report; exact SHA in session final status.
- TEST: PASS — scope4, score8, token18, regions8, grid4 plus semantic/contract checks; all6 fixed photo runs complete, no errors/timeouts.
- BUILD: PASS with offline public placeholders (127.0.0.1:9); historical OCR evaluation snapshot Next14.2.25, not current-main integration acceptance. Initial wrong key variable failure retained separately and corrected; no credential changed. Logs remain ignored local evidence.
- CI: dedicated `Parts OCR recovery evidence integrity` workflow runs scoring/runtime contract tests only, not private photographs or deployment. Final run status recorded in session final status.
- PREVIEW: NOT_CREATED; no runtime candidate adopted, no deployment performed.
- GT_LEAKAGE:0 newly supplied runtime GT inputs; scoring code never runtime imported. Inherited Frozen supplier answer dictionary exists and was preserved solely to reproduce historical baseline, not added to or reused for candidate design. Dictionary-free generalized candidate required before any adoption.
- MAIN_CHANGED:NO; PRODUCTION_CHANGED:NO; DB_CHANGED:NO; CREDENTIAL_CHANGED:NO; FORCE_PUSH_USED:NO; FROZEN_BASELINE_CHANGED:NO; EXISTING_WORKTREE_DAMAGED:NO.

NEXT_RECOMMENDED_PHASE: reconcile historical review copies/hashes and business cancellation semantics; obtain approved54/9 fieldGT without trimming diagnostic annotations. Then use separately sourced development photographs for dictionary-free document-local row/column association and recognition architecture comparison; freeze runtime before formal evaluation. Existing failed P6 is not the default starting point.
