# Parts OCR Stage A8 — consolidation-loss + fallback-eligibility structure diagnostic

Source branch: `experiment/parts-ocr-stage-a8-structure-diagnostic`

Route: `/ocr/diagnostic/stage-a8`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Scope

Stage A8 is diagnostic-only.

It reproduces Stage A5-D unchanged, then traces why Stage A7 preservation / localization / fallback concepts did not solve the remaining misses.

No new rescue candidate, detector threshold, localization correction, alternate segmentation, OCR engine change, or production connection is added.

## B trace

For D-baseline misses whose non-pathological mechanism is B:

- raw line diagnostic ID
- raw center / height
- consolidation group / merge target
- group member centers / heights / center gaps
- level-5 child count
- word-group support
- exact Stage A7 preservation predicate facts
- preserve accepted/rejected and rejection reason

This includes the A4 raw-line rescue rows that D lost.

## D trace

For localization/band-geometry misses:

- nearest unchanged D candidate
- candidate normalized top / bottom / center / height
- GT normalized top / bottom / center
- overlap ratios
- candidate height relative to document median D-candidate height
- raw-line support
- word-group support
- number of GT row centers spanned by the candidate band
- document-adaptive broad-band diagnostic flag

The D candidate is never moved.

## A / fallback trace

For upstream-A misses and pathological images:

- level-5 word center-Y distribution
- word-height distribution
- x spans
- block / line hierarchy counts
- every word-cluster construction decision
- cluster count before and after singleton rejection
- exact reason `rowClusterCount` is low
- `structuralHierarchyDeficit` conditions
- `fallbackEligible` conditions and reason

OCR text content is not emitted.

## GT usage

GT is used only after all candidates and diagnostic structures exist, for:
- coverage scoring
- miss classification
- B/D post-hoc association
- lost-A4-rescue attribution

GT is not used for candidate generation, thresholds, fallback eligibility, preservation decisions, or control.
