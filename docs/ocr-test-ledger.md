# OCR Test Ledger

Last updated: 2026-09-02
Shared baseline: see `docs/shared-project-state.md`

## Goal

Maintain one recoverable record of vehicle-certificate OCR and parts-slip OCR behavior so every chat can continue from the same test state.

## Vehicle certificate - active architecture

The production-target path is `/vehicle-workflow-v2`, which renders `vehicle-workflow-fast`.

Photo path:

1. QR starts first with a bounded wait.
2. QR values are preferred when available.
3. Legacy 32-cell sequential OCR has been reduced to four OCR bands.
4. Only missing critical top fields trigger one binary top-band retry.
5. Final merge is QR-preferred.
6. PDF with a healthy text layer uses native/structured PDF reading instead of image OCR where possible.

Important design rule: do not keep adding OCR layers when a more reliable source already supplies the field. Remove redundant OCR/legacy correction as confidence improves.

## Recent accuracy/stability work already in main

### QR density / distractor handling

Known Japanese certificate QR layouts are selected by positional fit so footer text/barcode-like noise cannot crowd out real QR candidates.
Regression coverage includes:

- size variation,
- vertical/horizontal framing boundaries,
- low contrast,
- uneven lighting,
- lower shadow,
- blur/soft focus,
- distractor/barcode/text noise,
- QR density performance,
- QR speed.

### Legacy override cleanup

PR #35 reduced post-OCR races on v2/fast:

- legacy fuel DOM heuristic disabled on v2/fast,
- legacy consistency re-push disabled on v2/fast,
- QR parser still fills `__vehicleCertificateQrPriority`,
- repeated post-OCR QR state dispatches are disabled on v2/fast,
- v2/fast retains one final QR-preferred authoritative merge.

A regression test prevents these old overrides from silently returning.

## Parts-slip - active architecture

Entry path: `/ocr/auto`.

- First pass classifies dedicated yellow supplier slip vs general table slip.
- Dedicated path: `/ocr`.
- General table path: `/ocr/general`.
- Unknown classification stops automatic routing rather than guessing.

### Dedicated yellow slip

Current fixed output fields:

- part name,
- quantity,
- retail/list price,
- cost.

Rows are read from calibrated table regions with dedicated name/number readers and supplier dictionary support for known part codes.

### General/white slip

General OCR uses OCR word coordinates/TSV, detects table headers, assigns words to columns, and falls back to text parsing only when structured column parsing is unavailable.

## Recent OCR pass reduction

PR #36 reduced OCR calls that did not contribute to the final answer:

- if a slip is already confidently classified as general, dedicated-marker rescue OCR is skipped,
- the yellow-slip amount column is read only when it can actually serve as a missing-cost fallback,
- a pass-budget regression test prevents those redundant reads from returning.

## Automated regression inventory

The CI regression suite currently covers:

- vehicle-certificate fixture regression,
- certificate v2 legacy-override guard,
- QR speed,
- QR photo contrast,
- QR distractor precision,
- QR density performance,
- parts-slip regression,
- parts OCR pass budget,
- yellow/white layout semantics,
- anonymized parts-photo fixtures,
- security regression,
- Next.js production build.

All of the above passed for PR #36 before merge.

## Practical test source boundary

The user has supplied many real-world certificate and parts-slip images in ChatGPT conversations. Those chat images are valuable practical-test inputs but are not automatically a durable GitHub fixture set.

When a real-image failure is found:

1. record the document type and failure symptom here,
2. reproduce with an anonymized/synthetic fixture where possible,
3. add a regression before merging the fix,
4. record PASS/FAIL after the fix,
5. never store customer-identifying raw documents in a public repository.

## Current deployed test boundary

Netlify Deploy Preview #4 is commit `6a9155e`, so it is older than current main.
Use it today as a practical-test baseline to find symptoms, but compare every failure against current main before writing another fix. A bug seen only on Preview #4 may already be fixed in source.

## Current practical-test priorities

1. Vehicle-certificate photos:
   - registration number,
   - chassis number,
   - registration/record dates,
   - model/engine,
   - weight/axle values,
   - fuel.
2. QR-less PDFs:
   - confirm native text-layer path,
   - registration number remains a historical weak point.
3. Yellow parts slips:
   - multiple photo angles of the same slip,
   - part-name stability,
   - quantity/list/cost column separation.
4. White/general slips:
   - header detection,
   - multi-line part names,
   - missing one of retail/cost columns,
   - occlusion/noise.

## Test record format

For each new practical case append:

- Case ID/date:
- Document type:
- Input condition:
- Expected fields:
- Actual fields:
- Failure:
- Source commit/deployment:
- Fix PR/commit:
- Regression added:
- Retest result:
