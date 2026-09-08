# Parts OCR Stage A4 — row detector redesign experiment

Preview branch: `eval/parts-ocr-row-redesign-a4`

Source branch: `experiment/parts-ocr-row-redesign-a4`

Route: `/ocr/diagnostic/stage-a4`

Purpose:

1. Confirm the actual Tesseract.js 5.1.1 runtime TSV contract.
2. Parse the headerless `TessBaseAPI.GetTSVText()` geometry records.
3. Measure TSV-only row coverage.
4. Compare rules-only.
5. Measure rules + TSV union coverage / false / duplicate.

The experiment does not modify `work/parts-ocr-regression`, OCR engine settings, production routes, thresholds, paper bbox rules, or field segmentation.

The accepted manual row GT is used only after all candidate rows have already been generated.
