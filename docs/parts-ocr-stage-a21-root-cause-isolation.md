# Stage A21 Cell-Crop / Recognizer Interface Root-Cause Isolation

Base formal A20 eval HEAD: `2dc6b74ffe2668dd12b97dd41ea77f730ec6a56f`.

## Scope

Diagnostic only. No recognition tuning, no A17/A19 threshold changes, no Production/Frozen changes. GT remains scoring-only.

## A20 code-audit findings

1. **Row-slot compaction confound (confirmed).** A20 appends an engine row only when at least one of the four recognized fields is non-empty. A completely blank dynamic row is omitted, so later non-empty predictions shift toward earlier GT indices. This can depress or distort field accuracy independently of OCR quality. Stage A20 remains a valid practical FAIL, but its per-index error attribution is not sufficient for root-cause proof.
2. **CTC decoder assumptions (must be measured, not assumed).** A20 assumes the class axis is the last output dimension, blank index is 0, dictionary class index is `best-1`, and an optional space occupies `dictLength+1`.
3. **Model/dictionary pairing.** A20 JA_LIGHT uses the PP-OCRv3 Japanese model with PaddleOCR `japan_dict.txt`; V5 uses `ch_PP-OCRv5_rec_mobile_infer.onnx` with `ppocrv5_dict.txt`. Stage A21 CI loads the exact assets and checks output class count against the exact dictionary length.
4. **Crop signal is not text correctness.** A20 `cropHasSignal` is only `contrast >= 35 && darkRatio > .002`; table rules, truncated glyphs, skew, and wrong-row text can all satisfy it. Stage A21 adds browser-only occupancy/bbox/edge/table-line/slope diagnostics without changing crop pixels.
5. **Deployed SHA metadata.** Stage A21 server page reads `VERCEL_GIT_COMMIT_SHA` first, then CI fallback, so deployed diagnostics do not report `unknown-preview-head` on Vercel.

## Model/decode invariant

`stage-a21-model-contract.py` downloads the exact A20 model/dictionary pairs, runs ONNX Runtime CPU inference on synthetic white / `12345` / `ABC123` samples with the same `[1,3,48,320]` normalization, then records:

- model input/output names and shapes
- output tensor dims
- last-axis class count
- dictionary length
- expected class count with and without `use_space_char`
- blank index and dictionary index offset assumed by A20
- synthetic raw decode and emitted indexes
- finite-output sanity

The CI job fails if the output last-axis class count is neither `dictLength+1` nor `dictLength+2`, or if model output contains non-finite values.

## Real-image rerun

HOLD until the static/model-contract audit is reviewed. If needed, Stage A21 crop instrumentation records browser-memory-only crop geometry, dark occupancy, ink bbox/margins, edge truncation, strong table-line evidence, centroid slope, raw/normalized recognizer output, confidence, and decoder metadata. No images/PII are committed or uploaded.
