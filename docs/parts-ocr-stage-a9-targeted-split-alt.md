# Parts OCR Stage A9 — Targeted Row Split + Single Alternate Segmentation PoC

Source branch: `experiment/parts-ocr-stage-a9-targeted-split-alt`

Route: `/ocr/diagnostic/stage-a9`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Baseline

A5-D remains the provisional row-proposal baseline and is reproduced unchanged.

Expected aggregate:
- candidate 79
- GT coverage 33/54
- false 45
- duplicate 1

## Variant S — targeted split

Existing D candidates are never moved or removed.

A secondary split hypothesis is created only when a D candidate contains multiple independent vertical evidence modes derived from:
- raw AUTO TSV level-4 line geometry
- AUTO word-group geometry
- document median candidate/evidence height

Mode count comes from geometry clustering only. There is no fixed two-way split, image-name branch, or GT row-count control.

Only secondary modes not already represented by an existing D center are added.

## Variant ALT — one fixed alternate segmentation

AUTO (PSM 3) remains unchanged.

A second geometry-only OCR pass uses exactly one alternate segmentation:
- SPARSE_TEXT (PSM 11)

No PSM sweep, image-specific PSM, or preprocessing change is allowed.

SPARSE_TEXT level-5 words are vertically clustered using their document median word height. Clusters with at least two words produce ALT row proposals.

ALT proposals are selectively used only when AUTO structure is abnormal:
- pathological AUTO TSV, or
- enough AUTO words are present while AUTO surviving word-row clusters are markedly fewer than the AUTO level-4 hierarchy.

ALT proposals are not raw-unioned; candidates already represented by D/S geometry are filtered out.

## Variants

- D baseline
- S targeted split only
- ALT selective SPARSE_TEXT rescue only
- S+ALT

## Required metrics

Each variant reports:
- candidateCount
- gtCoverage / recall
- falseCount
- duplicateCount
- newRescueVsD
- correctRowRegressionVsD
- bothMiss
- per-image coverage
- splitCandidateCount / splitNewRescue / splitFalseAdded
- altCandidateCount / altOnlyCandidateCount / altNewRescue / altFalseAdded
- pathologicalRecoveredRows
- A/B/D mechanism rescue counts

## Management Short Summary standard

This harness is created with two output layers from day one:

1. `Management Short Summary`
   - primary copy button
   - target <= 6000 characters
   - contains schema/revision/eval branch+HEAD/baseline/variant comparison/regression/mechanism aggregate/important cases/Production+Frozen status

2. `Full Diagnostic JSON`
   - secondary copy button
   - no length limit

The page also accepts a previously captured Full Diagnostic JSON and converts it into the management short form without rerunning the 12 images.

GT is used only after candidate generation for scoring and mechanism attribution.
