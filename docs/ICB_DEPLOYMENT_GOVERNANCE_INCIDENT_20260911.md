# ICB Deployment Governance Incident — 2026-09-11

Status: OPEN
Severity: HIGH
Owner: ICB app overall management
Scope: Vercel project `vercel-parts-ocr` / repo `massaikimono-commits/vercel-parts-ocr`

## Incident definition

Vercel deployment governance failed because GitHub pushes across app/OCR experiment/eval branches generated Vercel Deployment records, including CANCELED records, and previously exhausted or threatened the Hobby deployment limit. Deployment Safety is therefore not defined as “management did not intentionally create a Preview”. The required definition is: **no unintended new Vercel Deployment record is generated**.

READY, CANCELED, ERROR and skipped/ignored-equivalent records are all in scope for auditing.

## Historical configuration evidence

- 2026-08-27 commit `dff03bf4f2dc3abfb7c53c1b3767d845ebcb9469` introduced `ignoreCommand` using a `[deploy]` commit-message gate.
- 2026-09-02 commit `44928ded4e1d0f8ce35bd94507b3da46fdadc0c2` added `git.deploymentEnabled=false` while retaining the old `ignoreCommand` gate.
- Current active app / vehicle OCR eval / parts OCR source+eval branches audited on 2026-09-11 all carry `git.deploymentEnabled=false` and the legacy `ignoreCommand` simultaneously.

## Target operating model

Normal GitHub push -> Vercel Deployment records: 0.

Preview needed -> management GO -> exact target HEAD -> exactly one explicit deployment.

Do not use small-change Preview deployments.

`git.deploymentEnabled=false` is the preferred central control. The legacy `ignoreCommand` / `[deploy]` marker mechanism is pending controlled retirement after Vercel project-setting audit and a zero-deployment push test. Do not disconnect GitHub integration unless keeping the integration while achieving zero automatic deployments is shown to be impossible.

## Mandatory management audit

At management start and before Preview GO, inspect:

- Vercel project state
- deployments in the preceding 24 hours
- counts by READY / CANCELED / ERROR / other states
- source branches / commit SHAs
- Production target changes
- current `vercel.json`
- relevant Git Integration / project settings when accessible
- whether ordinary pushes generated any deployment record

If an unintended deployment appears, stop additional pushes in the affected lane and investigate first.

## 2026-09-11 live audit snapshot

At the first independent management re-audit after escalation, the connected Vercel project was confirmed as `vercel-parts-ocr` on Hobby plan. In the preceding 24-hour query window, 4 Deployment records were returned and all 4 were CANCELED; no READY or ERROR record was returned in that window. All four records were associated with OCR experiment/eval GitHub pushes. This indicates the earlier >100/24h flood has rolled out of the current 24-hour window, but it does **not** by itself close the incident or authorize Preview.

## Immediate HOLD

Until closure criteria are met:

- Vercel Preview: HOLD except a management-approved controlled validation/deployment step
- Vercel Production: HOLD
- Netlify Production: HOLD
- main merge: HOLD
- shared Supabase mutation: HOLD
- OCR Frozen branches: HOLD / unchanged
- legal_3m: HOLD
- additional UX candidate development is lower priority than this incident

## Closure criteria

Do not close until all are satisfied:

- direct cause of mass Deployment creation is documented
- historical cause commits/settings are documented
- Vercel project settings are independently audited to the extent tooling allows
- ordinary Git push -> 0 new Deployment records is measured
- legacy `ignoreCommand` / `[deploy]` mechanism is retired or a documented reason to retain it is approved
- automatic deployment flood is confirmed stopped
- current preceding-24h deployment state is reviewed
- availability of the required Preview is determined
- when authorized, exactly one required Preview is created successfully
- Vercel Production unchanged
- Netlify Production unchanged
- main unchanged
- shared Supabase unchanged
- OCR Frozen unchanged
- Management Control Plane references this incident and its new audit definition
- Deployment Governance is added to the next parent-spec revision
- future management handoffs carry these rules

## Parent-spec next-version requirement

The next ICB-SPEC revision must add a formal `Deployment Governance / 共通インフラ運用` section that fixes at minimum:

1. ordinary Git push must not create Vercel deployments
2. Preview only on management GO
3. no small-change Preview spam
4. inspect preceding-24h deployment state before Preview
5. audit CANCELED / ERROR as well as READY
6. management approval required for `vercel.json`, Git Integration, `deploymentEnabled`, `ignoreCommand`, Deploy Hooks, Git auto deployment, Production Branch, project settings, and CLI/API deployment method changes
7. control changes must document old -> new -> conflict check -> old-control removal -> measured validation
8. configuration-only review is insufficient; measured ordinary push -> 0 Deployment records is required for PASS
