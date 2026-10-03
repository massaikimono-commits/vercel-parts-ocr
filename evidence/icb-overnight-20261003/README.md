# ICB app overnight engineering evidence — 2026-10-03

Source outcome: independent app-core candidate prepared from current remote main. This is an incremental UX batch, not an app rebuild or a completed parent-spec implementation.

## START and isolation

- Repository: `massaikimono-commits/vercel-parts-ocr`.
- Remote and local starting HEAD: `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`.
- Original `~/Developer/vercel-parts-ocr`: clean main at first read-only audit. It was never edited by this run.
- Workspace: `/private/tmp/icb-overnight-20261003`, fresh `git clone --no-hardlinks` of local objects followed by remote fetch. This has its own `.git`; no existing worktree was modified.
- Branch: `candidate/icb-app-overnight-20261003`.
- Remote main remained at the starting SHA at the final pre-commit fetch.
- START branch inventory, open PRs, CI, existing worktrees and source routes are saved beside this file. Snapshot dates reflect API audit time; these are not claims about deployed UI.
- The final commit SHA is recorded in the final execution report / Draft PR. A commit cannot contain its own hash.

## Implemented batches

1. React owns security acknowledgement and notice visibility. The old event fingerprint/storage key is retained; new events reappear, cross-tab storage changes update the source state, storage failures leave alerts visible. ResponsiveUxController no longer issues duplicate security RPCs or injects buttons/hides notices through a MutationObserver.
2. Schedule search uses a labelled form with submit semantics, a synchronous request guard, busy controls, old-result clearing, announced status, distinct initial/empty/failure states, and retry. Query/range survive detail→back via sessionStorage; logout clears that state. Existing query semantics and work-order grouping/cancellation are retained.
3. Schedule detail responds to `entry` query changes. It commits a complete read snapshot atomically, clears old actionable state, ignores obsolete requests, and exposes retry after failure.
4. One-day schedule reacts to query dates and synchronizes previous/today/next/date-picker controls with the URL. Mobile/desktop Today active state derives from query state. Old date responses cannot overwrite the newer board. Invalid calendar dates fall back safely.
5. Mobile top weekly cards show today first while retaining all seven dates and original desktop weekday order. Mobile empty-card minimum height is smaller. Existing weekly registration and detailed-day navigation stay available.
6. Home security notice no longer overflows due to width+margin. Search results use two columns at tablet widths instead of overflowing a five-column desktop layout. Login history becomes a labelled narrow-screen list while retaining table headers/desktop presentation.
7. Vehicle-search wording lives in React source. Desktop position rules use semantic classes instead of numbered-button pseudo-label replacement. Existing visual ordering remains.
8. Shared loading and not-found boundaries expose announced progress and a home recovery link.
9. The DB-independent read/display subset of delivery candidate PR #86 was reused: stored `print_time_label_override` is selected/preferred in schedule search and business-state delivery labels. Legacy blank/null overrides keep their old exact/broad formatter. No candidate mutation RPC or SQL was copied.
10. New unit/source regression is part of `npm run build`; reusable localhost-only browser fixture regression and screenshots are included.

## Specification / candidate audit

| Area | Current evidence / decision |
|---|---|
| Parent spec | No standalone full ICB-SPEC v1.4/v1.3 document was found in current main. Current source, ledgers, migration sources and regression contracts were used. Formal OCR architecture gates were not inferred or redesigned. |
| Customer search / first registration | Name/phone/last4 modes and independent name+last4 registration are already on main. Current main incorporates name-only feature (`0ec8e85`); no old candidate cherry-pick needed. |
| Schedule search | Request example says last4-only; current source/tests explicitly retain name/phone/full registration with 1–4 numeric digits exclusively matching last4. Business semantics change is HOLD pending formal spec resolution; no expansion was added. |
| Waiting service | Repo v1.3 ledger explicitly permits all customer_visit reasons. Special same-time duplicate warning is inspection-only in the correction regression. These current repo contracts override the older inspection-only eligibility example. Neither rule was changed. |
| Business hours / capacities / work state / reason colors | Existing source/RPC and regression contracts preserved. Shared DB state was not queried or changed. Full build covers pickup capacity, waiting, cancellation and work-state regressions. |
| Delivery candidate | PR #86 at `5870d86846a961ae2f9dccae993740b728df59d9`, main ancestor, 29 ahead commits. Its latest description requires exact-head Full Regression/Preview/iPhone acceptance and main/DB HOLD. Candidate new/edit relies on new time-label RPCs and includes legal_3m migrations. Only read-only display lines were adopted. |
| Desktop Compact | Candidate `d00c1dd` files `desktop-compact.css` and `desktop-quick-nav.tsx` already match current main before this run. No stale integration needed. |
| PDF Native v3 / bulk | Current source retained. PR #87 `5ca65e7` has Full regression/certificate-generalization success but an existing vehicle-certificate CI failure. Its specialist worktree is untouched. No PDF lifecycle/recognition algorithm integration attempted. |
| legal_3m | Remains DB_REQUIRED_HOLD. No schema/RPC/migration change. |
| Print | Existing A4/A3 geometry, parts blank form, daily report A3 and total-amount exclusion remain unchanged. Print routes were smoke-loaded only; no physical printing. |

## Validation

- Full `npm run build`: PASS, all 50 script stages plus optimized Next.js build. Node 24 local; Node 22 will be verified in CI.
- New functional unit assertions: fingerprint changes for event code/time/message; delivery override and legacy exact fallback; seven-day mobile ordering with immutable input and desktop order preservation.
- Existing operational readiness, mobile quick-nav, schedule detail/one-day/work-order/actions, desktop compact, deployment safety and CI-routing tests: PASS.
- Chromium fixture E2E: detailed results in `browser-results.json`; all Supabase requests intercepted using synthetic data. No real credentials or shared writes.
- Tested interactions: acknowledgement/reload/new event, full-width-digit last4, duplicate Enter, grouped work order, stored delivery label, detail/back state, detail failure/retry, same-route entry ID change, search failure/retry/empty, login-history failure, same-route Today/day-picker state.
- Responsive: 390 / 768 / 1440 px for home/search/detail/login history; no document overflow. PNGs visually reviewed. 390px verifies today is the first weekly card.
- 28 additional discovered core/print/PDF-entry routes + 404: loaded without browser page errors. This is route-shell smoke coverage, not real PDF parsing, DB mutation, or physical print acceptance.
- Static route signal audit is saved in `route-source-audit.json`. Presence/absence of tokens is an audit lead, not a behavioral claim. Shared boundaries/styles also apply.
- CI / Preview: dispatched after this evidence commit; results belong in final execution evidence and Draft PR. Existing safety locks reject main/Production and deduplicate Preview per exact SHA. No configuration/credential changes.

## Remaining / HOLD

- DB_REQUIRED_HOLD: delivery presets/custom-range input requiring new atomic label RPCs; legal_3m. `13時まで` removal is not activated on current main because the approved full input/persistence candidate cannot be integrated safely without that DB contract. Historical data is untouched.
- SPEC_REQUIRED_HOLD: resolve schedule-search scope and obtain the formal full parent-spec document for a complete acceptance matrix. Waiting-service implementation follows explicit current repo v1.3 evidence.
- USER_DEVICE_REQUIRED: actual iPhone/Safari native time controls, camera/PDF/QR real documents, physical A4/A3 alignment, deployed authenticated DB mutation acceptance. Automated synthetic tests do not replace these.
- Known inherited standalone regression: `vehicle-search-registration-separation-regression.mjs` fails on its blanket history-route prohibition, although current main has the correct `!isVehicleSearch` conditional. The relevant source was not changed. It is outside the current build pipeline; no false green claim.
- Known print-preview horizontal overflow: fixed A3 daily-report screen sheet at 1440px. Kept to avoid altering approved print geometry; other core smoke routes had no desktop document overflow.
- Remaining CSS/source separation exists in `customer-vehicles/layout.tsx` and PDF enhancement stack. It is recorded, not broadly rewritten; PDF/OCR ownership and real-device acceptance take priority.
- No parts OCR architecture/tuning/yellow-white logic/evaluation edits. No known shared-file conflict at final fetch. No source updates from another Codex were overwritten.

## Safety / next phase

main untouched; Production untouched by this run; DB/data/schema/RPC untouched; existing worktrees untouched; no force push; no reset/clean; no credential changes. Only normal candidate commit/push and non-Production Preview are authorized.

Next recommended phase: review this incremental app-core candidate; separately resolve parent-spec search scope and approve/apply delivery-label DB contract before adopting PR #86 UI; complete exact-head iPhone acceptance; keep PDF specialist PR #87 and parts OCR ownership separate. Main merge / Production release require the separate user GO.
