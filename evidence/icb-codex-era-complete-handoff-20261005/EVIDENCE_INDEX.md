# Evidence index and provenance

## Git / remote / worktrees

- Current original workspace startup state: `git status --short --branch`, current branch, `git rev-parse HEAD`, remote URL, local/remote branch refs and `git worktree list`; captured at beginning of this handoff. Original checkout: clean `main`, `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`.
- Remote heads read with `git ls-remote`: `main=f00bd12`, Delivery #86=`5870d86`, PDF #87=`5ca65e7`, app #92=`8b38adb`, current #93=`74ac541`, Vercel artifact fix=`13c32f5`.
- Branch ancestry/counts: `git merge-base`, `git rev-list --left-right --count`, `git diff --shortstat` recorded in `BRANCH_MAP.md`.
- Operational migration-boundary evidence: local reflog clone entry `2026-10-02T01:17:45+09:00`; subsequent worktree reflog entries for Delivery, Preview artifact fix, and Certificate PDF candidate. Reflog does not prove model/chat session start.
- Relevant prior commit sequence on #93: `8b38adb → e99d523 → 4578802 → 20cb095 → 4020b54 → 3cfbcd9 → 74ac541`.

## Tracked project docs and tests

- `docs/shared-project-state.md` — last updated 2026-09-07; dated history of app/database/deployment state. Not a fresh DB check.
- `docs/app-development-ledger.md` — last updated 2026-09-07; app, schedule, print, loaner, lease and DB contracts.
- `docs/pending-fix-ledger.md` — `legal_3m` remains pending; historical waiting items distinguished from current override.
- `docs/ocr-test-ledger.md` — existing vehicle-certificate and parts-slip architectures, boundaries, fixtures and regression inventory; source/main baseline, not evidence of device acceptance.
- `scripts/security-regression.mjs`, `scripts/security-artifact-regression.mjs`, `scripts/schedule-time-selection-contract-regression.mjs`, schedule/customer/loaner/workload regressions — implementation/test contracts cited by branch histories.
- No standalone full ICB-SPEC v1.3/v1.4 file found in audited repo paths; current audit basis is explicitly limited in `CURRENT_STATE.md`.

## Committed candidate evidence

- `evidence/icb-overnight-20261003/summary.json` and `README.md` — #92 start at main, 50-stage regression/build, fixture/route/viewport evidence, DB/device/spec holds.
- `evidence/icb-continuation-20261003/summary.json` — follow-on implementation classifications, holds and candidate relationships.
- `evidence/icb-phase3-20261003/summary.json` — intermediate #93 checkpoint: 11 actual-function tests, 53-stage build/regression, 44 fixture checks; security hold.
- `evidence/icb-night-20261004/summary.json`, `README.md`, `current-implementation-audit.json`, `dependency-audit.json`, `advisory.json`, `checkpoint-ci.json`, `checkpoint-cloudflare-preview.json`, `browser-results.json` — latest pre-ledger candidate source/evidence checkpoint; 19 actual-source checks, 54 regression/build stages, optimized build, 64 browser checks, dependency gate hold and Preview details.
- `evidence/icb-overnight-20261005/` — prior latest run evidence commit `74ac541`: start state, current implementation audit, security triage, npm audit JSON, failed CI log, build output, 64-check browser JSON, 29 route screenshots and final summary.
- These evidence paths are in candidate branch #93, not current main at `f00bd12`.

## Pull requests and check records

| Item | Verified record | Interpretation |
|---|---|---|
| PR #90 | merged 2026-10-01; main merge `f00bd12`; deployment safety/full regression/OCR/Workers checks SUCCESS | Separate security fixes adopted on main. |
| PR #86 | open, non-draft, head `5870d86`; checks `36801304322` (safety), `36801336815` (full regression) SUCCESS; Vercel status SUCCESS; Workers build SUCCESS | Candidate, not merged; DB and device gates remain. |
| PR #87 | open Draft, head `5ca65e7`; PDF/generalization/deployment checks, aggregate Full Regression `36970514308`, Vercel and Workers preview SUCCESS; OCR job `36970481721` vehicle-cert job fails at dependency audit | Multiple checks must be reported independently; current branch is behind main. |
| Vercel artifact fix | commit `13c32f5`; Vercel and Workers checks SUCCESS; Workers build `256327d1-d961-4254-bebc-f895417e25e0` | Isolated fix; no PR/merge found. |
| PR #92 | open Draft, head `8b38adb`, base main; Full Regression `37081957317`, Deployment Safety `37081959446`, OCR jobs `37081915194`, Vercel status and Workers build `f75b8310-dd0b-4c60-b12c-1f3f65fe4de7` SUCCESS | App-core predecessor; exact-head tests and Preview succeeded, but no adoption/merge. |
| PR #93 | open Draft, base #92, head `74ac541`; run `37166468471` Full Regression failed at npm audit on `3cfbcd9`; head `74ac541` safety `37214128104` SUCCESS; Cloudflare build `4fe00640-0091-4e96-b57e-6e1ef70332e1` SUCCESS | Latest app source locally passes; remote security-gated full app suite did not execute. Evidence-only commit was not given a duplicate Full Regression dispatch. |

## Preview records (candidate-only)

- #86 Workers Preview alias: `https://candidate-delivery-time-ux-acceptance-rev-d9c7-vercel-parts-ocr.massa-ikimono.workers.dev`; Vercel status success recorded for its own candidate SHA.
- #87 current `5ca65e7` Workers Preview: `https://candidate-certificate-pdf-current-main-in-0f6e-vercel-parts-ocr.massa-ikimono.workers.dev`. PR body also contains an older d3 Vercel URL; it is historical.
- #13c artifact-fix Workers Preview alias: `https://fix-vercel-security-regression-gitignore--08e9-vercel-parts-ocr.massa-ikimono.workers.dev`.
- #93 current `74ac541` Workers Preview alias: `https://candidate-icb-continuation-20261003-vercel-parts-ocr.massa-ikimono.workers.dev`; unique build `4fe00640-0091-4e96-b57e-6e1ef70332e1` SUCCESS. Vercel one-shot for #93 is skipped while Full Regression is gated.
- A Preview URL/green build never establishes user/device acceptance or Production adoption.

## Security / failure provenance

- PR #90 body and checks record its intended Next/DOMPurify/fast-uri remediation and green audit/regression on that commit.
- `evidence/icb-night-20261004/dependency-audit.json`, `advisory.json`, `security-triage.json` and `checkpoint-ci.json` establish the later #93 `braces` chain and gate failure at run `37166468471`.
- `/private/tmp/icb-codex-pdf-fail.log` captured read-only from run `36970481721`; summary shows #87 certificate subjob stopped at npm audit (older DOMPurify, fast-uri, Next critical advisory), not an OCR assertion failure.
- Commit diff `13c32f5` documents `.gitignore` omission workaround and regression artifact. Its Vercel status success makes the reported issue resolved on that branch only.

## Limitations in provenance

- Chat-only real customer documents/images were not copied to repo; real fixture existence is not assumed.
- Actual shared Supabase revision and current Production deployment revision were not queried.
- Runtime reachability of `braces` in the application request path has not been demonstrated or disproved.
- Open Draft PR state does not establish management's intended merge order or adoption.
