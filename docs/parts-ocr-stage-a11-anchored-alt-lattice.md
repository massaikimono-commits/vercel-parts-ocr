# Parts OCR Stage A11 — Anchored ALT Row-Lattice + Multi-column Geometry Consensus

Source branch: `experiment/parts-ocr-stage-a11-anchored-alt-lattice`

Route: `/ocr/diagnostic/stage-a11`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Inputs kept fixed

- AUTO: PSM 3
- ALT: SPARSE_TEXT / PSM 11
- no additional PSM
- no preprocessing change
- no targeted split / S
- no D candidate move/delete
- no OCR text semantics
- no image-name control
- no GT control

## Reference reproduction

The harness reruns in one session:
- A5-D baseline
- A9 ALT reference
- A10 G precision reference

Each has an expected-value validity flag before L / L+C is interpreted.

## Horizontal topology

PSM11 level-5 word geometry is clustered into document-relative X lanes.

Each ALT proposal receives:
- occupied lane IDs
- occupied lane count
- column coverage
- x span / paper width
- word count
- horizontal consistency
- compactness
- height similarity
- AUTO raw-line support
- AUTO word-group support
- rule support

No word text is used.

## D anchors

D rows are retained.

High-confidence anchors are D candidates supported by at least two independent geometry sources among:
- AUTO raw lines
- AUTO word groups
- rule geometry

If no such anchor exists but one supported D row exists, a single weak fallback anchor can be used.

D=0 images do not receive lattice rescue.

## Vertical lattice pitch

Pitch is inferred from:
- high-confidence D anchor centers
- row-like ALT candidate centers
- repeated document-relative vertical gaps

Large missing gaps are excluded from the retained pitch evidence.

GT row count is not used.

## L — anchored ALT lattice

From each D anchor the lattice grows upward and downward.

After the first D anchor, subsequent steps may chain:
ALT -> ALT -> ALT

A D row is not required at every position.

At each predicted lattice center only one ALT proposal is chosen.

Existing D candidates remain unchanged.

## L+C — multi-column topology ranking / acceptance

Uses the same anchored lattice growth, but candidate ranking additionally uses:
- lattice-center distance
- lane coverage
- horizontal consistency
- compactness
- height similarity
- word count
- AUTO raw-line support
- AUTO word-group support
- rule support

The winner must also pass a document-relative row-likeness acceptance floor.

## Required metrics

For D, A9 ALT, A10 G, L, L+C:
- candidateCount
- gtCoverage / recall
- falseCount
- duplicateCount
- newRescueVsD
- retainedA9AltRescue
- lostA9AltRescue
- newRescueBeyondA9
- correctRowRegressionVsD
- altCandidateGenerated / accepted / rejected
- falseReductionVsA9ALT
- duplicateReductionVsA9ALT
- latticeCount
- anchoredLatticeCount
- latticeCandidateCount
- columnLaneCount
- rowLikeCandidateCount
- A/B/D mechanism rescue
- per-image coverage

## Management Short Summary

Primary:
`総合管理用短縮summaryをコピー`

Secondary:
`詳細診断JSONをコピー`

Short summary target: <=6000 characters.

A Full Diagnostic JSON -> short summary converter is also included so summary formatting alone never requires a repeated 12-image run.

GT is post-hoc scoring and mechanism attribution only.
