# ICB overnight continuation — 2026-10-04

Continues candidate `candidate/icb-continuation-20261003` / Draft PR #93 from `4578802eeead79e2d107707515238ead991a3b87`. Remote was confirmed before isolated clone `/private/tmp/icb-night-20261003` and before push. Original workspace remains clean main `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`; other worktrees and prior evidence preserved. No rollback, Reset Ticket, forced push or specialist candidate integration.

## Current implementation and parent-spec audit

See current-implementation-audit.json. Last4-only schedule search is now resolved by the latest explicit user contract, replacing the prior specification hold. Customer/vehicle name/phone search stays in its own route. Customer-visit waiting remains reason-independent; delivery rows can no longer set waiting while retaining themselves, and instead link to the related inbound editor. Existing waiting cleanup/nulling contracts were retained. Hours/capacities/cancellation scope and print rules were preserved and regression checked. No formal new spec was imported.

## Remediation

Edit state is keyed by entry ID/mode, inaccessible during incomplete reads; initial and subsequent option failures have retry, with latest-response ownership and explicit waiting payload. Save/cancel share a synchronous lock; uncertain or partial edit writes require canonical reread. Completed cancellation result navigation remains outside disabled controls. Cancellation does not depend on time-option availability.

Existing-vehicle registration serializes preflight/write, rejects mismatched option dates, and stops current-page blind retry after partial/uncertain writes. It exposes vehicle history for review. This is not a transaction or persistent idempotency guarantee: full atomicity is DB_REQUIRED_HOLD.

Daily work statuses serialize per work ID across duplicate desktop/mobile controls; navigation during writes re-reads the current day instead of applying old data. Loaner daily/weekly boards validate dates, synchronize URLs, reject obsolete responses, distinguish read errors from empty/zero and offer retry. Daily loaner creation/status/return operations share a synchronous guard; Enter submission, NFKC last4 and malformed display timestamps are covered. Workload publishes complete reads, guards assignments, persists worker/filter URLs and tolerates malformed stay timestamps. Existing caps remain explicitly disclosed: loaner demand 300; workload 500, detected with one extra sentinel.

## Validation

19 focused actual-function tests PASS; 54 regression/build stages + optimized Next build PASS with dummy public fixture environment. 64 intercepted Chromium checks PASS; zero page errors; 28 additional route/404 smoke checks and 390/768/1440 widths, including edit/cancel/active/loaner/workload and long data. All shared database traffic blocked. Unit/build outputs, browser request records and screenshots are committed here. Original compiler standalone invocation required Next-generated JS configuration; the standard build typecheck PASS.

OCR integration and print model/rules regressions remain in the full build; no algorithms, migration SQL, workflow policy, dependencies or lockfile edited. Physical A4/A3 acceptance, actual authenticated data and iPhone/iPad/Safari are not established by Chromium fixtures. Inherited fixed A3 screen preview width was not redesigned.

## Security / CI / Preview

Local production audit still reports the braces advisory through vinext build tooling. Current registry latest is 3.0.3; advisory API has no patched version. D/E/F/H classification retained; real request exposure was not demonstrated, and deployed Cloudflare graph was not proven. No safe update, breaking downgrade, suppression, threshold change or gate removal. Security remains HOLD. Exact final SHA and remote CI/guarded Preview result are recorded after normal push in PR #93 and `/private/tmp/icb-night-final-evidence.json`, avoiding self-referential commit SHA.

## Holds / next phase

Delivery presets/custom time DB-required UX, legal_3m apply and atomic multi-RPC edit/registration remain DB_REQUIRED_HOLD. Authenticated live Acceptance / actual iPhone/iPad/Safari / physical printing remain USER_DEVICE_REQUIRED. Generic externally concurrent offset pagination has no snapshot guarantee. Next: published safe dependency remediation → full CI → guarded non-Production Preview → authenticated real-device/printing Acceptance. Main, Production, DB, credentials, frozen OCR and existing worktrees remain unchanged.

Checkpoint remote results (`20cb095`): Full regression 37166237648 stopped at dependency audit; OCR test jobs hit the same audit; routing and deployment safety passed. Guarded Vercel Preview 37166263343 skipped. Existing Cloudflare Git integration independently produced a candidate Preview version, as GitHub check output explicitly identifies Preview URL / Preview Alias URL. This is evidence of an automatic non-Production version, not acceptance or a manual gate bypass. See checkpoint-cloudflare-preview.json. Security HOLD remains; final exact HEAD checks are externally captured. Build log whitespace normalized without source changes.
