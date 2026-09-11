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
12. `未反映なし` is only allowed as a scope-bound statement after full audit.
13. Preserve technically passed but unaccepted UX changes as Preview candidates.
14. Small changes must not each create a Preview.
15. A UX candidate that conflicts with an explicit confirmed parent-spec item is NOT a technical PASS even if CI/build pass.
16. While Deployment Governance incident 2026-09-11 is OPEN, infrastructure containment outranks new UX work.

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
- `vercel-parts-ocr` previously exceeded 100 deployments in 24h, blocking safe Preview/OCR real-device work.
- This is now formally governed by the OPEN 2026-09-11 Deployment Governance incident below.
- CANCELED records count as deployment records for management safety auditing.

## OPEN INCIDENT — Vercel Deployment Governance / 2026-09-11

- Status: OPEN.
- Severity: HIGH.
- Owner: current ICB app overall management.
- Formal incident document: `docs/ICB_DEPLOYMENT_GOVERNANCE_INCIDENT_20260911.md`.
- Historical configuration evidence:
  - `dff03bf4f2dc3abfb7c53c1b3767d845ebcb9469` introduced the `[deploy]`-marker `ignoreCommand` gate.
  - `44928ded4e1d0f8ce35bd94507b3da46fdadc0c2` added `git.deploymentEnabled=false` while retaining the old gate.
- Current active app / vehicle-OCR eval / parts-OCR source+eval branches audited 2026-09-11 all carry `git.deploymentEnabled=false` plus the legacy `ignoreCommand`.
- New Deployment Safety definition: PASS requires **no unintended new Vercel Deployment record**, not merely “no intentional Preview”. Audit READY, CANCELED, ERROR and equivalent ignored/skipped states.
- Target operating model: ordinary Git push -> 0 Vercel Deployment records; Preview -> management GO -> exact HEAD -> one explicit deployment.
- GitHub integration should remain connected unless zero automatic deployments proves impossible with the integration retained.
- `deploymentEnabled=false` is the intended central control; legacy `ignoreCommand` / `[deploy]` marker is pending controlled retirement after settings audit and measured validation.

### Live Vercel audit 2026-09-11
- Connected team is Hobby plan.
- Vercel project `vercel-parts-ocr` confirmed linked to repo `massaikimono-commits/vercel-parts-ocr`.
- First independent preceding-24h query returned 4 deployment records: 4 CANCELED, 0 READY, 0 ERROR; all tied to OCR experiment/eval pushes.
- A controlled management-branch documentation push (`63558a82f550a80024b0e607bc6d2184f208fe9f`) was then performed while `git.deploymentEnabled=false` was present.
- Vercel deployment query after that push returned 0 new deployment records. This is positive evidence for ordinary-push -> 0 on the management branch, but it is not sufficient by itself to close the incident across all active development lanes.
- Do not create the next Preview until the remaining closure checks are satisfied/approved.

### Required management audit from now on
At management start and before Preview GO, inspect where tooling permits:
- Vercel project state
- preceding-24h deployment list/count
- READY/CANCELED/ERROR/other counts
- source branches and commit SHAs
- Production-target changes
- current `vercel.json`
- Git Integration / project settings
- whether normal pushes created any deployment record

If unintended deployment appears, stop further pushes in the affected lane and investigate first.

### Incident closure criteria
Do not close until all applicable items are complete:
- mass-deployment cause/config history documented
- Vercel project settings independently audited to tooling limit
- ordinary Git push -> 0 deployment records measured on relevant active lanes
- legacy `ignoreCommand` / `[deploy]` mechanism retired, or an explicit documented reason to retain it is approved
- automatic deployment flood confirmed stopped
- preceding-24h state reviewed
- required Preview availability determined
- when authorized, exactly one required Preview created successfully
- Vercel Production unchanged
- Netlify Production unchanged
- main unchanged
- shared Supabase unchanged
- OCR Frozen unchanged
- next parent-spec revision includes `Deployment Governance / 共通インフラ運用`
- handoffs carry this governance.

## Production/shared-resource rules

- Netlify is intended operational Production.
- `main`, Netlify Production, Vercel Production, and shared Supabase are not changed without explicit applicable approval.
- Vercel Preview must not drive shared DB schema changes while Netlify Production is behind.
- Shared DB mutation requires explicit management GO.

## Current lane ledger — verified/updated 2026-09-11 JST

### App main
- Repo: `massaikimono-commits/vercel-parts-ocr`.
- Branch: `preview/schedule-ux-20260903`.
- Current branch HEAD: `63e15de0ae9137b6c473b42a085600605abf855c`.
- Current accepted technical baseline: `63e15de0ae9137b6c473b42a085600605abf855c`.
- PR #62: Draft / Open / unmerged; base `main`.
- main SHA: `20a715bf46156282b686a617d6744a040bc17fb3` unchanged.
- Full ICB-SPEC v1.3 section-by-section app-core audit: COMPLETE under current safe conditions.
- Scope-bound result: excluding shared DB mutation, OCR tuning, review-only items, final physical print alignment, and Production reflection, immediately implementable confirmed-spec + explicit-request gaps = 0.
- The rejected `明日 -> 翌日` candidate was not adopted. Parent-spec repair is complete: runtime is back to `← 前日 / 今日 / 明日 →`; delta from accepted `7c4c6dcc...` is only `scripts/daily-schedule-parent-spec-navigation-regression.mjs`.
- Parent-spec repair Regression / Full Build run `34576374629`: SUCCESS.
- Deployment Safety run `34576447577`: SUCCESS on final HEAD `63e15de0ae9137b6c473b42a085600605abf855c`.
- New UX development is paused behind the OPEN Deployment Governance incident.

### Retained technical-PASS UX Preview candidates
- schedule detail -> next schedule registration
- schedule detail -> customer/vehicle info
- one-tap phone action when phone exists
- schedule detail work-state direct update
- schedule detail -> one-day schedule
- schedule detail/history/photo selected-vehicle context preservation
- customer/vehicle -> next schedule registration
- schedule detail -> lease maintenance contract
- customer/vehicle same-tab search-state memory
- integrated history source filter
- history/photo -> same vehicle next schedule / inspection
- week navigation anchor sync
- month mobile visible-row count consistency
- lease maintenance -> same vehicle next schedule / inspection
- All remain technical PASS only; UX adoption HOLD pending one meaningful Vercel Preview + iPhone acceptance.

### Performance guard — ICB-SPEC v1.3 Section 20
- New functions must not make ordinary operation heavy at several-thousand-vehicle scale.
- Top/one-day schedule must not preload all customers/vehicles.
- No resident OCR observer/listener/storage patch on ordinary screens.
- Keep bounded search/page sizes.
- Vehicle photos: selected vehicle only, `PHOTO_PAGE_SIZE=24`, original signed URL only on explicit open.
- Integrated history: selected vehicle only, `SOURCE_PAGE_SIZE=25`, bounded display paging.
- Final perceived-performance confirmation remains part of iPhone Preview review.

### Vehicle certificate QR/OCR
- Frozen body: `work/certificate-photo-ocr` HEAD `7b421eea35154baa5b19e61e56151a8d73363bbf`; HOLD.
- Formal A21.8 source: `eval/certificate-qr-stage-a21-4-format-counterfactual` HEAD `b7230adf4acf3288c5fc3811d32309247361dcf1`.
- Formal Photo QR Decode remains 28/47; 31/47 candidate only; adopted HEAD none.
- Fixed8 authorization remains unconsumed.
- Next meaningful action after safe execution route: exactly one A21.8 fixed8 real-photo run.

### Parts OCR
- Frozen body: `work/parts-ocr-regression` HEAD `6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`; HOLD.
- Source: `experiment/parts-ocr-stage-a22-cell-crop-correction` formal non-Preview PASS HEAD `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval: `eval/parts-ocr-stage-a22-cell-crop-correction`; infrastructure HEAD `cac7de9e5f208f859a2ee374dc29ea959c6dbeac`.
- Stage A22 static/CI PASS; real-photo Formal NOT YET EVALUATED.
- Remaining step after safe Preview route: one formal yellow12 iPhone run, auto-map IMG_0684.
- Do not advance to A23 without evidence.

## Global HOLD matrix

- main: HOLD
- Netlify Production: HOLD
- Vercel Production: HOLD
- Vercel Preview: HOLD until Deployment Governance permits one explicit Preview
- shared Supabase: HOLD unless explicit DB GO
- `legal_3m`: HOLD
- Shared-DB/RLS role separation: HOLD pending review
- Parent-spec review-only items: HOLD
- Final physical print coordinates/printer offsets: HOLD
- Vehicle certificate OCR Frozen: HOLD
- Parts OCR Frozen: HOLD
- Parts OCR Stage B: HOLD
- PR merge/Production reflection: no implicit GO
- New UX candidate development: HOLD while Deployment Governance incident is OPEN

## Absolute prohibitions

- No `supabase db reset` against shared remote.
- No implicit shared DB mutation.
- No implicit main merge.
- No implicit Netlify Production deploy.
- No implicit Vercel Production deploy.
- No small-change Preview spam.
- No declaring Deployment Safety PASS merely because no intentional Preview was created.
- No changing `vercel.json`, Git Integration, `deploymentEnabled`, `ignoreCommand`, Deploy Hooks, Git auto deployment, Production Branch, project settings, or CLI/API deployment method without management approval and measured verification.
- No GT use in OCR runtime/control/candidate/stop/fallback/expected-count logic; GT scoring-only.
- No declaring OCR accuracy improvement from CI/static PASS without formal real-photo evidence.
- No accepting a UX candidate that contradicts explicit confirmed parent spec.

## Parent-spec next revision requirement

Add a formal `Deployment Governance / 共通インフラ運用` section covering:
1. ordinary Git push -> Vercel deployment 0
2. Preview only on management GO
3. no small-change Preview spam
4. preceding-24h deployment audit before Preview
5. audit CANCELED/ERROR as well as READY
6. management approval for deployment-control settings/method changes
7. old-control -> new-control -> conflict check -> old-control removal -> measured validation
8. config review alone is insufficient; ordinary push -> 0 deployment records must be measured.

## Handoff requirement

Every handoff must include target branch/current HEAD, accepted technical baseline, GO/HOLD, last instruction, implemented vs missing vs HOLD/review, blockers/reasons, exact next action, production/DB/OCR state, technical PASS vs UX acceptance, full audit status, complete incident history (Supabase/Netlify/Vercel), OPEN Deployment Governance status, HOLD matrix, and absolute prohibitions.

## Paste-ready/display rule

For ICB text intended to be copied to another project chat:
- Use normal fenced Markdown code block.
- Do not use Writing Blocks / Plain text cards.
- Avoid large rendered headings on iPhone.
- Preserve this rule in every fresh-chat handoff.
