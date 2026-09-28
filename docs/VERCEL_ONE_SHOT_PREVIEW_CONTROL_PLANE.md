# ICB One-shot Vercel Preview Control Plane

## Purpose

Keep ordinary Git pushes fail-closed while allowing a management-approved exact commit to be deployed exactly once as a Vercel Preview.

## Normal operation

`vercel.json` remains the Git auto-deployment authority. Unknown branches, `main`, and work/eval/experiment/poc/management/docs/dependabot branches remain disabled. Ordinary candidate pushes do not create Vercel deployments.

## Approved Preview operation

Run **Vercel one-shot preview** manually with `workflow_dispatch` and provide:

- `branch`: the management-approved source branch.
- `expected_sha`: the approved full 40-character SHA.
- `full_regression_run_id`: the successful **Full regression** Actions run for that exact SHA.

The workflow verifies repository identity, rejects `main`, verifies branch HEAD equals the expected SHA, verifies the supplied Full regression run name/SHA/conclusion, checks out the exact SHA, verifies a clean tree, and requires the existing `VERCEL_TOKEN` secret.

The Vercel organization/team and project are fixed in workflow source:

- Team: `team_GHd3ONZSRilQtxTq1q6NS1jT`
- Project: `prj_GUedEKT5z3vrL7NMLGhx04jgPeMK`

## Preview-only guarantee

The workflow has no push, pull-request, or schedule trigger. It contains no `--prod`, production target input, promote command, or production environment selection. `main` is rejected before deployment. Any inspected deployment whose target is production is rejected.

## Duplicate policy

Before deployment, the workflow queries the fixed project for an existing non-production deployment with the exact Git SHA.

- READY: reuse it; do not deploy again.
- BUILDING/QUEUED: reuse and wait; do not deploy again.
- ERROR/CANCELED: stop; automatic retry is forbidden.
- None: create one Preview deployment.

Concurrency is keyed by exact SHA so simultaneous dispatches for the same SHA cannot intentionally create parallel deployments.

## Authentication

`VERCEL_TOKEN` must already exist as a GitHub Actions repository/environment secret. Its value must never be printed or committed. The workflow fails before deployment when the secret is absent. Creating or changing credentials remains a management-controlled operation.

## Audit output

A successful run writes to the GitHub Actions job summary:

- workflow run ID
- source branch
- source SHA
- Vercel project ID
- deployment ID
- Preview/non-Production target
- READY state
- Preview URL
- HTTP status

## Safety regression

`scripts/vercel-one-shot-preview-guard.mjs` structurally verifies the workflow. `scripts/deployment-safety-regression.mjs` continues to reject direct Vercel deployment commands everywhere except this guarded workflow. `scripts/vercel-selective-deploy-regression.mjs` continues to protect ordinary Git push behavior.

## Prohibited shortcuts

Do not enable `candidate/**` in `vercel.json`, add dummy commits, merge to `main`, use `--prod`, promote a Preview, apply shared Supabase changes, or bypass the exact-SHA / Full Regression gates to obtain a Preview URL.
