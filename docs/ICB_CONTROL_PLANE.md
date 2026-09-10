# ICB Management Control Plane

Canonical management branch: `management/icb-control-plane-20260910`

This file is the required preflight reference for any GO/HOLD, adoption, DB change, deployment decision, or specialist handoff.

## Mandatory preflight before every major decision

1. Read the latest parent specification and this control-plane file.
2. Verify the target lane branch and current HEAD in GitHub.
3. Verify the latest confirmed specialist report against GitHub/DB/Vercel when tools permit.
4. Identify what is implemented, uninstructed, blocked, or intentionally HOLD.
5. Re-check the original reason behind any HOLD or safety rule before changing it.
6. Treat user statements as evidence, not automatic ground truth; verify independently when possible.
7. A GO/HOLD in one lane never propagates to another lane.
8. Response speed is lower priority than state consistency.

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

## Current lane ledger — 2026-09-10

### App main
- Branch: `preview/schedule-ux-20260903`
- HEAD: `0895ab6204324b7482aca66fed3bf79c936bf246`
- PR #62: Draft / Open / unmerged
- Base main: `20a715bf46156282b686a617d6744a040bc17fb3`
- Current focus: continue DB-independent work; `legal_3m` DB mutation is HOLD.
- `legal_3m` DB-independent work completed: design audit, daily report code `3`, regression, migration draft.
- Shared DB reason for HOLD: Netlify is the intended production app but is behind current development; Vercel Preview-only needs must not mutate shared DB ahead of Netlify compatibility.

### Vehicle certificate QR/OCR
- Branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`
- HEAD: `8b9b4c4dcc180b8b1d41a15ca898f3e5cf77f911`
- Vercel Git auto-deploy: fail-closed verified with zero new Vercel deployment records after branch update.
- GitHub Actions A21.4/A21.5/A21.6/A21.7: PASS.
- Full regression + Next build: PASS.
- Formal Photo QR Decode: `28/47` preserved.
- `31/47`: candidate only, not adopted.
- Next meaningful blocker: one fixed8 real-photo run to collect privacy-safe class evidence when the evaluation path is ready; no redundant reruns.
- Frozen OCR branch, main, Production: HOLD.

### Parts OCR
- Source branch: `experiment/parts-ocr-stage-a22-cell-crop-correction`
- Source HEAD: `e681b6331039977faaf0b3cf6f115745222cfe80`
- Eval branch: `eval/parts-ocr-stage-a22-cell-crop-correction`
- Eval HEAD: `f78bfb6dcd22dc04c9074d35c09b199b8e64fc5a`
- Vercel Git auto-deploy: fail-closed verified with zero new Vercel deployment records after branch updates.
- A22 CI/build: PASS.
- Formal adopted OCR HEAD: none.
- Continue non-Preview A22 validation; avoid repeated real-photo testing until internal evidence is exhausted.
- Frozen OCR branch, Stage B, Guided Live, Production: HOLD.

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

If a mistake reveals a repeatable failure class, update this control-plane file and the next parent-spec revision proactively.