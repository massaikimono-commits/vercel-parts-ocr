# Deployment Safety Policy

This repository must fail closed: normal development commits must not automatically create Netlify or Vercel deployments.

## Permanent safety rules

1. **Netlify**
   - Normal commits must be skipped.
   - A Netlify deployment is allowed only when the release commit explicitly contains `[deploy netlify]`.
   - Never add the marker to routine development, refactor, test, merge, or documentation commits.

2. **Vercel**
   - Git-triggered deployments must remain disabled with `git.deploymentEnabled=false`.
   - Vercel deployment is manual/explicit only.

3. **GitHub Actions**
   - Workflows must not contain direct `netlify deploy`, `vercel deploy`, `vercel --prod`, or `npx vercel` commands.
   - The deployment safety workflow checks these rules on every pull request and every push to `main`.

4. **Release process**
   - Batch fixes first.
   - Run regression tests and production build before any release.
   - Do not deploy simply because code changed.
   - Create at most the explicitly approved deployment for the current test/release batch.
   - Netlify production release requires explicit user approval before using the release marker.

5. **Safety changes**
   - Any change that weakens or removes these locks must be handled as a dedicated safety change and must not be bundled into ordinary feature work.

## Current incident status

The deployment-credit incident is **not considered resolved** until Netlify restores access/credits or the normal billing cycle resets. These safeguards prevent recurrence; they do not themselves restore consumed credits.
