# Parts OCR Stage A10 — ALT Selective Pruning / Row-slot Reconciliation

Source branch: `experiment/parts-ocr-stage-a10-alt-pruning`

Route: `/ocr/diagnostic/stage-a10`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Lineage

Stage A10 source is based on the verified Stage A9 source implementation. The Stage A10 eval branch is created from the final Stage A10 source HEAD and differs only by the Stage A10 evaluation workflow.

## Fixed inputs

- AUTO: PSM 3, unchanged
- ALT: SPARSE_TEXT / PSM 11, unchanged
- no additional PSM
- no preprocessing change
- no targeted split / S
- no D candidate movement or deletion
- no OCR text semantics

## Baseline and reference

A5-D remains the provisional baseline.

Expected D:
- candidate 79
- coverage 33/54
- false 45
- duplicate 1

A9 ALT is reproduced as the experimental reference:
- coverage 44/54
- new rescue +11
- false 98
- duplicate 15

## ALT candidate features

Every A9 ALT-only proposal records GT-independent geometry features:

- center Y / top / bottom / height
- SPARSE_TEXT word count
- vertical Y spread
- x span and x-span / paper-width ratio
- height / document median D-row height
- nearest D center distance
- nearest D band overlap
- D gap above / below
- robust document row pitch
- nearest missing-row slot distance
- AUTO raw-line support
- AUTO word-group support
- rule support
- table-envelope membership
- nearby ALT proposal count
- document-relative word-count and x-span ratios
- compactness / height-similarity scores

GT is not used for these features.

## Row-slot reconciliation

A robust row pitch is estimated from D candidate centers using document-relative gap statistics.

For D gaps materially larger than the local pitch, one or more missing-row slots are hypothesized from the gap geometry only.

A leading and trailing edge slot can also be proposed when the slot remains within the table envelope.

The table envelope is estimated from D + rule + AUTO line geometry and expanded by the document pitch; no fixed GT coordinate is used.

## Variant G

G uses gap/row-slot reconciliation only.

ALT-only proposals must:
- remain in the estimated table envelope
- not materially overlap an existing D band
- lie close to a missing-row slot

One ALT proposal is selected per slot, ranked only by slot-center distance.

## Variant G+SCORE

G+SCORE uses the same slot model, but candidate ranking additionally uses:

- slot-center distance
- cluster compactness
- height similarity to document D rows
- relative word count
- relative x span
- AUTO raw-line support
- AUTO word-group support
- rule geometry support

All ranks are GT-independent and document-relative.

## Formal outputs

For D, A9 ALT, G, and G+SCORE:

- candidateCount
- gtCoverage / recall
- falseCount
- duplicateCount
- newRescueVsD
- retainedA9AltRescue
- lostA9AltRescue
- newRescueBeyondA9
- correctRowRegressionVsD
- bothMiss
- per-image coverage

Additional ALT selection metrics:

- altCandidateGenerated
- altCandidateAccepted
- altCandidateRejected
- falseReductionVsA9ALT
- duplicateReductionVsA9ALT
- mechanism rescue A/B/D

## Management Short Summary

Primary UI:
`総合管理用短縮summaryをコピー`

Secondary UI:
`詳細診断JSONをコピー`

The short summary targets <=6000 characters and contains only the management decision data.

A textarea converter is also present so an already captured Full Diagnostic JSON can be shortened without rerunning the 12 images.

Production and Frozen remain unchanged.
