# ICB One-shot Vercel Preview Control Plane

## Purpose
Keep ordinary Git pushes fail-closed while allowing a management-approved exact commit to be deployed exactly once as a Vercel Preview.

## Normal operation
`vercel.json` remains the Git auto-deployment authority. Unknown branches and `main` remain disabled. Ordinary candidate pushes do not create Vercel deployments.

## Approved Preview operation
Run **Vercel one-shot preview** manually with `workflow_dispatch` and provide `branch`, `expected_sha`, and `full_regression_run_id`. The workflow verifies repository identity, rejects `main`, verifies branch HEAD equals the expected SHA, verifies the supplied Full regression run name/SHA/conclusion, checks out the exact SHA, verifies a clean tree, and requires the existing `VERCEL_TOKEN` secret.

Fixed Vercel scope:
- Team: `team_GHd3ONZSRilQtxTq1q6NS1jT`
- Project: `prj_GUedEKT5z3vrL7NMLGhx04jgPeMK`

## Preview-only guarantee
The workflow has no push, pull-request, or schedule trigger. It contains no `--prod`, production target input, promote command, or production environment selection. `main` is rejected before deployment. Any inspected deployment whose target is production is rejected.

## Duplicate policy
Before deployment, query the fixed project for an existing non-production deployment with the exact Git SHA. READY is reused; BUILDING/QUEUED is reused and waited on; ERROR/CANCELED stops without automatic retry; none creates one Preview deployment. Concurrency is keyed by exact SHA.

## Authentication
`VERCEL_TOKEN` must already exist as a GitHub Actions repository/environment secret. Its value must never be printed or committed. Creating or changing credentials remains management-controlled.

## Audit output
Successful runs record workflow run ID, source branch/SHA, project ID, deployment ID, Preview target, READY state, Preview URL, and HTTP status.

## Safety regression
`scripts/vercel-one-shot-preview-guard.mjs` structurally verifies the workflow. `scripts/deployment-safety-regression.mjs` rejects direct Vercel deployment commands everywhere except this guarded workflow. Existing selective Git deployment regression continues to protect ordinary pushes.

## Prohibited shortcuts
Do not enable `candidate/**` in `vercel.json`, add dummy commits, use `--prod`, promote a Preview, apply shared Supabase changes, or bypass exact-SHA / Full Regression gates.
