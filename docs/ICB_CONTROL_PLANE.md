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

## Current lane ledger — verified 2026-09-10 22:12 JST

### App main
- Branch: `preview/schedule-ux-20260903`.
- Current formally passed HEAD: `83e7df50322d14dbee6435e63f0152b582bb6bc6`.
- Previous formal start HEAD: `a960c5f9d77abba219a3eb357e750fa3056ebc77`.
- GitHub compare `a960c5f... -> 83e7df5...`: ahead 5 / behind 0; final net diff is only `app/schedule/detail/page.tsx` (+1) and `scripts/schedule-detail-regression.mjs` (+2).
- PR #62 is Draft / Open / unmerged, base `main`; head is `83e7df5...`; main SHA remains `20a715bf46156282b686a617d6744a040bc17fb3`.
- Batch: schedule detail -> same vehicle next booking. Adds `次回予定登録` under `この車両で続ける`, using existing `openVehicleTool("/schedule/active")`, existing `rememberActiveVehicle()`, and the existing `parts-active-vehicle` snapshot. No `/schedule/active` implementation change.
- No DB schema/RPC/RLS/migration/Supabase/OCR change is introduced by this batch.
- Targeted regression assertions pin both the `次回予定登録` label and use of `openVehicleTool("/schedule/active")`.
- Successful batch validation: GitHub Actions `Schedule next-booking batch` run `34476337976` SUCCESS at tested commit `86087224f537ca6339ff7d70d8648c2b5eb2fceb`, after aligning build env with the existing app-core-build dummy Supabase env. That workflow performed targeted regressions + Full Build, then committed the verified two-file implementation and removed the temporary workflow, producing final HEAD `83e7df5...`.
- Deployment safety run `34476343211`: SUCCESS on the tested batch commit. The final bot-generated HEAD has a later deployment-safety workflow entry `34476400374` with `action_required`; do not misrepresent that as a green final-HEAD run. It did not execute as a code/test failure and does not negate the successful tested workflow output.
- Management independently verified zero Vercel deployments in the post-batch window. Vercel Preview remains HOLD.
- Formal management verdict: PASS. `83e7df5...` becomes the next app-main formal start HEAD.
- `legal_3m` shared-DB mutation remains HOLD because Netlify production is behind current development.
- main, Supabase, Netlify Production, Vercel Production, OCR branches: unchanged/HOLD.
- Next app-main action: before selecting another batch, re-audit current HEAD and choose one existing-DB-only, non-duplicate practical improvement that reduces iPhone taps/re-search/re-selection without OCR or shared DB changes; implement -> targeted regression -> Full Build; no intermediate Preview.

### Vehicle certificate QR/OCR
- Formal A21.8 source branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`, completed HEAD `b7230adf4acf3288c5fc3811d32309247361dcf1`.
- Formal Photo QR Decode remains `28/47`; `31/47` remains candidate only; adopted HEAD none.
- Vercel-independent static workaround build remains logically isolated from Formal recognition behavior.
- Latest static build branch: `eval/certificate-qr-stage-a21-8-static-standalone`, HEAD `52fd060d774015ca127abbd04467b5f674106170`.
- Latest static publish branch: `eval/certificate-qr-stage-a21-8-static-publish`, HEAD `6f9249cf5719e3ce35461296f3beb6d8f9062539`.
- GitHub Actions run `34473767112`: specialist reports SUCCESS; current static generation uses a single-file inline Safari-target bundle while preserving `connect-src 'none'`, no external raw-photo storage, and `git.deploymentEnabled=false`.
- Independent GitHub audit confirms `52fd060...` changes the standalone workflow to inline the JS bundle into `index.html`, target Safari16, retain privacy/static checks, and publish only `index.html` + `vercel.json`; publish HEAD `6f9249c...` exists and keeps deployment disabled.
- Real iPhone Safari delivery result: `STATIC DELIVERY FAIL`. Attempts via rawgit/rawcdn githack, jsDelivr, and ChatGPT HTML attachment did not produce a usable executable A21.8 page (white screen or source-text rendering). Treat this as hosting/Content-Type/execution failure, not QR recognition failure.
- Stage A21.8 real evidence: `NOT EVALUATED`.
- Stage A21.8 adoption readiness: `NOT EVALUATED`.
- Fixed8 authorization is unconsumed: IMG_0940-0947 selected 0 times, QR processing started 0 times, formal fixed8 run not executed.
- Do not repeat the same rawgit/jsDelivr/ChatGPT attachment delivery attempts.
- Vercel read-only audit at 21:55 JST still shows a dense rolling-24h deployment history with additional pagination beyond the first 40 records. This does not prove build-rate-limit clearance, so Preview remains HOLD; do not test clearance by creating a deployment.
- Next vehicle-cert action: either establish a genuinely executable HTTPS host without touching prohibited production/shared resources, or wait until Vercel build-rate-limit clearance can be proven read-only and then consider exactly one completed A21.8 Preview deployment. No intermediate deployment.
- When an executable route is actually available, perform exactly one fixed8 run and copy `総合管理用短縮summary`; no redundant rerun.
- Frozen OCR branch, main, Netlify Production, Vercel Production, Supabase: HOLD.

### Parts OCR
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`, HEAD `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`, HEAD `fa8df79c3eff7cc9c100d48b357d09c930168cdf`.
- Formal adopted OCR HEAD: none.
- Stage A22 non-Preview work is complete for the current hypothesis.
- A21 baseline remains truncation `32/32`, table-line contamination `26/32`, `CELL_CROP_QUALITY` primary.
- Next meaningful blocker is one browser real-photo diagnostic targeting IMG_0684 from the formal yellow12 set, automatic mapping, no user filename identification.
- Do not describe parts OCR as practically improved until the real-photo result exists.
- A common GO has been issued to investigate a Vercel-independent iPhone Safari evaluation route; evaluate that lane independently and do not assume the vehicle-cert static-delivery result automatically applies.
- Do not request repeated user testing.
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

## Repeat-failure handling

If a mistake reveals a repeatable failure class:
1. Correct the immediate decision.
2. Verify the real state from source-of-truth systems.
3. Update this control-plane file so the same class of mistake has an explicit preflight guard.
4. Carry the stable rule into the next parent-spec revision.
5. Do not consume user time discussing prevention when management can implement the prevention itself.
6. Common instructions that apply to multiple specialist lanes should be issued once in one shared paste-ready block instead of making the user repeat substantially identical instructions lane by lane.
7. If a user-side action is the only remaining step, instruct the user directly instead of sending a redundant round-trip instruction to the specialist chat.
