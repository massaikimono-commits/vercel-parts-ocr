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

## Current lane ledger — verified 2026-09-10 20:27 JST

### App main
- Branch: `preview/schedule-ux-20260903`.
- Current HEAD: `a960c5f9d77abba219a3eb357e750fa3056ebc77`.
- Previous formally passed HEAD: `e5538be901a3c4d97d39fdc372be447efa650e8f`.
- GitHub compare `e5538be... -> a960c5f...`: ahead 4 / behind 0; final net functional diff remains only `app/schedule/detail/page.tsx` and `scripts/schedule-detail-regression.mjs`.
- PR #62 independently verified Draft / Open / unmerged, base `main`, head `a960c5f...`, base main SHA `20a715bf46156282b686a617d6744a040bc17fb3`.
- Batch now implemented: schedule-detail direct work-state update. The page reuses existing RPCs `set_work_order_progress_state`, `complete_work_order_one_tap`, and `reopen_work_order` to cycle 作業未実施 -> 作業中 -> 作業完了 -> 作業未実施 from the detail screen.
- Shared Supabase was inspected read-only: those three RPCs exist with the exact argument signatures used by the page. No new RPC/schema/RLS/migration is required for this batch.
- Temporary batch CI workflow was removed after successful validation; final HEAD `a960c5f...` contains only the functional net diff above relative to `e5538be...`.
- Schedule detail work-state CI run `34471165688`: SUCCESS, including targeted regressions, Full build, and deployment safety on the tested batch commit before the temporary CI workflow cleanup.
- Deployment safety guard run `34471263882`: SUCCESS at final HEAD `a960c5f...`.
- Management verified no new Vercel deployment records in the current update window; fail-closed remains effective.
- Formal management verdict for this batch: PASS. `a960c5f...` is the new formal app-main start HEAD for the next DB-free batch.
- `legal_3m` shared-DB mutation remains HOLD because Netlify is the intended production app and is behind current development; Preview-only needs must not mutate shared DB ahead of Netlify compatibility.
- main, Supabase, Netlify Production, Vercel Production, OCR branches: unchanged/HOLD.
- Vercel Preview remains HOLD while build-rate-limit policy is active.
- Next app-main selection: inspect current HEAD again, then choose one existing-DB-only, non-duplicate practical workflow improvement that reduces taps/re-search/re-selection and does not depend on OCR or shared DB mutation. Implement -> targeted regression -> Full build; no intermediate Preview.

### Vehicle certificate QR/OCR
- Branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`
- HEAD: `b7230adf4acf3288c5fc3811d32309247361dcf1`
- Stage A21.8 one-shot real-evidence route is implemented at `/eval/certificate-qr-stage-a21-8-real-evidence`.
- User flow is intended to be one selection of all fixed8 images, automatic image mapping/run, no manual IMG mapping, and one `総合管理用短縮summaryをコピー` result action.
- GitHub Actions run `34468741224`: SUCCESS at this HEAD, covering A21.4/A21.5/A21.6/A21.7/A21.8, one-shot UI invariants, prior A21.3/A21.2, Full regression, and Next build.
- Management independently verified the branch HEAD and CI result, and verified zero new Vercel deployment records after the latest push.
- Formal Photo QR Decode: `28/47` preserved.
- `31/47`: candidate only, not adopted.
- Formal parser/decoder/acceptance gate: unchanged.
- Current exact blocker for the Vercel route: the existing Preview is A21.5 generation and cannot execute the A21.7/A21.8 one-shot evaluation route; a new evaluation Preview from this completed HEAD is required before the single authorized fixed8 real-photo run can occur.
- Because the Vercel build-rate-limit was caused by excessive ICB deployments, do not describe OCR as practically advanced until a real-photo run occurs. Internal completion and real-photo accuracy progress must be reported separately.
- A common GO has been issued to investigate a Vercel-independent iPhone Safari evaluation route (e.g. static standalone/GitHub Pages or equivalent) without changing main, Supabase, Netlify Production, Vercel Production, Frozen, or Formal logic, and without externally storing raw photos/PII.
- When any real-photo route becomes available, perform exactly one fixed8 run; no redundant reruns. If fixed8 safety gates pass, additional-real regression remains required before any guarded Formal candidate can be considered.
- Raw payload/fragments/codepoints/canonical payload/PII must not be stored or displayed.
- Frozen OCR branch, main, Netlify Production, Vercel Production, Supabase: HOLD.

### Parts OCR
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`
- Source HEAD: `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`
- Eval HEAD: `fa8df79c3eff7cc9c100d48b357d09c930168cdf`.
- Formal adopted OCR HEAD: none.
- Stage A22 non-Preview work is complete for the current hypothesis.
- A21 formal evidence remains the baseline for diagnosis: truncation `32/32`, table-line contamination `26/32`, with `CELL_CROP_QUALITY` primary. A22 is aimed directly at those causes; A20/A21 formal results are not overwritten.
- Internal/static/fixture/synthetic evidence is exhausted for the next question. The next meaningful blocker is one browser real-photo diagnostic targeting IMG_0684 from the formal yellow12 set, with automatic mapping and no user filename identification.
- Because the Vercel build-rate-limit was caused by excessive ICB deployments, do not describe OCR as practically advanced until a real-photo run occurs. Internal completion and real-photo accuracy progress must be reported separately.
- A common GO has been issued to investigate a Vercel-independent iPhone Safari evaluation route, without changing main, Supabase, Netlify Production, Vercel Production, Frozen, Stage B, Guided Live, or Formal logic, and without externally storing raw photos/PII.
- The one real-photo run should verify GT rows 8, dynamic rows 8, rule-bounded rows, projective application/quad confidence, rule counts, reduction from truncation 32/32 and table-line 26/32, occupancy/edge-touch, TESS/JA_LIGHT/V5 accuracy, and normalization-attribution breakdown.
- Do not request repeated user testing. Do not ask the user to identify/select fixed filenames.
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
