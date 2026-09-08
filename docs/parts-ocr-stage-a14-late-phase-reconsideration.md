# Parts OCR Stage A14 — Late Phase Reconsideration

Source branch: `experiment/parts-ocr-stage-a14-late-phase-reconsideration`

Route: `/ocr/diagnostic/stage-a14`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Purpose

Stage A14 evaluates one isolated mechanism:

- Keep Stage A12 `P_phaseLocked` fully unchanged as `P_CONTROL`.
- Only after P is complete, revisit existing ALT proposals that were rejected because `rowLike=false`.
- Only unmatched P phase positions are eligible for late reconsideration.

This targets Stage A13's dominant `NOT_ROW_LIKE` loss mechanism without mixing in pitch rescue.

## Fixed inputs

- AUTO PSM3
- ALT PSM11
- existing altNovel proposals only
- no new OCR
- no preprocessing change
- no new PSM
- no P_SELF
- no image-name control
- no OCR text semantic selection

## P_CONTROL immutability

Stage A14 does not alter:

- pitch hypotheses
- selected pitch
- phase origin
- phase positions
- P assignment ranking
- P assignment winners
- P accepted candidates
- global P dedupe architecture

A14 is additive-only:

`A14_R = P_CONTROL accepted rows + safe late candidates`

## Late reconsideration

Eligibility:

- candidate comes from existing altNovel proposals
- candidate has `rowLike=false`
- position is unmatched in P
- candidate center lies within the same geometry-derived P assignment tolerance:
  `selectedPitch * 0.35`

Safety:

- existing P accepted candidates are never replaced
- matched P positions are untouched
- one late candidate maximum per unmatched phase position
- one ALT candidate cannot be reused across positions
- P accepted candidate set remains intact

Ranking is geometry-only and uses:

- phase-center distance
- height similarity
- horizontal consistency
- column coverage
- compactness
- existing rowLikeScore telemetry
- AUTO raw-line support
- AUTO word-group support
- rule support

GT is not used for selection or ranking.

## Comparison

Same formal yellow-12 run:

- P_CONTROL
- A14_R_LATE_RECONSIDERATION

Reference validity also rechecks:

- A5-D
- A9 ALT
- A10 G
- A11 L
- A12 P

## Required metrics

Aggregate:

- candidateCount
- coverage / recall
- false
- duplicate
- newRescueVsD
- retainedA9AltRescue
- correctRowRegressionVsD
- lateCandidateConsidered
- lateCandidateAccepted
- lateCandidateCorrectPostHoc
- lateCandidateFalsePostHoc
- recoveredLostRows
- remainingLostRowsByReason

All Stage A13 lost rows are listed in the short summary as:

- fileName
- rowIndex
- A13 reason
- A14 recovered true/false

## Management Short Summary

Primary:
`総合管理用短縮summaryをコピー`

Secondary:
`詳細診断JSONをコピー`

Required important images:

- IMG_0677
- IMG_0682
- IMG_0684
- IMG_0685
- IMG_0686

For each:

- P coverage
- A14-R coverage
- rowLikeCandidateCount
- P accepted ALT count
- selectedPitch
- phaseConsensusSupport
- late considered / accepted
- A13 lost rows + recovered state

No OCR text payload is exposed.

GT remains post-hoc scoring / recovery attribution only.

Production / Frozen remain unchanged.
