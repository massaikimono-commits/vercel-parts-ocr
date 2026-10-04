# Current ICB source of truth — 2026-10-05 snapshot

## Git state

- **Current main:** `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`, equal to the remote `origin/main` value verified by read-only `git ls-remote` during this handoff. Original workspace is clean on `main`.
- **Current active app continuation:** Draft PR #93, `candidate/icb-continuation-20261003`, head `74ac541a061890f73553a2e8887cb1f72a8eb9ad`, based/stacked on Draft PR #92 at `8b38adba491020cc58a5f8b0af1e8349c145d396`.
- **Separate current candidates:** Delivery UX #86 at `5870d868…`; Certificate PDF #87 at `5ca65e7…`; Vercel security artifact fix branch #13c32f5 has no PR/merge evidence.
- **Latest commit in this candidate before handoff-ledger authoring:** `74ac541` (evidence-only). The ledger documentation commit itself will be recorded in the final run report; this snapshot does not pretend to contain its own hash.
- **Remote ahead/behind:** main has not moved from `f00bd12`; #86 29 ahead; #92 1 ahead; #93 6 ahead; #87 12 ahead / 6 behind; Vercel artifact fix 30 ahead. `main-only / branch-only` ordering and merge bases are in `BRANCH_MAP.md`.

## Adopted vs unadopted

**Adopted/source on main:** PR #77's Certificate PDF Native v3 primary boundary (as documented by merged PR and OCR ledger); PR #90 dependency recovery (Next 16.3.6, DOMPurify 3.4.16, fast-uri 3.1.8, patched security assertion); all prior source already in main at `f00bd12`. “Adopted” here means merged/source baseline, not proof of Production deployment.

**Unadopted candidates:** #86 Delivery Time UX; #87 later Certificate PDF async/generic recovery; #92 app-core responsive/navigation batch; #93 app-core continuation; `13c32f5` Vercel `.gitignore` artifact fallback. PRs remain open, except the security fallback has no PR record. Specialist #75/#76/#78/#70/#71 are secondary open drafts and not replacements for #87.

## Current implementation

Candidate #92/#93 already contains the application fixes documented in its committed audit/readme, including customer/vehicle search and recovery, schedule/date/navigation/edit/cancel guards, work status serialization, waiting-service state constraints, duplicate-submit defenses, loaner/workload recovery, settings retry/validation, error-vs-empty states, responsive coverage, and route smoke coverage. This handoff run rechecked them with the existing build and fixture browser suite. It added no application code.

Core source requirements remain separated from pending adoption: schedule lookup behavior in current accepted instructions is last-4-only, while customer/vehicle lookup supports last4/name/phone; current waiting-service contract is reason-independent within `customer_visit`. Mainline app ledgers are older than latest user-level clarifications, so the latest accepted contract and candidate regressions are also included in the evidence basis.

## Current tests and deployments

- Candidate local `npm run build`: PASS in the 2026-10-05 run; it executes the full registered source regression chain and optimized Next build using fixture public env values.
- Candidate local fixture browser suite: PASS, 64 checks / 29 actual routes / 390, 768, 1440 / zero page errors / no shared DB traffic.
- Candidate #93 remote `deployment-safety`: SUCCESS on `74ac541` (`37214128104`).
- Candidate #93 remote Cloudflare Workers build: SUCCESS on `74ac541`; build `4fe00640-0091-4e96-b57e-6e1ef70332e1`; Preview alias `https://candidate-icb-continuation-20261003-vercel-parts-ocr.massa-ikimono.workers.dev`.
- Candidate Full Regression: previous source-identical head `3cfbcd9` failed at npm audit before app tests (`37166468471`). No new Full Regression was dispatched on `74ac541` because the commit only adds evidence. Vercel one-shot Preview remains skipped by the security-gated chain.
- PR #92 exact base check: on `8b38adb`, Full Regression `37081957317`, Deployment Safety `37081959446`, OCR regression jobs `37081915194`, Vercel status and Workers build `f75b8310-dd0b-4c60-b12c-1f3f65fe4de7` all succeeded. These checks validate #92, not its later #93 descendant.
- #86: 52/52 reported regressions, GitHub Full Regression + deployment guard + Vercel status + Workers build succeeded on exact `5870d86`.
- #87: aggregate Full Regression and Preview checks succeeded on `5ca65e7`; its separate `vehicle-certificate-regression` job failed at npm audit for older DOMPurify/fast-uri/Next findings due its lagging dependency branch. Do not summarize this as either “all PDF checks pass” or “PDF runtime failed.”

## Current security gate

PR #90 closed the earlier Next/DOMPurify/fast-uri advisories on main. A later advisory `GHSA-vfj7-8cjw-p6xm` affects `braces <=3.0.3`. On candidate #93 `npm audit --omit=dev --audit-level=high` reports seven High transitive findings through `@vinext/cloudflare → vinext → Vite plugins → fast-glob → micromatch → braces`. Registry latest checked was `braces@3.0.3`, still affected; npm proposes semver-major Vinext `0.0.15`. Runtime reachability is not established; package metadata means production audit sees it. No ignore, suppression, threshold weakening or forced downgrade was applied. **Current app CI status is `DEPENDENCY_BLOCKED / SECURITY_GATE_HOLD`.**

## Current database state

- **Actual live Supabase state:** `UNKNOWN` as of this handoff; no live DB connection/query was made.
- **Last tracked app-state record:** `docs/shared-project-state.md` / `docs/app-development-ledger.md`, last updated 2026-09-07, documents shared DB functions/constraints then believed live, and labels UI/deployment state separately. This is a historical repo record, not a fresh remote DB measurement.
- **Current candidate safety:** no migration/apply or DB mutation occurred. Delivery UX label-persistence SQL is candidate-only and PR #86 explicitly preserves DB HOLD. `legal_3m` remains pending in `docs/pending-fix-ledger.md`. Multi-RPC schedule edit/active registration transactionality is not provided by the current source-only safeguards.

## Current previews and user acceptance

- Latest #93 Preview is the candidate Cloudflare alias above; it is non-production and its Worker build passed. The same alias had a prior version before `74ac541`.
- Latest Vercel chained Preview for #93: not created because the Full Regression security gate stopped first. Existing Vercel Preview statuses on #86/#87/13c are historical candidate-specific checks, not #93 acceptance.
- Authenticated live-backend acceptance, iPhone/iPad/Safari, actual PDF/camera/QR data and physical A4/A3 printer acceptance remain unverified.
- Production deployment/live mapping and current user-facing production revision were not independently measured during this ledger run. Nothing here declares a candidate Preview to be Production.

## Readiness counts (unique actionable items, not number of route/tests)

| Class | Count | Basis |
|---|---:|---|
| CODEX_READY | 0 | No safe, unimplemented source defect is evidenced after candidate coverage and tests. |
| CHATGPT_READY | 0 | No additional analysis task is evidenced apart from review/adoption decisions below. |
| HUMAN_REQUIRED | 5 primary candidate dispositions | PR #86, #87, #92, #93 plus the `13c` no-PR artifact fix require management disposition. Main/Production authorization remains its normal separate gate. |
| DEVICE_REQUIRED | 3 | authenticated live use; iPhone/iPad/Safari; physical print acceptance. |
| DB_HOLD | 3 | Delivery persistence/custom-time contract; `legal_3m`; atomic multi-RPC write contract. |
| DEPENDENCY_BLOCKED | 2 branches | #93 `braces` path; #87 stale DOMPurify/fast-uri/Next dependency state on its current head. |
| ADOPTION_REVIEW | 5 candidate records | #86, #87, #92/#93 stacked pair, and standalone `13c` artifact fix. |

**Overall Codex status for new app implementation: `ICB CODEX IDLE`.** Documentation handoff work is complete; no product implementation is selected by this ledger.
