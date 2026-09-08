# Parts OCR Stage A7 — targeted row rescue

Source branch: `experiment/parts-ocr-stage-a7-targeted-row-rescue`

Evaluation route: `/ocr/diagnostic/stage-a7`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Fixed baseline

Stage A5-D (`rules-uncovered vertical gap selective TSV rescue`) is reproduced unchanged and remains the provisional row-proposal baseline.

Expected aggregate:
- candidate 79
- GT coverage 33/54
- false 45
- duplicate 1

The page reports whether the baseline reproduces these values before any variant is interpreted.

## Variants

- P: D + consolidation preservation
  - preserves extra raw level-4 row-like centers only when document-adaptive geometry and word-group support indicate they are distinct from the consolidated representative.
- L: D + localization/band correction
  - adjusts consolidated TSV rescue bands using robust local geometry from raw lines and word groups; candidate count is not intentionally expanded.
- PL: D + preservation + localization
- F: PL + one conditional word-geometry fallback
  - enabled only for pathological TSV segmentation or a document-internal hierarchy deficit where independent word-geometry row clusters materially exceed the level-4 line hierarchy.

No OCR text meaning is used by candidate generation or selection.

## Formal outputs

For each variant:
- candidateCount
- GT coverage / recall
- false
- duplicate
- D-baseline new rescue
- D-baseline correct-row regression
- both miss
- per-image coverage
- post-hoc mechanism rescue counts (A/B/C/D/E/F)
- recovery of A4 line-rescue rows that A5-D lost

GT is used only after all candidates have been generated.
