# Parts OCR Stage A12 — ALT Self-Seeded Phase-Locked Row Lattice

Source branch: `experiment/parts-ocr-stage-a12-phase-lattice`

Route: `/ocr/diagnostic/stage-a12`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Fixed OCR inputs

- AUTO: PSM 3
- ALT: SPARSE_TEXT / PSM 11
- no additional PSM
- no preprocessing change
- no targeted split / S
- no D candidate move/delete
- no OCR text semantics
- no image-name control

## Reference reproduction

The same 12-image run reproduces:
- A5-D baseline
- A9 ALT reference
- A10 G precision reference
- A11 L intermediate reference

Each has a formal validity flag before Stage A12 variants are interpreted.

## Phase-locked lattice

The lattice is never updated from the last accepted candidate.

Once a pitch + phase origin are selected, all row positions are generated as:

`phase + k * pitch`

Candidate position error therefore does not accumulate into later rows.

A missing candidate at one phase position does not stop the lattice. The next phase positions are evaluated independently until the geometry-derived envelope ends.

## Pitch hypotheses

A small set of document-derived pitch hypotheses is produced from:

- row-like ALT candidate centers
- D row centers

Very small sub-row gaps are suppressed.
Large missing gaps are suppressed from pitch evidence.
No fixed pixel pitch and no GT row count are used.

At most a small number of gap-mode hypotheses are evaluated.

## Phase consensus

For each pitch hypothesis, phase origins are scored using geometry only.

P:
- phase origins come from supported D evidence
- drift-free fixed phase

P_SELF:
- phase origins may also come from row-like ALT candidates
- ALT can therefore self-seed a periodic lattice

D support is a confidence boost rather than an absolute seed requirement.

Phase scoring uses:
- residual to the periodic phase
- rowLikeScore
- height similarity
- horizontal topology consistency
- AUTO raw-line / word-group / rule support

GT is not used.

## Candidate assignment

Each phase position accepts at most one ALT candidate.
Each ALT candidate can be assigned only once globally.

Ranking uses:
- phase-center distance
- rowLikeScore
- height similarity
- horizontal consistency
- column coverage
- compactness
- AUTO geometry support

No OCR text meaning is used.

## Required metrics

For D, A9 ALT, A10 G, A11 L, P, P_SELF:

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
- pitchHypothesisCount
- selectedPitch
- phaseConsensusSupport
- selfSeededLatticeCount
- DAnchoredLatticeCount
- phasePositionCount
- phaseMatchedPositionCount
- phaseUnmatchedPositionCount
- A/B/D mechanism rescue

Per-image management focus:
- IMG_0677
- IMG_0682
- IMG_0684
- IMG_0685
- IMG_0686

## Management Short Summary

Primary:
`総合管理用短縮summaryをコピー`

Secondary:
`詳細診断JSONをコピー`

Target length: <=6000 characters.

A Full Diagnostic JSON -> short summary converter is included so summary formatting never requires a repeated real-photo run.

GT remains post-hoc scoring and mechanism attribution only.

Production / Frozen are unchanged.
