# Delivery time preset group boundary

- Scope: PR #86 only. No Certificate PDF, OCR, Parts OCR, DB, #92/#93, Production, or main changes.
- Start: `candidate/delivery-time-ux-acceptance-revision-20260929` at `5870d86846a961ae2f9dccae993740b728df59d9`.
- Remote check before editing: candidate HEAD matched; `main` was `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`; PR #86 was OPEN and not merged.
- Root cause: the single compact afternoon 3-column grid had no visual boundary between the `まで` and `以降` choices.
- Change: added a 2px vertical divider immediately before the first `以降` preset. It is a render-only wrapper; preset order, 3-column grid, labels, selected styling, `aria-pressed`, custom range, and persistence semantics remain unchanged.
- Focused checks: `npm run test:schedule-time-selection`, `npm run test:delivery-time-ux`, and `npm run test:delivery-time-db-contract` all PASS. Contract checks retain `14時まで`/`15時まで`/`16時まで`/`17時まで`, `15時以降`/`16時以降`/`17時以降`, no `13時まで`, three columns, selected and unselected styles, `aria-pressed`, custom range and morning-to-afternoon spacing.
- Full regression/build: `npm run build` PASS, including all registered regression scripts and optimized Next build. A first attempt without public Supabase build-time variables stopped during prerender; rerun with dummy public values completed successfully. No live DB was contacted.
- Browser check: local `/schedule/new` redirected to the login screen; this environment had no authenticated test session, so the actual picker was not visually inspected in browser. No auth bypass or real backend access was attempted. Preview and iPhone final visual acceptance remain pending post-push CI/Preview and human review.
- Dependency installation noted 8 High and 3 Moderate advisories; no dependency files were changed and the existing security gate was not altered.
- This evidence file is expected to be updated after the candidate push with commit, CI, and Preview outcomes.
