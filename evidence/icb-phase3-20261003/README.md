# ICB Phase 3 evidence

Continues PR #93 from e99d5235544d0dc6bb2d763af093294e1aa3170a in independent clone `/private/tmp/icb-phase3-20261003`. Original workspace and other worktrees were preserved. Current implementation was checked before remediation; prior features were reused.

## Security

SECURITY_GATE_HOLD: GHSA-vfj7-8cjw-p6xm affects braces 3.0.3 through vinext build tooling. Registry/advisory offers no published safe patch; npm suggests a breaking downgrade. D/E/F/H apply; request-runtime exposure was not demonstrated, not asserted absent. Local Next NFT trace contains no affected chain, which does not prove Cloudflare deployment reachability. No dependency update, suppression, gate weakening or forced Preview. See security-triage.json and dependency-audit.json. Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

## Independent remediation

Serialized customer-delete preflight, lease mutations and loaner availability; isolated week/month and calendar responses; preserved week/month URL periods; remounted vehicle-scoped histories on query changes; stabilized pagination and lease order. Lease save reloads canonical first-page offsets and distinguishes successful persistence from failed history refresh, with read-only retry. Calendar failures no longer imply missing business days; capped loaner reads explicitly disclose 300-row scope. Business rules, schema and OCR algorithms remain unchanged.

## Validation

53 regression/build stages and optimized Next build PASS. Eleven new actual-function checks cover concurrency, calendar boundaries and lease ordering/offsets. Fixture browser results and screenshots include 44 checks, 28 additional route/404 smoke checks and 390/768/1440 widths. Fixture requests never touched a shared database. These do not replace authenticated real-device or physical-print acceptance. Exact committed-head CI is captured after normal push in PR #93 / external final evidence; existing audit gate remains a blocker.

## Holds

Delivery-input DB-required UX and legal_3m remain DB_REQUIRED_HOLD. Search-scope ambiguity remains SPEC_DECISION_REQUIRED. Authentication/device/physical print acceptance remains USER_DEVICE_REQUIRED. Existing A3 print preview width and generic externally concurrent offset-pagination snapshot completeness were not redesigned. Main, Production, DB, credentials and other worktrees untouched; no force push.
