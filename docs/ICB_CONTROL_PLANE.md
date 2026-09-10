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

## Current lane ledger — verified 2026-09-10 20:15 JST

### App main
- Branch: `preview/schedule-ux-20260903`
- HEAD: `e5538be901a3c4d97d39fdc372be447efa650e8f`.
- Start HEAD for the completed DB-free batch: `0895ab6204324b7482aca66fed3bf79c936bf246`.
- GitHub compare: ahead 3 / behind 0; final net functional diff is only `app/schedule/detail/page.tsx` and `scripts/schedule-detail-regression.mjs`.
- PR #62 is independently verified Draft / Open / unmerged, base `main`, head `e5538be...`; base main SHA is `20a715bf46156282b686a617d6744a040bc17fb3`.
- Practical schedule-detail work hub batch: PASS. It adds customer phone, waiting-service, loaner, urgent, outsource vendor, and direct current-vehicle actions for parts/history/photos/inspection while preserving reservation edit/cancel.
- The active vehicle snapshot uses the existing `parts-active-vehicle` sessionStorage/localStorage convention; no new DB/state model is introduced.
- History/photo routes remain vehicle-ID scoped; inspection shortcut is limited to 点検/車検 and passes the current workOrderId.
- OCR execution is not coupled into this hub; OCR code is unchanged.
- Waiting-service semantics are read-only in this batch; selection/save/delivery/duplicate-warning behavior is unchanged.
- GitHub Actions run `34468632333`: SUCCESS including patch application, dependency install, targeted regressions, Full build, and tested commit.
- Deployment safety guard run `34468739945`: SUCCESS at final HEAD. Management independently verified no new Vercel deployment records after the current update window.
- `legal_3m` shared-DB mutation remains HOLD. DB-independent legal_3m work already completed: design audit, daily-report code `3`, regression, migration draft.
- Shared DB reason for HOLD: Netlify is the intended production app but is behind current development; Vercel Preview-only needs must not mutate shared DB ahead of Netlify compatibility.
- Supabase, main, Netlify Production, Vercel Production, OCR lanes: unchanged.
- Vercel Preview remains HOLD while the build-rate-limit policy is active.
- Next app-main selection should again prefer a practical, existing-DB-only improvement that reduces real shop workflow steps and does not depend on OCR or shared DB mutation. Before issuing it, inspect the latest branch HEAD again to avoid duplicate work.

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
- Current exact blocker: the existing Preview is A21.5 generation and cannot execute the A21.7/A21.8 one-shot evaluation route; a new evaluation Preview from this completed HEAD is required before the single authorized fixed8 real-photo run can occur.
- Do not create that Preview while the Vercel build-rate-limit HOLD is still active or without a fresh management deployment-budget check.
- When Preview becomes permitted, deploy only this completed meaningful real-device unit, then perform exactly one fixed8 run; no redundant reruns.
- If fixed8 safety gates pass, additional-real regression remains required before any guarded Formal candidate can be considered.
- Raw payload/fragments/codepoints/canonical payload/PII must not be stored or displayed.
- Frozen OCR branch, main, Netlify Production, Vercel Production, Supabase: HOLD.

### Parts OCR
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`
- Source HEAD: `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`.
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`
- Eval HEAD: `fa8df79c3eff7cc9c100d48b357d09c930168cdf`.
- Formal adopted OCR HEAD: none.
- Stage A22 non-Preview work is complete for the current hypothesis. The source is connected to the audited crop-isolation candidate and the eval branch adds invariant/attribution regression.
- Implemented/verified candidate scope includes projective rectification via 4-point homography, paper-quad estimation, horizontal/vertical rule-band detection and thickness, A19 row-center anchoring, nearest-rule row reconstruction, safe expansion, monotonic/unique column mapping, rule exclusion margins, white padding, preserved row slots, duplicate/row-shift prevention, crop diagnostics, and normalization attribution separation.
- Recognizer/model unchanged; A17/A19 thresholds unchanged; GT is scoring-only and not used by runtime/control.
- Static/invariant validation includes 500 homography fuzz cases, row-slot matrix across 1-12 rows, duplicate preservation, 500 column-assignment fuzz cases, normalization-attribution matrix, GT isolation, and deployment fail-closed checks.
- GitHub Actions run `34468717743`: SUCCESS at eval HEAD `fa8df79...`, including Stage A22 static structural crop audit, Stage A22 invariant fuzz/policy audit, npm install, and Next build.
- Management independently verified both branch HEADs and the latest eval diff, and verified zero new Vercel deployment records after the current source/eval update window.
- A21 formal evidence remains the baseline for diagnosis: truncation `32/32`, table-line contamination `26/32`, with `CELL_CROP_QUALITY` primary. A22 is aimed directly at those causes; A20/A21 formal results are not overwritten.
- Internal/static/fixture/synthetic evidence is now considered exhausted for the next question. The next meaningful blocker is one browser real-photo diagnostic targeting IMG_0684 from the formal yellow12 set, with automatic mapping and no user filename identification.
- The one real-photo run should verify GT rows 8, dynamic rows 8, rule-bounded rows, projective application/quad confidence, rule counts, reduction from truncation 32/32 and table-line 26/32, occupancy/edge-touch, TESS/JA_LIGHT/V5 accuracy, and normalization-attribution breakdown.
- Preview is required for that browser real-photo run. Do not create an intermediate Preview. While the Vercel build-rate-limit HOLD is active, stop at this completed eval HEAD; once Preview is permitted, use only this completed meaningful real-device unit for one targeted run.
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
