# ICB Management Control Plane

Canonical management branch: `management/icb-control-plane-20260910`

This file is the required source of truth for any GO/HOLD, adoption, DB change, deployment decision, specialist handoff, or current-state assertion. Conversation memory and handoff summaries are secondary aids, never the sole source of truth.

## Mandatory preflight before every major decision

1. Read the latest parent specification and this control-plane file.
2. Verify the target lane branch and current HEAD in GitHub immediately before responding.
3. Verify the latest confirmed specialist report against GitHub/DB/Vercel/Netlify when tools permit.
4. Identify what is implemented, implementable-unimplemented, blocked, intentionally HOLD, or review-only.
5. Re-check the original reason behind any HOLD or safety rule before changing it.
6. Treat user statements and specialist reports as evidence, not automatic ground truth; verify independently when possible.
7. A GO/HOLD in one lane never propagates to another lane.
8. Response speed is lower priority than state consistency.
9. If the verified branch HEAD has advanced since this ledger, inspect the delta before issuing new instructions; never overwrite or duplicate specialist work.
10. When a lane reaches a real-device blocker, first confirm that no non-Preview/static/fixture/synthetic/code-audit work remains before asking the user to test.
11. A generated/published static branch is not proof that an iPhone-accessible hosted URL works; actual Safari delivery/execution result controls the next GO.
12. Never collapse technical implementation PASS into product/UX adoption PASS. Preview-only convenience/UI candidates require user hands-on acceptance unless already fixed by the parent spec.
13. Do not label an unsolicited convenience feature formally adopted merely because it reduces taps in theory.
14. Speculative UX candidates must not be merged to main, propagated to Production, or written into the parent spec as adopted before user acceptance.
15. Before stating `no implementable confirmed requirement remains`, perform a full section-by-section parent-spec audit against the current app HEAD. Classify every confirmed requirement as implemented / implementable-unimplemented / intentionally HOLD / review-only.
16. Confirmed implementable requirements take priority over speculative UX work.
17. If no immediately implementable confirmed requirement remains, speculative UX candidates may be batched without a quota. Each needs a clear pain point, behavior, benefit, conflict/duplication check, and independent removability/revisability.
18. Repeated correction of the same management error class is a handoff-risk signal. Prepare a fresh-chat handoff before continuing major decisions if source-of-truth contradictions recur.
19. Before discussing any incident count, deployment safety, production state, or `実害`, read the Permanent Incident Register below. Never reconstruct the incident list from conversation memory alone.
20. Before creating a handoff, copy the current lane ledger, Permanent Incident Register, HOLD matrix, absolute prohibitions, and display/copy rules from this file. Do not omit them to shorten the handoff.
21. A prior management statement of `no unimplemented confirmed requirement` is invalidated immediately if a specialist later finds a confirmed-spec gap. Reset app-main audit status to `FULL RE-AUDIT REQUIRED` and do not return to speculative UX work until the section-by-section audit has been completed against the new current HEAD.
22. `未反映なし` is never a universal claim. The only permitted form is scope-bound: `current safe conditions = no shared DB mutation, no OCR tuning, no review-only item, no Production change; immediately implementable confirmed-spec / explicit-request gap count = 0`, and only after a complete section audit.

## Permanent Incident Register — MUST NOT BE OMITTED FROM HANDOFFS

These incidents are permanent project history. They are not interchangeable and must be counted separately.

### Incident 1 — Shared Supabase data-loss incident
- A prior assistant operation used `supabase db reset` against the shared remote project and caused shared data loss.
- Classification: actual data-loss incident.
- Permanent guard: never run `supabase db reset` against shared remote. Shared DB mutations require explicit management GO and compatibility review.

### Incident 2 — Netlify unnecessary Production Deploy / credit-consumption incident
- GitHub integration caused unnecessary Netlify Production Deploys.
- Confirmed impact: 21 Production Deploys and 315 Netlify credits consumed.
- Classification: actual production-deployment / quota-cost impact.
- This incident is separate from Vercel and must never be omitted when summarizing deployment incidents.
- Netlify Production remains HOLD unless explicitly released by management.

### Incident 3 — Vercel deployment flood / Preview-blocking incident
- Some OCR/development branches reintroduced `vercel.json` with `git.deploymentEnabled=true`, causing unnecessary deployments.
- `vercel-parts-ocr` alone exceeded 100 deployments in a 24-hour period.
- Direct impact: safe Preview creation became blocked/restricted; Parts OCR A22 real-photo Formal, vehicle-certificate OCR real-photo evaluation, and iPhone real-device evaluation were blocked.
- Classification: actual development/evaluation-blocking incident.
- Permanent guard: active development branches preserve `git.deploymentEnabled=false`; ordinary pushes must not deploy; Preview requires management GO and meaningful batching.

## Production and shared-resource rules

- Netlify is the intended real operational production environment.
- `main`, Netlify Production, Vercel Production, and shared Supabase are not changed without a validated reason and applicable approval.
- Vercel Preview alone must not drive a shared Supabase schema change when Netlify Production is on an older app state.
- For DB-dependent features, implement DB-independent portions first and HOLD shared DB mutation until compatibility is ready.
- Never use `supabase db reset` against the shared remote project.

## Deployment safety

- Ordinary Git pushes must not create Vercel deployments.
- Every active development branch must preserve `git.deploymentEnabled=false` in `vercel.json`.
- Preview deployments are batched by meaningful real-device test unit, never per small commit.
- Main/Production deploys are always explicit.
- Deployment safety must be verified from actual deployment records when access permits, not only CI claims.
- Never conflate Netlify deployment/credit incidents with Vercel deployment-limit incidents.

## Current lane ledger — verified/updated 2026-09-11 JST

### App main
- Branch: `preview/schedule-ux-20260903`.
- Current formal branch HEAD: `f1742dcc65ea4170e5c8ca6d60acb00a9fbdadb3`.
- Previous formal HEAD: `18c0310dc85cb49bc3caca0c63b290f6e6126c41`.
- PR #62: Draft / Open / unmerged; base `main`.
- main SHA: `20a715bf46156282b686a617d6744a040bc17fb3` unchanged.
- Full ICB-SPEC v1.3 section-by-section audit status: COMPLETE for the app-core scope under current safe conditions.
- Scope-bound result: with shared DB mutation, OCR tuning, review-only items, final physical print alignment, and Production reflection excluded, the count of immediately implementable confirmed-spec + explicit-request gaps is 0.
- This does NOT classify DB-dependent HOLD, review-only items, OCR quality work, or final print coordinates as implemented.
- Confirmed-spec correction baseline remains `77248cb970bd040f57b21400273b920aab641248`; its final full-section audit was formally PASS before speculative UX resumed.
- Prior technical-PASS Preview candidates remain retained, including schedule-detail lease-maintenance direct shortcut and same-tab customer/vehicle search-state memory. User iPhone acceptance remains pending for all speculative UX candidates.
- Latest UX-candidate batch: integrated vehicle history source filter in `app/customer-vehicles/history/page.tsx`.
- Fixed filter set: `すべて / 車両操作 / 作業 / 入出庫 / 予定変更 / 記録簿 / 点検履歴`.
- Filtering is client-side only over already-loaded unified `items` via `item.source`; no new Supabase query, RPC, schema, migration, RLS, source paging, or source sort behavior was added.
- Existing bounded paging remains `SOURCE_PAGE_SIZE = 25` and `DISPLAY_PAGE_SIZE = 25`; changing filter resets visible count to the display page size.
- UI uses identifiable horizontal source-filter controls with active state and explicitly states `読み込み済み履歴を種類ごとに絞り込みます。DBの再検索は行いません。`.
- Dedicated regression `scripts/vehicle-history-source-filter-regression.mjs` locks source list, loaded-items-only filtering, visible-count reset, identifiable UI, and absence of source-filter Supabase query coupling.
- `18c0310d... -> f1742dcc...`: ahead 6 / behind 0; final net diff only `app/customer-vehicles/history/page.tsx` and `scripts/vehicle-history-source-filter-regression.mjs`.
- Regression / Full Build workflow run `34545793215`: SUCCESS. The workflow push SHA is an intermediate CI commit; PR metadata points to final head `f1742dcc65ea4170e5c8ca6d60acb00a9fbdadb3`.
- Deployment Safety run `34545907928`: SUCCESS on final HEAD `f1742dcc65ea4170e5c8ca6d60acb00a9fbdadb3`.
- `vercel.json` at final HEAD preserves `git.deploymentEnabled=false`.
- Formal classification of this latest history-filter batch: technical PASS only; UX formal adoption remains HOLD until Vercel Preview + iPhone hands-on acceptance.
- Vercel Preview remains HOLD until explicit management GO after deployment-limit/safety clearance; no Preview was created by this batch.
- Existing HOLD/review exclusions remain active: `legal_3m`; shared-DB/RLS-dependent role separation; parent-spec review items; OCR-quality work; final physical print coordinates; Production reflection.

### Vehicle certificate QR/OCR
- Frozen body branch: `work/certificate-photo-ocr`, HEAD `7b421eea35154baa5b19e61e56151a8d73363bbf`; unchanged/HOLD.
- Formal A21.8 source branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`, completed HEAD `b7230adf4acf3288c5fc3811d32309247361dcf1`.
- Formal Photo QR Decode remains `28/47`; `31/47` remains candidate only; adopted HEAD none.
- Static workaround build branch: `eval/certificate-qr-stage-a21-8-static-standalone`, HEAD `52fd060d774015ca127abbd04467b5f674106170`.
- Static publish branch: `eval/certificate-qr-stage-a21-8-static-publish`, HEAD `6f9249cf5719e3ce35461296f3beb6d8f9062539`.
- iPhone Safari static delivery failed; classify as hosting/Content-Type/execution failure, not QR-recognition failure.
- Fixed8 authorization remains unconsumed: IMG_0940-0947 selected 0 times; QR processing started 0 times.
- Next meaningful action when a safe execution path exists: exactly one completed A21.8 fixed8 real-photo run. Do not burn the one-run authorization on infrastructure probing.

### Parts OCR
- Frozen body branch: `work/parts-ocr-regression`, HEAD `6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`; unchanged/HOLD.
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`, formal non-Preview PASS HEAD `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`; formal non-Preview PASS eval HEAD `fa8df79c3eff7cc9c100d48b357d09c930168cdf`; current infrastructure HEAD `cac7de9e5f208f859a2ee374dc29ea959c6dbeac`.
- Formal adopted OCR HEAD: none.
- Stage A22 implementation/static/invariant/standalone/CI: PASS. Latest build workflow run `34471916545`: SUCCESS.
- Real-photo Formal: NOT YET EVALUATED.
- A21 baseline for IMG_0684 comparison: truncation `32/32`; table-line contamination `26/32`; `CELL_CROP_QUALITY` primary.
- Remaining formal step: one formal yellow12 iPhone run with UI auto-mapping IMG_0684; compare truncation, table-line contamination, low occupancy, edge-touch, TESS/JA_LIGHT/V5 accuracy, normalization attribution, and correct-row regression.
- GitHub Pages route is explicitly not used. Third-party static proxy is rejected for PII safety.
- Management decision: hold A22 real-photo Formal until a safe execution path / Vercel Preview GO exists. Do not change A22 logic merely to solve hosting, and do not move to A23 without evidence.

## Global HOLD matrix

- main: HOLD.
- Netlify Production: HOLD.
- Vercel Production: HOLD.
- Vercel Preview: HOLD until explicit management GO after safety/limit clearance.
- shared Supabase: HOLD unless explicit DB GO.
- `legal_3m`: HOLD.
- Shared-DB/RLS-dependent role separation: HOLD pending compatibility/authorization review.
- Parent-spec review-only items: HOLD until user review.
- Final physical print coordinates / printer offsets: HOLD pending real-paper confirmation.
- Vehicle certificate OCR Frozen: HOLD.
- Parts OCR Frozen: HOLD.
- Parts OCR Stage B: HOLD.
- Production reflection / PR merge: no implicit GO.

## Absolute prohibitions

- No `supabase db reset` against shared remote.
- No implicit shared DB mutation.
- No implicit main merge.
- No implicit Netlify Production deploy.
- No implicit Vercel Production deploy.
- No small-change Preview spam.
- No GT use in OCR runtime/control/candidate/stop/fallback/expected-count logic; GT is scoring-only.
- No declaring OCR accuracy improvement from CI/static PASS without formal real-photo evidence.
- No declaring review-only/DB-HOLD/OCR-quality/final-coordinate items implemented merely because app-core has no immediately implementable safe-scope gaps.

## Handoff requirement

Every specialist/management handoff must include:
- target branch and current HEAD
- current GO/HOLD
- last formal instruction
- implemented items
- implementable-unimplemented items
- blockers and original reason for each blocker
- exact next verification/action
- whether Vercel/Supabase/Netlify/main changed
- technical PASS/HOLD separately from user Preview acceptance for UX candidates
- full parent-spec audit status before declaring app-main free for speculative UX work
- if the audit result is 0, include the exact scope/exclusions rather than saying universal `未反映なし`
- the complete Permanent Incident Register (Supabase / Netlify / Vercel) or an explicit statement that this canonical file was read and all three remain active history
- the Global HOLD matrix and Absolute prohibitions

## Paste-ready output / display rule

For ICB project text intended to be copied into another specialist or management chat:
- Use a normal fenced code block.
- Do not use Writing Blocks / Plain text cards.
- Avoid large rendered headings that inflate text on iPhone.
- Preserve this rule in every fresh-chat handoff.

## Repeat-failure handling

If a mistake reveals a repeatable failure class:
1. Correct the immediate decision.
2. Verify real state from source-of-truth systems.
3. Update this control-plane so the same class has an explicit preflight guard.
4. Carry stable rules into future parent-spec revisions when appropriate.
5. Do not consume user time discussing prevention when management can implement prevention itself.
6. Shared instructions for multiple lanes should be issued once in one paste-ready code block.
7. If a user-side action is the only remaining step, instruct the user directly instead of redundant specialist round trips.
8. Preserve technically passed but unaccepted UX changes as Preview candidates.
9. If management incorrectly declares no remaining confirmed requirements, first perform the complete parent-spec-vs-current-HEAD audit.
10. If the same management mistake class recurs, proactively prepare a handoff.
11. If an incident/history question is asked, consult the Permanent Incident Register before answering; do not answer from recollection alone.
12. If the canonical ledger is stale relative to a verified branch HEAD, update the ledger after verification rather than letting stale state persist into the next chat.
