# Deployment Safety Policy

This repository must fail closed: normal development commits must not automatically create Netlify or Vercel deployments.

## Permanent safety rules

1. **Netlify**
   - Normal commits must be skipped.
   - Production may deploy only when the release commit explicitly contains `[deploy netlify production]`.
   - Deploy Preview may deploy only when the release commit explicitly contains `[deploy netlify preview]`.
   - Branch deploys stay disabled by default.
   - Never add either release marker to routine development, refactor, test, merge, or documentation commits.
   - `netlify.toml` syntax is validated in CI so an invalid configuration cannot silently become the next release configuration.

2. **Vercel**
   - Git-triggered deployments must remain disabled with `git.deploymentEnabled=false`.
   - The ignored-build guard must remain present as a second lock.
   - Vercel deployment is manual/explicit only.

3. **GitHub Actions**
   - Workflows must not contain direct `netlify deploy`, `vercel deploy`, `vercel --prod`, or `npx vercel` commands.
   - The deployment safety workflow checks these rules on every pull request and every push to `main`.

4. **Release process**
   - Batch fixes first.
   - Run regression tests and production build before any release.
   - Do not deploy simply because code changed.
   - Create at most the explicitly approved deployment for the current test/release batch.
   - Netlify production release requires explicit user approval before using `[deploy netlify production]`.
   - Netlify Preview release requires an intentional preview test decision before using `[deploy netlify preview]`.

5. **Database change policy**
   - Prefer code-only changes that can be validated in Vercel Preview without changing the shared Supabase database.
   - Changes that require Supabase schema, CHECK constraints, RPC/function definitions, or new persistent fields are normally deferred until Netlify Production can be redeployed with compatible code.
   - A shared-database change may be made earlier only when its effect on the currently running Netlify Production code and existing data has been explicitly checked and shown to be safe.
   - Do not create paid preview databases merely to bypass this rule unless the user explicitly approves that cost.
   - Any deferred DB-dependent change must be recorded in `docs/pending-fix-ledger.md`.

6. **Safety changes**
   - Any change that weakens or removes these locks must be handled as a dedicated safety change and must not be bundled into ordinary feature work.

## Current incident status

The deployment-credit incident is **not considered resolved** until Netlify restores access/credits or the normal billing cycle resets. These safeguards prevent recurrence; they do not themselves restore consumed credits.
