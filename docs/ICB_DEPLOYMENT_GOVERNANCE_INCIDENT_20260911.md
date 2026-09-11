# ICB Deployment Governance Incident — 2026-09-11

Status: CONTAINED — NORMAL GITHUB DEVELOPMENT RESUMED / PREVIEW RE-ENABLE VALIDATION OPEN
Severity: HIGH (incident), current automatic-deployment risk contained
Owner: ICB app overall management
Scope: Vercel project `vercel-parts-ocr` / repo `massaikimono-commits/vercel-parts-ocr`

## Incident definition

GitHub pushes across app/OCR experiment/eval branches generated Vercel Deployment records, including CANCELED records, and previously exhausted or threatened the Hobby deployment limit. Deployment Safety is therefore defined as: **no unintended new Vercel Deployment record is generated**. READY, CANCELED, ERROR and skipped/ignored-equivalent records are all audit scope.

## Historical configuration evidence

- 2026-08-27 commit `dff03bf4f2dc3abfb7c53c1b3767d845ebcb9469` introduced `ignoreCommand` using a `[deploy]` commit-message gate.
- 2026-09-02 commit `44928ded4e1d0f8ce35bd94507b3da46fdadc0c2` added `git.deploymentEnabled=false` while retaining the old `ignoreCommand` gate.
- This created redundant deployment control and an obsolete `[deploy]` operational path.

## Corrected operating model

Normal GitHub push -> Vercel Deployment records: 0.

Preview needed -> management GO -> exact target HEAD -> exactly one explicit deployment.

`git.deploymentEnabled=false` is now the single repository-level Git auto-deployment lock. The legacy Vercel `ignoreCommand` / `[deploy]` marker gate has been removed from the active app, management, vehicle-OCR eval, parts-OCR source and parts-OCR eval lanes. Deployment Safety regression now rejects reintroduction of `ignoreCommand`.

GitHub Integration remains connected. Disconnect is not needed because zero automatic deployments has been measured with the integration retained.

## 2026-09-11 measured validation

Initial independent 24-hour audit returned 4 Vercel Deployment records: 4 CANCELED, 0 READY, 0 ERROR. All four were tied to earlier OCR experiment/eval pushes.

Controlled GitHub pushes were then performed after confirming `git.deploymentEnabled=false` across the active lanes. The legacy gate and its regression contract were retired. During and after the following active-lane pushes, Vercel returned **0 new Deployment records** for the validation window beginning 2026-09-11 18:30 JST:

- app branch `preview/schedule-ux-20260903`
- management branch `management/icb-control-plane-20260910`
- vehicle OCR eval branch `eval/certificate-qr-stage-a21-4-format-counterfactual`
- parts OCR source branch `experiment/parts-ocr-stage-a22-cell-crop-correction`
- parts OCR eval branch `eval/parts-ocr-stage-a22-cell-crop-correction`

App Deployment Safety initially failed because the old regression still required the obsolete `ignoreCommand`; that regression was corrected to require `git.deploymentEnabled=false` and reject `ignoreCommand`. App Deployment Safety run `34585226425` then completed SUCCESS on app infrastructure HEAD `8a5796834ac0dd43ef56e94a2a75557a57ef5d2a`.

This is measured evidence that ordinary GitHub development pushes can resume without consuming Vercel Deployment records under the current active-lane configuration.

## Development / Preview state

- Normal GitHub development: RESUMED.
- New app/UX implementation work: RESUMED, subject to normal spec/safety rules.
- OCR experiment/eval GitHub work: RESUMED where the lane itself is otherwise GO; Frozen OCR bodies remain HOLD.
- Vercel Preview: still HOLD until one exact-HEAD explicit Preview method is selected and verified. This does not block normal GitHub development.
- Vercel Production: HOLD.
- Netlify Production: HOLD.
- main merge: HOLD.
- shared Supabase mutation: HOLD.
- OCR Frozen branches: HOLD / unchanged.
- legal_3m: HOLD.

## Mandatory management audit

At management start and before Preview GO, inspect where tooling permits:

- Vercel project state
- deployments in the preceding 24 hours
- counts by READY / CANCELED / ERROR / other states
- source branches / commit SHAs
- Production target changes
- current `vercel.json`
- relevant Git Integration / project settings
- whether ordinary pushes generated any deployment record

If an unintended deployment appears, stop additional pushes in the affected lane and investigate first.

## Remaining Preview re-enable condition

Automatic-deployment containment is complete and normal development is resumed. The remaining infrastructure validation is Preview-specific: before the next real-device test, confirm the exact explicit deployment path, exact branch/HEAD, current 24-hour deployment state, then create exactly one Preview and verify Vercel Production remains unchanged.

Do not use `vercel deploy`, Deploy Hooks, Git marker commits, or another deployment path speculatively.

## Parent-spec next-version requirement

The required next-spec text is staged in `docs/ICB_SPEC_NEXT_DEPLOYMENT_GOVERNANCE_ADDENDUM.md` and must be integrated into the next formal ICB-SPEC revision.

## Reopen condition

If any ordinary GitHub push creates a new Vercel Deployment record, immediately classify this incident OPEN/HIGH again, stop pushes in the affected lane, and investigate before continuing.
