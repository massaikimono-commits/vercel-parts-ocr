# Parts OCR Stage A6 — row miss-mechanism diagnostic

Source branch: `experiment/parts-ocr-stage-a6-miss-diagnostic`

Route: `/ocr/diagnostic/stage-a6`

Frozen OCR body remains:
`work/parts-ocr-regression@6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`

## Fixed baseline

Stage A5-D (`rules-uncovered vertical gap selective TSV rescue`) is reproduced unchanged and treated as the provisional row-proposal baseline.

Expected formal A5-D aggregate:
- candidate 79
- GT coverage 33/54
- false 45
- duplicate 1
- both miss 21

The A6 page reports whether the reproduced D baseline matches these values before the miss-mechanism summary is interpreted.

## Miss classification

Only GT rows missed by D are classified, and only after all proposals are generated.

- A: neither rules nor raw TSV line provides row coverage and no candidate band overlaps the GT row
- B: raw TSV line covers the GT row but consolidation loses it
- C: consolidated TSV covers the GT row but rules-gap selective rescue removes it
- D: a generated candidate band overlaps the GT row but its center falls outside the GT band (localization / band geometry miss)
- E: pathological TSV segmentation image (collapse flag); the non-pathological proposal-failure mechanism is also reported separately
- F: unclassified

Pathological TSV is kept separate from proposal-failure facts so a collapse flag does not imply the TSV path is wholly useless.

## Outputs

- D baseline candidate / coverage / recall / false / duplicate / both miss
- A-F miss counts
- per-image miss classification
- per-miss stage facts and nearest center distances
- A4 raw-line rescue rows lost by D and their cause
- pathological TSV image list
- stage counts for rules, raw TSV line, consolidated TSV line, and D rescue

No detector threshold, OCR engine, paper bbox, segmentation parameter, or production route is changed.
