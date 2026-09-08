# Parts OCR Stage A5 — selective TSV rescue

Source branch: `experiment/parts-ocr-stage-a5-selective-tsv-rescue`

Evaluation route: `/ocr/diagnostic/stage-a5`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Purpose

Keep horizontal-rule rows as the primary proposal source while testing whether actual-runtime TSV level-4 geometry can rescue rows selectively without reproducing the Stage A4 raw-union candidate explosion.

## Variants

- A: rules + consolidated level-4 line proposals
- B: rules + consolidated line proposals with level-5 child-word support
- C: rules + consolidated line proposals supported by TSV word-group geometry
- D: rules + consolidated TSV line proposals only in rule-uncovered vertical gaps

All thresholds are derived from the current document's own line heights, child support, word-group geometry, candidate spacing, and paper geometry. Manual GT is used only after candidate generation for post-hoc scoring.

## Formal outputs

For each variant:
- candidateCount
- GT coverage / recall
- false candidate
- duplicate candidate
- TSV-only new rescue retained
- Stage A4 level-4 rescue retained
- both miss
- per-image coverage

Stage B recognition remains out of scope.
