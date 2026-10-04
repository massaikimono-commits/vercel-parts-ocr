# ICB Codex-era complete handoff ledger

**Snapshot:** 2026-10-05 (Asia/Tokyo)
**Repository:** `massaikimono-commits/vercel-parts-ocr`
**Purpose:** recover the app's state and workstreams without relying on chat memory. This folder is evidence/documentation only; it contains no application changes.

## Executive state

- The original checkout is clean `main` at `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`. The latest remote main was read as the same SHA. No main, Production, or DB mutation was made while preparing this ledger.
- The current ICB application continuation is Draft PR [#93](https://github.com/massaikimono-commits/vercel-parts-ocr/pull/93), head `74ac541a061890f73553a2e8887cb1f72a8eb9ad`, based on the separate Draft PR [#92](https://github.com/massaikimono-commits/vercel-parts-ocr/pull/92), head `8b38adba491020cc58a5f8b0af1e8349c145d396`. Neither is merged or formally adopted.
- Separate principal candidates remain: Delivery Time UX PR #86 at `5870d86846a961ae2f9dccae993740b728df59d9`, and Certificate PDF integration PR #87 at `5ca65e71312b1b352d1b042e8bc95715acb9c8e1`. These have different bases, business/DB consequences, and test histories. Do not combine them implicitly.
- Most recent app-core source work is already implemented on #93. The latest handoff run made no app-source changes; it revalidated existing implementation, audited dependency/security status, and pushed evidence only.
- Candidate app build and local tests pass, and the current Cloudflare Workers candidate Preview is ready. GitHub Full Regression is still blocked before app tests by the `braces` advisory through Vinext/Vite. Vercel's guarded one-shot Preview is skipped when that gate fails.
- The `.gitignore`/Vercel-source-artifact issue was isolated and fixed on separate branch `fix/vercel-security-regression-gitignore-20261002` (`13c32f5`). Its Vercel status is successful, but there is no PR or merge evidence; it is not the current #93 head.
- **Codex-ready app implementation items found in this reconciliation: 0.** Existing candidate fixes must not be repeated. Open adoption, dependency, DB, and device gates are not evidence that an app rewrite is needed.

## Scope and migration boundary

Git cannot prove when the user switched models or which UI authored a commit. The earliest direct local Mac-repository evidence is the initial clone/reflog entry at **2026-10-02 01:17:45 +09:00**, on `main` at `f00bd12`. The delivery worktree was then recorded at 02:09, the Vercel source-artifact fix worktree at 02:38, and the Certificate PDF current-candidate worktree at 22:49. This is the **operational Codex-era boundary used here**, not a claim about the first Codex conversation.

Several relevant candidate commits predate that local clone: Delivery UX began in late September, Certificate PDF work reached `d3b9256` on October 1, and the adopted Native v3 baseline dates to September 19. They are included as inherited predecessor evidence because they are explicit checkpoints in the handoff request and later worktrees/PRs continued them. Their creation specifically in Mac Terminal Codex is **UNKNOWN**.

## Source-of-truth rules used

1. Remote `main`, named remote branch heads, GitHub PR states/checks, and Git commit ancestry.
2. Tracked source, regression scripts, workflow definitions, docs and committed evidence.
3. Read-only worktree/reflog records to establish local operational provenance.
4. Chat-supplied facts only where repo evidence can be cross-checked. If not cross-checkable, mark `UNKNOWN`.

There is no standalone full `ICB-SPEC v1.3` or `v1.4` document in the audited repo paths. The operational comparison therefore uses the app ledger, shared state ledger, pending-fix ledger, migration sources, accepted current instructions and regression contracts. This limitation is recorded rather than filling gaps with invented rules.

## Workstreams at handoff

| Workstream | Current state | Adoption / gate |
|---|---|---|
| Main application | Current adopted baseline is main `f00bd12`; app-core UX continuation is in #92/#93. | #92/#93 remain open Draft PRs. #93 is stacked on #92. |
| Schedule/customer/vehicle UX | Search, navigation, edit/cancel recovery, duplicate submission, stale response, loaner/workload/settings error recovery and responsive work are already in #92/#93. | Candidate source and fixture evidence pass; live authenticated and device acceptance remain open. |
| Delivery time UX | Separate 3-column preset/custom-range UX and persisted label candidate; #86 has 52/52 reported regression stages and passing GitHub full regression/Preview at exact head. | Not merged. Candidate SQL/RPC persistence is DB-gated; separate iPhone visual acceptance remains. |
| Vehicle Certificate PDF Native | Native v3 primary boundary was adopted by merged PR #77. The later async/run-isolation and generalized structural recovery is in #87, currently `5ca65e7`. | #87 is open Draft, 6 commits behind and 12 ahead of main; its aggregate Full Regression and Preview passed, while its OCR workflow's vehicle-certificate job separately failed on a later dependency audit. Real-device acceptance remains. |
| Vercel security-test artifact | #13c makes the security regression tolerate Vercel's omitted `.gitignore` by reading a tracked policy file only when `VERCEL=1`, with a regression script. | Vercel check passed on this branch; no PR/merge/adoption evidence. |
| Parts OCR / frozen recognition | Existing yellow/general-slip and vehicle OCR source/tests remain in main. The overnight #92/#93 runs did not tune these algorithms or mix in OCR candidates. | Algorithm accuracy/adoption belongs to its frozen/specialist evaluation; current device/practical acceptance is not established by fixture tests. |
| Multiple-PDF import | Existing bulk-import route/source is present and route-smoke tested in #92/#93 evidence. | No new implementation in the latest runs; authenticated real-data acceptance is unknown. |
| `legal_3m` | Candidate migration/validation history exists on `candidate/legal-3m-parent-spec-resume-20260917` (`c78d3a1`). | DB apply remains blocked; not live/adopted based on available evidence. |
| Print | Existing A4/A3/blank-parts-slip/no-total contracts are covered by source regressions in candidate build. | Physical print/stock acceptance remains device/human work. |
| Security | Main PR #90 patched its advisories; a separate `braces` high advisory now blocks current #93 Full Regression. | No ignore, severity weakening, or gate bypass. Candidate remains `SECURITY_GATE_HOLD`. |

## Business rules and functional inventory

The currently accepted business rules used in candidate review include: customer/vehicle lookup by last four, phone or customer name; schedule-specific search by last four only; first visit may use name plus last four; reception 08:30–11:00 and 13:00–17:00 with lunch 12:00–13:00 blocked and business hours 08:30–17:30; combined morning capacity 15 and afternoon 10; morning pickup cap 10; morning vehicle-inspection intake cap 4; cancellation at one work-order scope; work states `未 → 中 → 完`; waiting-service for any `customer_visit` reason with no planned delivery rows. Printing retains blank parts slip, inspection record A4, designated inspection record A3 portrait and daily report A3 with no total amount. Delivery time requirement includes 15:00/16:00/17:00-afternoon presets and arbitrary time; the persistence mutation remains DB-gated. There is no current “13時まで” preset.

- **Customer / vehicle:** source supports the operational registry/search/history flow; #92/#93 specifically improve false-empty/error separation, retry, same-route query ownership, save duplication and stale-selection protections. This run does not claim authenticated live record acceptance.
- **Schedule / work order:** #92/#93 cover lookup/detail/back, date navigation, edit/cancel, work status serialization, active registration guards and error recovery. Multi-RPC transactionality remains absent.
- **Desktop / mobile:** #92/#93 preserve compact desktop and 390/768/1440 fixture layouts; actual touch/Safari acceptance remains pending.
- **Vehicle certificate:** the adopted v3 boundary prefers native text-layer PDF reading when available and the repo OCR ledger records QR-first photo behavior and legacy override guards. Later async/generic PDF safety is #87 only.
- **Parts OCR:** mainline route `/ocr/auto` separates dedicated yellow slips (`/ocr`) from general/white table slips (`/ocr/general`); formal output contracts and pass-budget/layout tests are in `docs/ocr-test-ledger.md`. This #92/#93 work did not modify recognition algorithms or specialist evaluation branches.
- **Multi-PDF import:** `/customer-vehicles/bulk-import` is an existing review-before-import route; #71 remains a separate open Draft validation candidate. #92/#93 route smoke does not constitute bulk live-import acceptance.
- **Legal 3-month inspection:** `legal_3m` has migration/validation preparation only; the pending ledger records its DB constraint/apply and compatible release steps.
- **Delivery labels:** 15:00/16:00/17:00-afternoon presets and arbitrary time are required; “13時まで” is removed. Persistence is DB-gated.
- **Printing:** existing blank parts slip, inspection record A4, designated inspection record A3 portrait, daily report A3 and no-total constraints remain source regressions. Physical paper/printer acceptance is open.

## Completion states are not interchangeable

- A passing unit/source regression only validates the tested source contract.
- A passing full regression validates that workflow's pinned commit and its checks; it does not adopt/merge the candidate.
- A ready Vercel/Workers Preview proves a preview build/deployment, not production status, authenticated workflow correctness, device acceptance, or formal adoption.
- A fixture browser run uses synthetic data and intercepted backend traffic; it does not prove the live Supabase schema or user records.
- A candidate DB migration/RPC file does not mean it was applied to shared Supabase.

## Detailed companion records

- `TIMELINE.md` — dated task/checkpoint sequence and failures/recoveries.
- `BRANCH_MAP.md` — branch heads, ancestry, PR state and worktree relationship.
- `CURRENT_STATE.md` — current main/candidates/previews/DB and readiness classification.
- `OPEN_ITEMS.md` — CODEX/ChatGPT/Human/Device/DB/Production/dependency/adoption/Historical buckets.
- `EVIDENCE_INDEX.md` — paths, PRs, runs, preview records, verification gaps.
- `MANAGEMENT_HANDOFF.md` — copy-ready handoff for ICB app management.

## Snapshot safety

This reconciliation used read-only inspection of the original checkout and existing worktrees. Its new documents are written on the isolated `candidate/icb-continuation-20261003` worktree. No reset, clean, destructive checkout, force push, main change, Production change, DB apply, credential edit, Frozen OCR edit, or existing-worktree mutation was performed.
