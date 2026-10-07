# Latest private Netlify preview

Source main at creation: `3ace48cc74286ae9eddb0195099bf34156dd42c6`

Purpose:
- Run one Netlify Deploy Preview from the latest application source.
- Keep Production skipped.
- Use as a temporary operational preview only after runtime privacy verification.

Security pre-check completed before triggering:
- App route guard requires an active icb/Supabase session for all internal routes.
- Session lifetime: 30 minute idle timeout, 12 hour absolute timeout.
- Browser client uses the Supabase publishable key only.
- Core customer/vehicle/schedule/loaner tables have RLS enabled.
- anon has no SELECT/INSERT/UPDATE/DELETE privilege on the checked core tables.
- Sensitive app routes and root have Cache-Control: no-store.
- Netlify security headers include DENY framing, nosniff, no-referrer, noindex, HSTS, Permissions-Policy, COOP and CSP.
- Netlify Production builds require the separate marker `[deploy netlify production]`; this preview trigger does not contain it.

Runtime rule:
- Do not treat this preview as approved for real customer data until the generated Deploy Preview is confirmed to show the Netlify Private gate before the icb login.
- Keep Deploy Preview visibility Private.
- Do not share the preview URL or Netlify/GitHub credentials externally.
