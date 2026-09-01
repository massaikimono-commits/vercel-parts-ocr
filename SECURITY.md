# Security baseline

This repository is an internal business application. Do not commit secrets, private keys, service-role keys, database passwords, or customer exports.

## Required application controls

- Browser code may use only the Supabase publishable key.
- Protected routes must require a valid Supabase session and an active `app_user_profiles` record.
- Temporary vehicle context belongs in `sessionStorage`, not persistent `localStorage`.
- Sensitive app routes must keep `Cache-Control: no-store`.
- Uploaded OCR inputs must pass file signature and resource-limit validation before parsing.
- Spreadsheet exports must neutralize formula injection.
- Runtime PDF worker code must be bundled from the locked `pdfjs-dist` dependency, not loaded from a third-party CDN.
- Runtime Tesseract assets must be same-origin and version-matched to the locked OCR dependencies.

## Required database controls

- Every application table in `public` must have RLS enabled.
- `anon` must not have direct DML access to public application tables.
- The Data API pre-request hook must enforce an active app user for authenticated requests.
- Anonymous SECURITY DEFINER access is limited to the explicitly approved customer booking token functions.
- SECURITY DEFINER functions must use a fixed search path; use an empty path with schema-qualified objects or place `pg_temp` last.
- Public views exposed to authenticated users must use `security_invoker=true`.
- The `documents` Storage bucket must remain private and restricted by RLS.
- New tables/functions should fail closed and require explicit grants/policies.

## Recovery controls

- Row-level recovery snapshots for critical business tables must remain private and retained for 180 days.
- Row-level snapshots do not replace an independent database/Storage backup.
- Follow `RECOVERY.md` for recovery order.

## Dependency and CI controls

- Keep `package-lock.json` committed.
- CI must install with `npm ci`.
- CI must run `npm audit --omit=dev --audit-level=high`.
- High or critical production dependency vulnerabilities block the build.
- GitHub Actions should remain pinned to reviewed commit SHAs.
- Dependabot may open updates, but dependency updates are not auto-merged.

## Deployment

Production verification target is Netlify `icb-vehicle-app`. A successful Vercel preview is not evidence of production deployment.

Before merging a security-sensitive batch:
1. Run the full regression suite.
2. Confirm the Next.js production build succeeds.
3. Confirm dependency audit passes.
4. Confirm Netlify production deployment after merge to the production branch.
