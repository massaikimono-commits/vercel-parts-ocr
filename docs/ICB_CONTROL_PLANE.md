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

## Current lane ledger — verified 2026-09-10 19:56 JST

### App main
- Branch: `preview/schedule-ux-20260903`
- HEAD: `e5538be901a3c4d97d39fdc372be447efa650e8f`
- Previous management ledger HEAD: `0895ab6204324b7482aca66fed3bf79c936bf246`
- GitHub delta from `0895ab...`: ahead 3 / behind 0; functional files changed are `app/schedule/detail/page.tsx` and `scripts/schedule-detail-regression.mjs`.
- Implemented after previous ledger: practical schedule-detail work hub. It adds customer phone, waiting-service, loaner, urgent, outsource vendor, and direct current-vehicle actions for parts/history/photos/inspection; the one-time implementation workflow was removed after use.
- PR #62: Draft / Open / unmerged unless a newer direct verification says otherwise.
- Base main: `20a715bf46156282b686a617d6744a040bc17fb3` unless a newer direct verification says otherwise.
- `legal_3m` DB mutation remains HOLD.
- `legal_3m` DB-independent work completed: design audit, daily report code `3`, regression, migration draft.
- Shared DB reason for HOLD: Netlify is the intended production app but is behind current development; Vercel Preview-only needs must not mutate shared DB ahead of Netlify compatibility.
- Next management action: independently audit the new schedule-detail hub regression/build/deployment safety before deciding the next DB-free app-main batch. Do not re-instruct work already present at `e5538be...`.

### Vehicle certificate QR/OCR
- Branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`
- HEAD: `93459de154dc358321044a5a8b23a083afe7d2fc`
- Parent: `8b9b4c4dcc180b8b1d41a15ca898f3e5cf77f911`.
- Stage A21.8 guarded adoption-readiness contract: implemented.
- GitHub Actions run `34466939372`: SUCCESS, including A21.4/A21.5/A21.6/A21.7/A21.8 audits, prior A21.3/A21.2 invariants, Full regression, and Next build.
- Vercel Git auto-deploy: fail-closed; management verified zero new deployment records after the A21.8 push.
- Formal Photo QR Decode: `28/47` preserved.
- `31/47`: candidate only, not adopted.
- Adoption contract blocks unless real character-class evidence, exactly 3 eligible physical/fingerprint groups, shared schema, jsQR+ZXing structural agreement, same-physical reproduction, length 60, control/replacement 0, no CURRENT canonical/physical collision, privacy/formal isolation, and additional-real regression PASS are all satisfied.
- Non-Preview internal work is considered exhausted for this exact blocker.
- Next meaningful action: one authorized fixed8 real-photo run only, collecting privacy-safe character-class evidence; no redundant reruns. Then feed the result into A21.8, followed by additional-real regression if eligible.
- Raw payload/fragments/codepoints/PII must not be stored.
- Frozen OCR branch, main, Netlify Production, Vercel Production, Supabase: HOLD.

### Parts OCR
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`
- Source HEAD: `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`
- Previous source HEAD: `e681b6331039977faaf0b3cf6f115745222cfe80`.
- Latest source commit: align source with audited crop-isolation candidate.
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`
- Eval HEAD: `fa8df79c3eff7cc9c100d48b357d09c930168cdf`
- Previous eval HEAD: `f78bfb6dcd22dc04c9074d35c09b199b8e64fc5a`.
- Latest eval commit: extend A22 invariant and attribution regression.
- Formal adopted OCR HEAD: none.
- Continue non-Preview A22 validation until internal evidence is genuinely exhausted; do not ask the user to identify/select fixed filenames.
- Any eventual real-photo target must auto-map from the formal yellow12 set and avoid repeated testing.
- Before issuing the next parts-OCR instruction, management must inspect the exact A22 delta and CI/deployment status at these current HEADs; do not duplicate the work already advanced after the previous ledger.
- Frozen OCR branch, Stage B, Guided Live, main, Production, Supabase: HOLD.

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
