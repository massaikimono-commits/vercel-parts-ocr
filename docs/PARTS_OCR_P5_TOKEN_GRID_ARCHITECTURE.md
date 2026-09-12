# Parts OCR P5 Token-Grid Hybrid PoC

## Goal

Break the 0-matched-row failure mode by changing the information flow, not by tuning A22 thresholds/crops.

## Architecture

P5 uses page-level OCR tokens with bounding boxes as the primary representation.

1. document/table localization is handled upstream by page OCR / document geometry.
2. OCR returns tokens + bounding boxes for the page/table rather than forcing OCR on pre-cut cells.
3. header tokens provide semantic column anchors (`name`, `qty`, `retail`, `cost`).
4. tokens are clustered into rows by vertical geometry.
5. each token is assigned to the nearest semantic column anchor.
6. row values are reconstructed after token assignment.
7. candidate stays fail-closed/manual-review in PoC; no auto-confirm is allowed.

## Root difference from P1/P2

P1 fixes cells first and runs OCR inside each cell. Recognition errors therefore destroy field evidence before row reconstruction.

P2 depends on PP-Structure table HTML and header parsing. If the structure adapter/header table is incomplete, the whole semantic row can disappear.

P5 preserves raw text boxes first and performs semantic reconstruction afterwards. Geometry and OCR evidence remain separately inspectable.

## Stage diagnostics

P5 exposes independently measurable stages:

- input token count
- mapped header field count
- clustered row count
- reconstructed row count
- per-row field values
- manual review / abstain reason

A real-photo runner should additionally expose document/table localization success before token reconstruction.

## Generalization controls

- no per-image coordinates
- no IMG_0675-0686 identifiers in runtime logic
- no GT import
- no GT coordinates
- no expected row count in runtime
- header aliases are generic business labels, not image-specific text
- translation/position invariance is tested
- partial header fails closed

## PoC safety

`manualReviewRequired=true` is unconditional for v0 PoC. `wrongAutoConfirm=0` by construction. This is an architecture-feasibility candidate only, not a Formal adoption candidate.

## Next evidence gate

Before Formal 12-image Work evaluation, run P5 on a small diverse real-photo subset using page-level token boxes. Required evidence:

- at least one real matched row (escape matchedRows=0)
- stage-by-stage row/column/OCR/mapping diagnostics
- wrongAutoConfirm=0
- fail-closed on ambiguous header/table

No threshold/crop tuning is permitted to obtain that evidence.
