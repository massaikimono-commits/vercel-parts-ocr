# ICB candidate continuation — 2026-10-03

START: PR #92, candidate/icb-app-overnight-20261003, 8b38adba491020cc58a5f8b0af1e8349c145d396. Remote main f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4. Original worktree clean and unchanged; specialist worktrees untouched.

Workspace: /private/tmp/icb-continuation-20261003 (independent clone, no hardlinks). Branch: candidate/icb-continuation-20261003. Prior 46-file batch retained, not reimplemented.

## CURRENT_IMPLEMENTATION_CHECK

See summary.json for per-area classifications. Existing schedule/new/edit preflight, duplicate feedback, search sequencing, schedule detail navigation and prior responsive implementations were inspected/reused. No full standalone parent v1.3/v1.4 document found; current repo docs/tests/evidence govern. Lightweight read-only audits made no edits.

## Confirmed remediation

- Staff/vendor empty notices now require successful reads; initial loading and failures cannot imply no registrations. Retry is available; successful retry clears old error copy.
- Staff/vendor actions synchronously serialize, always release after exceptions, disable editing during requests, and reject blank saved names. Add forms support Enter and preserve existing insert/update payloads.
- Unified history/photo metadata/lease history distinguish failed/missing-vehicle reads from successful empty results, with retry and live status.
- Customer vehicle search failure/auth missing cannot claim zero results; retry and search input accessible name added.
- Existing-customer linking cannot issue same-tick duplicate writes or restore an old vehicle selection. Successful mutation still updates the correct list row.
- Customer creation/save locks synchronously, and the real selection handler refuses switching during save. Existing database operations unchanged.
- Vehicle search heading moved from CSS-generated text to React source; visual and accessible names match.
- Inherited standalone separation test corrected to accept the existing route-conditional history button, then added to build.

## Validation

build.txt: 52 regression script stages and optimized Next build PASS. Added source-function execution tests cover thrown rejection recovery, duplicate settings actions, linking response after selection change, duplicate customer creation and selection lock. Browser-results.json records synthetic Chromium checks and 390/768/1440px screenshots; six additional changed routes verified at each width. Existing 28 core/print/PDF route smokes retained. No shared database traffic; only intercepted example.supabase.co fixtures. No OCR implementation, print dimensions or DB contract changes.

## Holds and limits

DB_REQUIRED_HOLD: delivery preset/custom mutation UX, legal_3m, photo write/delete foundation. The implemented saved delivery label display is retained. USER_DEVICE_REQUIRED: protected SSO Preview authenticated acceptance, real iPhone/physical print. SPEC_DECISION_REQUIRED: last4-only schedule search request versus broader current repo search contract. Fixed A3 daily-report screen overflow inherited; print geometry preserved. Smoke checks are not real write/PDF/physical print acceptance.

Main/Production/DB/credential gates remain HOLD. No force push, destructive cleanup or specialist edits. Final SHA/CI/Preview are recorded in the external final evidence to avoid self-referential commits.

NEXT: authenticated Preview device acceptance; then separately authorized DB/production compatibility planning for delivery/legal_3m. No automatic merge or promotion.
