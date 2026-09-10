# ICB Management Control Plane

Canonical management branch: `management/icb-control-plane-20260910`

This file is the required preflight reference for any GO/HOLD, adoption, DB change, deployment decision, specialist handoff, or current-state assertion.

## Mandatory preflight before every major decision

1. Read the latest parent specification and this control-plane file.
2. Verify the target lane branch and current HEAD in GitHub immediately before responding.
3. Verify the latest confirmed specialist report against GitHub/DB/Vercel when tools permit.
4. Identify what is implemented, uninstructed, blocked, intentionally HOLD, or has advanced since the last management message.
5. Re-check the original reason behind any HOLD or safety rule before changing it.
6. Treat user statements and specialist reports as evidence, not automatic ground truth; verify independently when possible.
7. A GO/HOLD in one lane never propagates to another lane.
8. Response speed is lower priority than state consistency.
9. If the verified branch HEAD has advanced since this ledger, inspect the delta before issuing new instructions; never overwrite or duplicate work already completed by a specialist.
10. When a lane reaches a real-device blocker, first confirm that no non-Preview/static/fixture/synthetic/code-audit work remains before asking the user to test.
11. A generated/published static branch is not by itself proof that an iPhone-accessible hosted URL works; actual Safari delivery/execution result controls the next GO.
12. Never collapse technical implementation PASS into product/UX adoption PASS. For convenience/UI workflow changes, technical PASS means only that code/regression/build are sound. Whether the feature is actually useful, should remain, or should be removed is decided by the user after hands-on Preview evaluation unless the requirement was already explicitly fixed in the parent specification.
13. Do not label an unsolicited convenience feature as "needed", "useful", or formally adopted merely because it reduces taps in theory. It may exist only as a Preview candidate until user evaluation.
14. A speculative UX candidate must not be merged to main, propagated to Production, or written into the parent specification as adopted before user acceptance.
15. Before stating "no implementable confirmed requirement remains", perform a full confirmed-requirement audit against the latest parent spec section-by-section and the current app HEAD. A partial scan of recent/high-level items is insufficient. Record each confirmed requirement as implemented / implementable-unimplemented / intentionally HOLD / review-only. If even one implementable-unimplemented confirmed item exists, it takes priority over speculative UX work.
16. When app work is otherwise idle, speculative convenience/UX candidates may be batched without a fixed item count, but only after rule 15 has found no immediately implementable confirmed requirement. Each candidate must have a clear current-pain explanation, behavior explanation, UX benefit explanation, conflict/duplication check, and be independently removable or revisable. These candidates remain Preview-only until user hands-on acceptance.
17. Do not bounce between extremes ("auto-build convenience features" vs "stop all convenience work"). Priority is: confirmed requirement first; intentionally blocked confirmed requirement stays HOLD; then batched Preview-only UX candidates.
18. Repeated correction of the same management error class is a handoff risk signal. If state/history/spec interactions become dense enough that recent assertions are being contradicted by the source of truth, prepare a fresh-chat handoff before continuing major decisions. Do not wait for the user to ask whether the chat is too long.

## Production and shared-resource rules

- Netlify is the intended real operational production environment.
- `main`, Netlify Production, Vercel Production, and shared Supabase are not changed without a validated reason and the applicable approval rule.
- Vercel Preview alone must not drive a shared Supabase schema change when Netlify Production is still on an older app state and the Preview does not require that DB change.
- For DB-dependent features, implement DB-independent portions first and HOLD the shared DB mutation until Netlify/app compatibility is ready.
- Never use `supabase db reset` against the shared remote project.

## Deployment safety

- Ordinary Git pushes must not create Vercel deployments.
- Every active development branch must preserve `git.deploymentEnabled=false` in `vercel.json`.
- Preview deployments are batched by meaningful real-device test unit, never per small commit.
- Main/Production deploys are always explicit.
- Deployment safety must be verified from actual Vercel deployment records, not only CI claims.
- A specialist-reported deployment count is not authoritative until management checks Vercel directly.

## Current lane ledger — verified 2026-09-10 23:47 JST

### App main
- Branch: `preview/schedule-ux-20260903`.
- Current branch HEAD: `1f5b63db4964c85cbd0c2766acd8dae432a55390`.
- Previous HEAD: `b589a5238635c2ce0566d8518ab9788eb10043c3`.
- GitHub compare `b589a523... -> 1f5b63db...`: ahead 4 / behind 0; final net diff is only `app/customer-vehicles/page.tsx` (+2) and `scripts/customer-migration-workflow-regression.mjs` (+2).
- PR #62 remains Draft / Open / unmerged; base `main`; main SHA remains `20a715bf46156282b686a617d6744a040bc17fb3`.
- Parent-spec audit found one implementable confirmed requirement that management had incorrectly missed: the vehicle action menu requirement to navigate to integrated history and lease maintenance for the selected vehicle. This is confirmed specification work, not a speculative UX candidate.
- Implemented at `1f5b63db...`: selected vehicle -> `/customer-vehicles/history?vehicle=<vehicle_id>` and selected vehicle -> `/customer-vehicles/lease-maintenance?vehicle=<vehicle_id>`, reusing existing pages and selected vehicle ID; no DB change.
- Specialist-reported validation: `Customer vehicle menu contract batch` run `34492179232` PASS for targeted regressions + Full Build; Deployment Safety run `34492300705` PASS. No Preview/Production/DB/OCR change reported.
- Formal management classification: confirmed-spec implementation, technical PASS pending only normal management source-of-truth checks; not subject to UX Preview adoption gating as an unsolicited candidate.
- Convenience-oriented Preview candidates already present from earlier batches: next-booking direct action, customer/vehicle-info direct action, and one-tap customer call. These remain technically implemented Preview candidates, not formally product-adopted until hands-on Preview review.
- Before any further UX candidate batch, perform a full section-by-section parent-spec confirmed-requirement audit against `1f5b63db...`; do not state "none remain" from memory or a partial checklist.
- If that full audit finds no immediately implementable confirmed requirement, batched UX/convenience candidate work is allowed with no fixed count, provided each candidate is understandable, independently removable/revisable, non-duplicative, and Preview-only pending user acceptance.
- `legal_3m` shared-DB mutation remains HOLD because Netlify production is behind current development.
- main, Supabase, Netlify Production, Vercel Production, OCR branches: unchanged/HOLD.
- Vercel Preview remains HOLD until build-rate-limit clearance is proven.

### Vehicle certificate QR/OCR
- Formal A21.8 source branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`, completed HEAD `b7230adf4acf3288c5fc3811d32309247361dcf1`.
- Formal Photo QR Decode remains `28/47`; `31/47` remains candidate only; adopted HEAD none.
- Vercel-independent static workaround build remains logically isolated from Formal recognition behavior.
- Latest static build branch: `eval/certificate-qr-stage-a21-8-static-standalone`, HEAD `52fd060d774015ca127abbd04467b5f674106170`.
- Latest static publish branch: `eval/certificate-qr-stage-a21-8-static-publish`, HEAD `6f9249cf5719e3ce35461296f3beb6d8f9062539`.
- Real iPhone Safari delivery result: `STATIC DELIVERY FAIL`. Treat this as hosting/Content-Type/execution failure, not QR recognition failure.
- Stage A21.8 real evidence: `NOT EVALUATED`.
- Stage A21.8 adoption readiness: `NOT EVALUATED`.
- Fixed8 authorization is unconsumed: IMG_0940-0947 selected 0 times, QR processing started 0 times, formal fixed8 run not executed.
- Current direct impact: completed A21.8 cannot perform its required real-photo fixed8 run through the intended Preview path while the deployment limit is active; this is a concrete development-blocking impact, not merely deployment waste.
- Next vehicle-cert action: either establish a genuinely executable HTTPS host without touching prohibited production/shared resources, or wait until Vercel build-rate-limit clearance can be proven read-only and then consider exactly one completed A21.8 Preview deployment. No intermediate deployment.
- Frozen OCR branch, main, Netlify Production, Vercel Production, Supabase: HOLD.

### Parts OCR
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`, formal non-Preview PASS HEAD `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`; formal non-Preview PASS eval HEAD `fa8df79c3eff7cc9c100d48b357d09c930168cdf`; current infrastructure HEAD `cac7de9e5f208f859a2ee374dc29ea959c6dbeac`.
- Formal adopted OCR HEAD: none.
- Stage A22 non-Preview work is complete for the current hypothesis.
- A21 baseline remains truncation `32/32`, table-line contamination `26/32`, `CELL_CROP_QUALITY` primary.
- Next meaningful blocker is one browser real-photo diagnostic targeting IMG_0684 from the formal yellow12 set, automatic mapping, no user filename identification.
- Standalone evaluator build exists and CI passes, but GitHub Pages is not published and no safe iPhone Safari execution path is established yet.
- Do not describe parts OCR as practically improved until the real-photo result exists.
- If alternate delivery cannot be established while Preview remains unavailable, record the resulting real-photo evaluation stop as a concrete development-blocking impact from the Vercel deployment-limit incident.
- Frozen OCR branch, Stage B, Guided Live, main, Netlify Production, Vercel Production, Supabase: HOLD.

## Handoff requirement

Every specialist handoff/report must include:
- target branch
- current HEAD
- current GO/HOLD
- last formal instruction
- implemented items
- uninstructed/unimplemented items
- blockers and the original reason for each blocker
- exact next verification/action
- whether Vercel/Supabase/Netlify/main were changed
- for UX/convenience candidates: technical PASS/HOLD and user Preview acceptance state must be reported separately
- for app-main: result of the full section-by-section confirmed-requirement audit before declaring the lane free for speculative UX work

## Repeat-failure handling

If a mistake reveals a repeatable failure class:
1. Correct the immediate decision.
2. Verify the real state from source-of-truth systems.
3. Update this control-plane file so the same class of mistake has an explicit preflight guard.
4. Carry the stable rule into the next parent-spec revision.
5. Do not consume user time discussing prevention when management can implement the prevention itself.
6. Common instructions that apply to multiple specialist lanes should be issued once in one shared paste-ready block instead of making the user repeat substantially identical instructions lane by lane.
7. If a user-side action is the only remaining step, instruct the user directly instead of sending a redundant round-trip instruction to the specialist chat.
8. When a convenience/UI candidate has technically passed but has not been hands-on tested by the user, preserve it as a Preview candidate and do not make an adoption/removal decision on the user's behalf.
9. If management incorrectly declares there are no remaining confirmed requirements, the next action is not another convenience-feature instruction. First run a complete parent-spec-vs-current-HEAD audit and update the ledger with the result.
10. If the same management mistake class recurs within the same chat, treat that recurrence as evidence that the chat context is becoming unsafe and prepare a handoff proactively.
