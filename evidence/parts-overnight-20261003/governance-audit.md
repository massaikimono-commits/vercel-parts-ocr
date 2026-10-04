# Parts OCR architecture and governance audit

Date: 2026-10-03  
Model routing role: **Luna Fast Path**  
Checkout: `candidate/parts-ocr-generalization-overnight-20261003` at `a6e84cda32677c1d5a1f120b1ab48c21531e42eb`.

## Architecture gate source

The requested **ICB-SPEC v1.4 OCR Architecture Gate** could not be located in the checked-out tree or the available local Git refs. The search included tracked filenames and content on this recovery branch and `origin/candidate/parts-ocr-architecture-audit-20261003` (`865aa7ab941831ceab8b883434cb5478a72b1af8`). Those refs expose the general recognition decision record, P5 architecture note, bakeoff audit, and recovery report, but no ICB-SPEC v1.4 text. Gate-specific acceptance criteria therefore remain unverified; this audit does not reconstruct them from inference.

## Current inventory and disposition

- **Frozen dedicated/general — `REGRESSION_ONLY`.** `scripts/parts-ocr-frozen-local-regression.mjs` reproduces the exact extracted `runOCR` source from baseline ref `6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`. It preserves inherited fixed geometry and `SUPPLIER_PARTS` dictionary. That is useful for historical comparison and unsuitable as a new generalization path. The harness uses Node/Skia, so browser parity is unproven.
- **P0/P1 controls — `REGRESSION_ONLY`.** The bakeoff adapters in `app/ocr/bakeoff/` remain useful controls; the recovery comparison records no matched rows on diagnostic yellow60 or white15.
- **P5 token grid — `REGRESSION_ONLY`.** The implementation in `app/ocr/bakeoff/p5-token-evidence.mjs`, `p5-token-grid-core.mjs`, and browser adapters is generic page-token reconstruction with semantic header anchors and unconditional review. All tested variants produced zero complete rows in the current diagnostic cohort. This is a measured regression baseline, not an adopted product candidate.
- **P6 document-region experiment — `NO_OP_VERIFIED`.** `app/ocr/bakeoff/document-regions.mjs` remains an evaluation helper. `docs/PARTS_OCR_REAL_IMAGE_OVERNIGHT_20261003.md` explicitly labels the prototype rejected for multi-paper and pale-paper weaknesses. The recovery comparison also reports P6 as regressing against P5. No app route adopts it.
- **Stage A22 targeted crop diagnostic — `NO_OP_VERIFIED`.** `app/ocr/diagnostic/stage-a22/` is a browser-only diagnostic. Its invariant audit says recognition parameters, A17/A19 thresholds and row-slot compaction remain unchanged, and the crop/control implementation excludes formal GT. No Stage A23 source exists in the checked-out tree or available refs.
- **New architecture-level work — `IMPLEMENT` (parent task).** Continue only after resolving the exact v1.4 source and applying its real gate criteria. Do not adopt or tune any current candidate based on these diagnostic scores.

Machine-readable paths, refs, implementation roles, and dispositions are in [architecture-inventory.json](architecture-inventory.json).

## Stage A23 warning and GT boundary

No Stage A23 implementation or warning artifact was found in the inspected refs. The nearest prior code-audit warning is Stage A21’s confirmed **row-slot compaction confound**: blank recognized rows are omitted, which can shift later predictions against GT indices. Stage A21 also lists decoder shape/index assumptions and warns that crop signal does not prove text correctness. Stage A22’s invariant audit explicitly retains `rowSlotsCompacted:false` (meaning compaction was not changed in that audit), and the recovery notes do not claim to fix this attribution confound. Treat Stage A23 warnings as **not verified**, rather than inventing a finding.

GT governance evidence is mixed but bounded: recovery runners state `runtimeGtUsed=false` for all current P5/P6 results; source/runtime audit guards reject formal GT dependencies. Formal annotations are used post-hoc for scoring only. Existing historical evaluation pages do embed or collect GT for scoring, including Stage A19/A20/A21/A22 diagnostic surfaces; that is an evaluation surface, not a runtime feed. Do not extend those imports into candidate runtime or use labels, row counts, image IDs, coordinates, or expected outputs to steer detection. The prior P5 architecture note explicitly forbids GT imports, coordinates, and expected row counts in runtime.

## Baseline evidence and remaining holds

`evidence/real-photo-recovery-20261003/evidence-audit.json` records 15/15 outputs and matching derived-image hashes for each measured P5 PSM3, P5 PSM6, and P6 PSM3 run, with zero timeouts/errors and all `runtimeGtUsed=false`. `architecture-comparison.json` shows zero complete rows for all architectures. P5 PSM3 D-partial produced two associated yellow rows and zero complete rows; P5 PSM6 D-partial also produced two associated rows and zero complete rows. P6’s current architecture was rejected. These figures describe the diagnostic 60/15 annotations only.

Formal scope remains held. `formal-scope-gate.json` marks all 12 yellow and 3 white captures HOLD for unproven photo identity and non-formal annotations; it also flags count conflicts for yellow 0677 (5 vs 6), yellow 0686 (3 vs 8), and white 0699–0701 (3 vs 5). `summary.json` records the user scope as 54/9 while current diagnostic annotations total 60/15. White historical JPEG identity is unverified. Do not trim or reshape annotations to force formal totals.

Observed alignment misses do not identify physical root cause. The recovery report says independent row/column geometry annotations are needed before assigning segmentation blame. The Node/Skia path does not establish browser orientation parity. No model, runtime, production, database, Frozen baseline, or protected worktree changes were made by this inventory.

## Classification key

- `NO_OP_VERIFIED`: keep as isolated diagnostic/rejected path; no runtime adoption indicated.
- `REGRESSION_ONLY`: preserve as a control or historical reproduction for comparison.
- `REMEDIATE`: fix an identified, bounded defect before relying on the affected evidence. Current known example is the scoring-row compaction confound for per-index attribution; runtime GT must remain excluded.
- `IMPLEMENT`: proceed with fresh generalization architecture work only under the located and verified v1.4 gate. No runtime patch is included in this subtask.

No `Reset Ticket` was used or requested.
