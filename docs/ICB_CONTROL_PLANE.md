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
- Current technical HEAD: `08ac0010c2c92498b5fc384a0dff9743c34fd89e`.
- Previous technical HEAD: `f1742dcc65ea4170e5c8ca6d60acb00a9fbdadb3`.
- PR #62: Draft / Open / unmerged; base `main`.
- main SHA: `20a715bf46156282b686a617d6744a040bc17fb3` unchanged.
- Full ICB-SPEC v1.3 section-by-section app-core audit: COMPLETE under current safe conditions.
- Scope-bound result: excluding shared DB mutation, OCR tuning, review-only items, final physical print alignment, and Production reflection, immediately implementable confirmed-spec + explicit-request gaps = 0.
- This does not classify DB-HOLD/review-only/OCR/final-coordinate items as implemented.
- Confirmed-spec correction baseline remains `77248cb970bd040f57b21400273b920aab641248`.

#### Latest UX Preview candidate: history/photo continuation hub
- Classification: technical PASS only; UX adoption HOLD pending Vercel Preview + iPhone hands-on review.
- Delta `f1742dcc... -> 08ac0010...`: ahead 8 / behind 0.
- Final net diff only:
  - `app/customer-vehicles/history/page.tsx`
  - `app/customer-vehicles/photos/page.tsx`
  - `scripts/history-photo-continuation-regression.mjs`
- Both history and photo pages add `この車両で続ける` with:
  - `📅 次回予定登録` -> `/schedule/active`
  - `🧾 記録簿` -> `/inspection`
- Before navigation, existing vehicle snapshot is saved to `parts-active-vehicle` in both sessionStorage and localStorage.
- No `/ocr/auto` shortcut and no OCR coupling.
- No new DB query/RPC/schema/migration/RLS.
- Full validation workflow run `34549716920`: SUCCESS after correcting workflow dummy env to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; app logic did not need a fix for the earlier workflow-only failures.
- Deployment Safety run `34549836962`: SUCCESS on final HEAD `08ac0010c2c92498b5fc384a0dff9743c34fd89e`.
- `vercel.json` at final HEAD preserves `git.deploymentEnabled=false`.

#### Performance guard — parent spec Section 20
- Fixed policy: new functions must not make ordinary operation heavy at several-thousand-vehicle scale.
- Top/one-day schedule must not preload all customers/vehicles.
- OCR observers/listeners/storage patches must not remain resident on ordinary screens.
- Schedule registration/customer-vehicle/parts history keep bounded initial/search/page sizes.
- Vehicle photos fetch only the selected vehicle; current photo page remains `PHOTO_PAGE_SIZE = 24`, metadata-only paging, original signed URL created only on explicit open.
- Integrated history fetches only the selected vehicle and keeps bounded source paging at `SOURCE_PAGE_SIZE = 25` / display page 25.
- Latest history/photo continuation candidate adds no mount-time fetch, listener, OCR helper, observer, or unbounded list. It only writes a small vehicle snapshot and navigates when the user taps an action.
- Formal performance classification for latest candidate: no material regression detected by code audit; final perceived-performance confirmation remains part of iPhone Preview review.

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
- These remain Preview candidates, not formally UX-adopted until user iPhone acceptance.

- Vercel Preview: HOLD until explicit management GO after deployment-limit/safety clearance.
- Existing app HOLD/review exclusions: `legal_3m`; shared-DB/RLS role separation; parent-spec review-only items; OCR-quality work; final physical print coordinates; Production reflection.

### Vehicle certificate QR/OCR
- Frozen body: `work/certificate-photo-ocr` HEAD `7b421eea35154baa5b19e61e56151a8d73363bbf`; HOLD.
- Formal A21.8 source: `eval/certificate-qr-stage-a21-4-format-counterfactual` HEAD `b7230adf4acf3288c5fc3811d32309247361dcf1`.
- Formal Photo QR Decode remains 28/47; 31/47 candidate only; adopted HEAD none.
- Static workaround branches remain, but iPhone Safari delivery failed; classify as hosting/execution failure, not QR recognition failure.
- Fixed8 authorization remains unconsumed.
- Next meaningful action when safe execution path exists: exactly one A21.8 fixed8 real-photo run.

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
