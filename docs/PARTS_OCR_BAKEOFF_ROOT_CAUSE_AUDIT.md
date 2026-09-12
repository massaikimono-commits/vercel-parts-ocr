# Parts OCR Bakeoff root-cause audit

Purpose: distinguish candidate OCR weakness from harness/adapter failure after the fixed 12-capture bakeoff produced 0% aligned accuracy.

Scope is diagnostic-only. Candidate version/config hashes, accuracy thresholds, crop logic, parser decisions, GT runtime isolation, scorer, Formal state, Frozen branches, shared DB, Preview, and Production are not changed.

The audit route is `/eval/parts-ocr-bakeoff-root-cause-audit`.

It records count-only evidence for each selected capture:

- P1 source/paper/rectified geometry
- horizontal and vertical rule counts
- P1 rule-bounded row candidate count
- P0/P1 emitted row counts and fail-closed reasons
- P2 table HTML count, HTML row count, header mapping coverage, parsed-row count, and text-like value count
- P2 emitted row count/manual-review state

No OCR text is included in the P2 diagnostic summary. GT is not loaded at runtime. Real images and diagnostic exports remain local/private and must not be committed or uploaded as public artifacts.
