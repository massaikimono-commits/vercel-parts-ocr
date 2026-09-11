# ICB Management Control Plane

Canonical management branch: `management/icb-control-plane-20260910`

This file is the required source of truth for GO/HOLD, adoption, DB change, deployment decisions, specialist handoffs, and current-state assertions. Conversation memory is secondary.

## Mandatory preflight

1. Read latest parent spec and this control plane.
2. Verify target branch/current HEAD in GitHub.
3. Verify specialist report against source systems when possible.
4. Classify implemented / implementable-unimplemented / HOLD / review-only.
5. Re-check original reason for any HOLD before changing it.
6. GO/HOLD never propagates across lanes automatically.
7. Technical PASS is separate from UX adoption PASS.
8. Before saying no confirmed gap remains, complete section-by-section parent-spec audit.
9. Confirmed implementable requirements outrank speculative UX.
10. If branch HEAD advanced, inspect delta before issuing instructions.
11. Before incident/deployment-history statements, read Permanent Incident Register.
12. If a later confirmed-spec gap disproves a prior `no gap` claim, reset app audit to `FULL RE-AUDIT REQUIRED`.
13. `未反映なし` is only allowed as a scope-bound statement after full audit.
14. Preserve technically passed but unaccepted UX changes as Preview candidates.
15. Small changes must not each create a Preview.

## Permanent Incident Register — MUST NOT BE OMITTED

### Incident 1 — Shared Supabase data-loss
- Prior assistant used `supabase db reset` against shared remote and caused shared data loss.
- Never run shared-remote `db reset`.
- Shared DB mutations require explicit management GO and compatibility review.

### Incident 2 — Netlify unnecessary Production Deploy / credits
- GitHub integration caused unnecessary Netlify Production Deploys.
- Confirmed impact: 21 Production Deploys / 315 credits consumed.
- Separate incident from Vercel.
- Netlify Production remains HOLD unless explicitly released.

### Incident 3 — Vercel deployment flood / Preview blocking
- Some dev/OCR branches reintroduced `vercel.json` with `git.deploymentEnabled=true`.
- `vercel-parts-ocr` exceeded 100 deployments in 24h.
- This blocked safe Preview creation and OCR real-photo/iPhone evaluations.
- Active dev branches must preserve `git.deploymentEnabled=false`.
- Preview requires management GO and meaningful batching.

## Production/shared-resource rules

- Netlify is intended operational Production.
- `main`, Netlify Production, Vercel Production, and shared Supabase are not changed without explicit applicable approval.
- Vercel Preview must not drive shared DB schema changes while Netlify Production is behind.
- Implement DB-independent parts first; HOLD shared DB mutation until compatibility is ready.

## Deployment safety

- Ordinary pushes must not create Vercel deployments.
- Active development branches preserve `git.deploymentEnabled=false`.
- Preview deployments are batched by meaningful real-device test unit.
- Main/Production deploys are explicit only.
- Never conflate Netlify credit/deploy incident with Vercel deployment-limit incident.

## Current lane ledger — verified/updated 2026-09-11 JST

### App main
- Repo: `massaikimono-commits/vercel-parts-ocr`.
- Branch: `preview/schedule-ux-20260903`.
- Current technical HEAD: `7c4c6dccca4477bd01fc916ac9e35912c39e0b8c`.
- Previous technical HEAD: `b711f46e2dfa8e9d2a75d81ff70a4ad0a14b16f7`.
- PR #62: Draft / Open / unmerged; base `main`.
- main SHA: `20a715bf46156282b686a617d6744a040bc17fb3` unchanged.
- Full ICB-SPEC v1.3 section-by-section app-core audit: COMPLETE under current safe conditions.
- Scope-bound result: excluding shared DB mutation, OCR tuning, review-only items, final physical print alignment, and Production reflection, immediately implementable confirmed-spec + explicit-request gaps = 0.
- This does not classify DB-HOLD/review-only/OCR/final-coordinate items as implemented.
- Confirmed-spec correction baseline remains `77248cb970bd040f57b21400273b920aab641248`.

#### Latest UX Preview candidate: lease maintenance continuation hub
- Classification: technical PASS and performance PASS; UX adoption HOLD pending Vercel Preview + iPhone hands-on review.
- Delta `b711f46e... -> 7c4c6dcc...`: ahead 4 / behind 0.
- Final net diff only:
  - `app/customer-vehicles/lease-maintenance/page.tsx`
  - `scripts/lease-maintenance-continue-actions-regression.mjs`
- Lease maintenance screen now adds `この車両で続ける` with:
  - `📅 次回予定登録` -> `/schedule/active`
  - `🧾 記録簿` -> `/inspection`
- Before navigation, the already-loaded vehicle snapshot is saved to existing `parts-active-vehicle` in both sessionStorage and localStorage.
- Continue actions are shown only when the target vehicle has loaded.
- No OCR execution shortcut was added.
- No new DB query, fetch, RPC, schema, migration, RLS, listener, MutationObserver, or OCR helper was added by the continuation helper; existing lease contract loading/paging remains unchanged.
- Dedicated regression locks the vehicle-scoped helper, both storage handoffs, both destination routes, vehicle-loaded gating, absence of OCR shortcut, and absence of new query/fetch/listener/observer coupling in the helper.
- Regression / Full Build workflow run `34570687623`: SUCCESS. Its push SHA is an intermediate CI commit; PR metadata points to final HEAD.
- Deployment Safety run `34570768822`: SUCCESS on final HEAD `7c4c6dccca4477bd01fc916ac9e35912c39e0b8c`.
- `vercel.json` at final HEAD preserves `git.deploymentEnabled=false`.

#### Prior UX Preview candidate: month mobile visible-row count consistency
- Classification: technical PASS and performance PASS; UX adoption HOLD pending Vercel Preview + iPhone hands-on review.
- Delta `b2a16f26... -> b711f46e...`: ahead 7 / behind 0.
- Existing monthly UI renders `rows.slice(0, 3)` and computes `ほか n件` from `rows.length - 3`.
- Mobile CSS now hides from the 4th row onward, so desktop/mobile both expose up to 3 rows and the remainder count is consistent.
- Final audit workflow run `34565308798`: SUCCESS.
- Deployment Safety run `34565372136`: SUCCESS on final HEAD `b711f46e2dfa8e9d2a75d81ff70a4ad0a14b16f7`.

#### Prior UX Preview candidate: week navigation anchor sync
- Classification: technical PASS and performance PASS; UX adoption HOLD pending Preview + iPhone review.
- `moveWeek(delta)` keeps `weekStart` and `jumpDay` synchronized; `goCurrentWeek()` synchronizes both to JST today/current week.
- Month navigation continues to use `/schedule/month?day=<jumpDay>`.
- Helper bodies remain local-state only; no added Supabase/fetch/loadWeek/location side effect.
- Regression / Full Build run `34557551129`: SUCCESS.
- Deployment Safety run `34557638480`: SUCCESS on final HEAD `b2a16f264c76f1766742ea3c2747f648d8ba40c7`.

#### Performance guard — parent spec Section 20
- Fixed policy: new functions must not make ordinary operation heavy at several-thousand-vehicle scale.
- Top/one-day schedule must not preload all customers/vehicles.
- OCR observers/listeners/storage patches must not remain resident on ordinary screens.
- Schedule registration/customer-vehicle/parts history keep bounded initial/search/page sizes.
- Vehicle photos fetch only the selected vehicle; current photo page remains `PHOTO_PAGE_SIZE = 24`, metadata-only paging, original signed URL created only on explicit open.
- Integrated history fetches only the selected vehicle and keeps bounded source paging at `SOURCE_PAGE_SIZE = 25` / display page 25.
- Lease-maintenance continuation adds only a small vehicle snapshot write on user action and does not alter existing DB loading/paging.
- Final perceived-performance confirmation remains part of iPhone Preview review.

#### Retained technical-PASS Preview candidates
- schedule detail -> next schedule registration.
- schedule detail -> customer/vehicle info.
- one-tap phone action when phone exists.
- schedule detail work-state direct update.
- schedule detail -> one-day schedule.
- schedule detail/history/photo selected-vehicle context preservation.
- customer/vehicle -> next schedule registration.
- schedule detail -> lease maintenance contract.
- customer/vehicle same-tab search-state memory.
- integrated history source filter.
- history/photo -> same vehicle next schedule / inspection.
- week navigation anchor sync.
- month mobile visible-row count consistency.
- lease maintenance -> same vehicle next schedule / inspection.
- These remain Preview candidates, not formally UX-adopted until user iPhone acceptance.

- Vercel Preview: HOLD until explicit management GO after deployment-limit/safety clearance.
- Existing app HOLD/review exclusions: `legal_3m`; shared-DB/RLS role separation; parent-spec review-only items; OCR-quality work; final physical print coordinates; Production reflection.

### Vehicle certificate QR/OCR
- Frozen body: `work/certificate-photo-ocr` HEAD `7b421eea35154baa5b19e61e56151a8d73363bbf`; HOLD.
- Formal A21.8 source: `eval/certificate-qr-stage-a21-4-format-counterfactual` HEAD `b7230adf4acf3288c5fc3811d32309247361dcf1`.
- Formal Photo QR Decode remains 28/47; 31/47 candidate only; adopted HEAD none.
- Static workaround branches remain, but iPhone Safari delivery failed; classify as hosting/execution failure, not QR recognition failure.
- Fixed8 authorization remains unconsumed.
- Next meaningful action when a safe execution path exists: exactly one A21.8 fixed8 real-photo run.

### Parts OCR
- Frozen body: `work/parts-ocr-regression` HEAD `6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`; HOLD.
- Source: `experiment/parts-ocr-stage-a22-cell-crop-correction` formal non-Preview PASS HEAD `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval: `eval/parts-ocr-stage-a22-cell-crop-correction`; formal PASS eval HEAD `fa8df79c3eff7cc9c100d48b357d09c930168cdf`; infrastructure HEAD `cac7de9e5f208f859a2ee374dc29ea959c6dbeac`.
- Stage A22 static/invariant/standalone/CI PASS; real-photo Formal NOT YET EVALUATED.
- Remaining step when safe Preview exists: one formal yellow12 iPhone run, auto-map IMG_0684.
- Do not advance to A23 without evidence and do not modify OCR logic merely to solve hosting.

## Global HOLD matrix

- main: HOLD.
- Netlify Production: HOLD.
- Vercel Production: HOLD.
- Vercel Preview: HOLD until explicit management GO after safety/limit clearance.
- shared Supabase: HOLD unless explicit DB GO.
- `legal_3m`: HOLD.
- Shared-DB/RLS role separation: HOLD pending review.
- Parent-spec review-only items: HOLD.
- Final physical print coordinates/printer offsets: HOLD pending real-paper confirmation.
- Vehicle certificate OCR Frozen: HOLD.
- Parts OCR Frozen: HOLD.
- Parts OCR Stage B: HOLD.
- PR merge/Production reflection: no implicit GO.

## Absolute prohibitions

- No `supabase db reset` against shared remote.
- No implicit shared DB mutation.
- No implicit main merge.
- No implicit Netlify Production deploy.
- No implicit Vercel Production deploy.
- No small-change Preview spam.
- No GT use in OCR runtime/control/candidate/stop/fallback/expected-count logic; GT scoring-only.
- No declaring OCR accuracy improvement from CI/static PASS without formal real-photo evidence.
- No declaring HOLD/review/OCR/final-coordinate items implemented merely because app-core safe-scope gaps are 0.

## Handoff requirement

Every handoff must include target branch/current HEAD, GO/HOLD, last instruction, implemented vs missing vs HOLD/review, blockers/reasons, exact next action, production/DB/OCR state, technical PASS vs UX acceptance, full audit status, complete incident history (Supabase/Netlify/Vercel), HOLD matrix, and absolute prohibitions.

## Paste-ready/display rule

For ICB text intended to be copied to another project chat:
- Use normal fenced Markdown code block.
- Do not use Writing Blocks / Plain text cards.
- Avoid large rendered headings on iPhone.
- Preserve this rule in every fresh-chat handoff.

## Repeat-failure handling

If a repeatable mistake appears: correct the decision, verify source systems, update this control plane, carry the guard forward, and prepare handoff if the same management error class recurs.
