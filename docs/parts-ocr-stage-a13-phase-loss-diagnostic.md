# Parts OCR Stage A13 — Phase-Lock Loss Decomposition

Source branch: `experiment/parts-ocr-stage-a13-phase-loss-diagnostic`

Route: `/ocr/diagnostic/stage-a13`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Purpose

Stage A13 is diagnostic-first.

The Stage A12 `P_phaseLocked` architecture is reproduced unchanged.

No new:
- PSM
- preprocessing
- acceptance rule
- pitch rule
- phase rule
- self-seed rule
- assignment rule
- row rescue
- semantic OCR selection
- image-specific branch

is added.

## Reference validity

The same formal yellow-12 run reproduces:
- A5-D
- A9 ALT
- A10 G
- A11 L
- A12 P

A12 P expected:
- coverage 40/54
- false 65
- duplicate 2
- new rescue +7
- retained A9 rescue 7
- D correct-row regression 0

A13 diagnostics are interpreted only when references reproduce.

## Lost-row definition

A lost-correct row is a GT row that was covered by:
- A9 ALT, or
- A11 L

but is not covered by:
- A12 P_phaseLocked.

GT is used only after all candidates / pitch / phase / assignment are complete.

## Loss classes

Each lost row is assigned to one post-hoc class:

1. `NO_ALT_CANDIDATE`
2. `NOT_ROW_LIKE`
3. `PITCH_HYPOTHESIS_MISS`
4. `PHASE_RESIDUAL_REJECT`
5. `ASSIGNMENT_LOSS`
6. `DEDUPE_CONFLICT`
7. `OTHER_GEOMETRY`

Classification does not alter the candidate set or runtime control.

## Saved success telemetry

Rows newly rescued by P relative to D are also recorded post-hoc.

This preserves the Stage A12 success mechanism, especially IMG_0677, without changing P.

## Management Short Summary

Primary:
`総合管理用短縮summaryをコピー`

Secondary:
`詳細診断JSONをコピー`

The short summary includes all five required images:
- IMG_0677
- IMG_0682
- IMG_0684
- IMG_0685
- IMG_0686

For each:
- A9 ALT coverage
- A11 L coverage
- P coverage
- rowLikeCandidateCount
- P accepted ALT count
- selectedPitch
- phaseConsensusSupport
- lostCorrectRowsByReason
- lost rowIndex + reason
- P new rescue row indexes

No OCR text payload is included.

GT remains post-hoc scoring / attribution only.

Production / Frozen remain unchanged.
