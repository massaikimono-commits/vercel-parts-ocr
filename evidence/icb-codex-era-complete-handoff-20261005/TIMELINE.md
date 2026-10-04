# Codex-era timeline and checkpoint ledger

Dates/times are Asia/Tokyo when a Git timestamp is cited. A date without a recorded start/end SHA is explicitly not reconstructed. Branch facts and statuses were checked against the current Git graph/PR records on 2026-10-05.

## 2026-09-18 — `legal_3m` parent-spec preparation (pre operational boundary)

- **DATE / TASK / PURPOSE:** Add a `legal_3m` parent-spec contract and prepare migration/apply safety.
- **START_BRANCH / START_HEAD:** UNKNOWN from currently available direct local reflog.
- **END_BRANCH / END_HEAD:** `candidate/legal-3m-parent-spec-resume-20260917` / `c78d3a1` (remote branch).
- **FILES_CHANGED / IMPLEMENTATION:** migration preparation, parent-spec regression and pre-apply validation; not evidence of shared DB apply.
- **TESTS / REGRESSION / BUILD:** migration validation source exists; exact completed run/build result UNKNOWN.
- **CI / PREVIEW:** UNKNOWN.
- **COMMIT / PUSH:** `98afaa2`, `4d54e76`, `7dfba2b`, `c78d3a1` are in candidate branch history; remote ref exists. PR number/merge is UNKNOWN (no matching current open/merged PR surfaced).
- **EVIDENCE:** `docs/pending-fix-ledger.md` #001 and branch history.
- **RESULT / ADOPTION_STATUS:** Candidate preparation only; `DB_HOLD`, not applied/adopted.
- **BLOCKER / HUMAN_ACTION:** shared DB `inspection_schedule_type` constraint and release compatibility required.
- **NEXT_ACTION:** management/DB-approved migration lifecycle; no inference that it is live.

## 2026-09-19 — Certificate PDF Native v3 primary adoption (pre operational boundary)

- **DATE / TASK / PURPOSE:** Validate and adopt the Native v3 primary boundary for vehicle-certificate PDF input.
- **START_BRANCH / START_HEAD:** predecessor candidate details not exhaustively reconstructed; UNKNOWN.
- **END_BRANCH / END_HEAD:** `adopt/certificate-pdf-v3-primary-20260919` / `bda9a6b`.
- **FILES_CHANGED / IMPLEMENTATION:** v3 primary PDF recognition/input boundary adoption, recorded as PR #77.
- **TESTS / REGRESSION / BUILD:** PR #77 is MERGED; exact counts are UNKNOWN in currently consulted evidence.
- **CI / PREVIEW:** exact PR #77 checks/preview URL UNKNOWN in this reconciliation.
- **COMMIT / PUSH:** PR #77 merged 2026-09-19 06:19:23Z; merge/adopt commit begins `bda9a6b`.
- **EVIDENCE:** GitHub PR #77; `docs/ocr-test-ledger.md` active certificate architecture summary.
- **RESULT / ADOPTION_STATUS:** Adopted mainline architecture boundary. This does not adopt later PDF generalization experiments.
- **BLOCKER / HUMAN_ACTION:** later real-device PDF/camera practical acceptance remains a separate gate.
- **NEXT_ACTION:** preserve the Native v3 primary baseline while evaluating later isolated candidates.

## 2026-09-28 to 2026-10-01 — Delivery Time UX candidate series (inherited predecessor)

- **DATE / TASK / PURPOSE:** Normalize pickup/delivery time options, label semantics and compact three-column visual acceptance.
- **START_BRANCH / START_HEAD:** `candidate/delivery-time-ux-20260928` / `8285d9f` (branch head before final acceptance sequence).
- **END_BRANCH / END_HEAD:** `candidate/delivery-time-ux-acceptance-revision-20260929` / `5870d86846a961ae2f9dccae993740b728df59d9`.
- **FILES_CHANGED / IMPLEMENTATION:** 26 files vs main at current tip (1,341 insertions / 102 deletions); delivery label state/preset UX, custom-range work, RPC/migration candidate, persistence/display tests, then a 3-column visual CSS regression. Intermediate commits include `d5322fa`, `f7b6e7e`, `44bdcf4`, `ce5f6dc`, `799a1c2`, `8500233`, `7896912`, `3998d3a`, `31a8b73`, `6cd7617`, `92db2ae`, `5870d86`.
- **TESTS / REGRESSION / BUILD:** The known acceptance record says 52/52 regression stages PASS; PR #86 Full Regression run `36801336815` SUCCESS.
- **CI:** deployment safety run `36801304322` SUCCESS; Full Regression `36801336815` SUCCESS; Workers build succeeded.
- **PREVIEW:** Vercel status SUCCESS for exact #86 head, with candidate Workers Preview alias `candidate-delivery-time-ux-acceptance-rev-d9c7-vercel-parts-ocr.massa-ikimono.workers.dev`.
- **COMMIT / PUSH:** remote branch and open PR #86 verified; PR remains OPEN and is not merged.
- **EVIDENCE:** PR #86 body/status checks; branch source/tests; Delivery UX docs/contract regressions.
- **RESULT / ADOPTION_STATUS:** Visually/test-validated candidate, not adopted to main. The candidate SQL/RPC does not prove DB apply.
- **BLOCKER / HUMAN_ACTION:** DB-required persistence contract and user iPhone visual re-acceptance; main/merge hold.
- **NEXT_ACTION:** management review plus separately approved DB lifecycle and exact-head real-device acceptance.

## 2026-10-01 — Main security dependency recovery, PR #90

- **DATE / TASK / PURPOSE:** Resolve the production dependency advisories known at that time without changing app behavior.
- **START_BRANCH / START_HEAD:** `infra/dependency-security-recovery-20261001` (head `faa5ab33cf34bba874e9f1fb41da39c7a7dd6ace`); exact PR base was main before merge.
- **END_BRANCH / END_HEAD:** `main` / merge `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`.
- **FILES_CHANGED / IMPLEMENTATION:** `package.json`, `package-lock.json`, `scripts/security-regression.mjs`; Next 16.3.6 and transitive DOMPurify 3.4.16 / fast-uri 3.1.8, plus patched-version floor assertion.
- **TESTS / REGRESSION / BUILD:** Full Regression succeeded (`36788396680`, and post-merge `36797341768`); certificate and Parts OCR regression checks succeeded (`36788337934`).
- **CI:** deployment safety success; full regression success; OCR regression success; Workers build success.
- **PREVIEW:** Workers build/check succeeded; exact user-acceptance Preview URL not required for this handoff.
- **COMMIT / PUSH:** PR #90 merged 2026-10-01 00:40:29Z; merge `f00bd12` is current main.
- **EVIDENCE:** PR #90 body/check rollup; main ancestry; package/lockfile.
- **RESULT / ADOPTION_STATUS:** Adopted on main for its advisories. It did not fix the subsequently reported `braces` advisory path.
- **BLOCKER / HUMAN_ACTION:** later advisories must be triaged separately; never infer that a past green audit remains current.
- **NEXT_ACTION:** evaluate each new advisory against current package graph and CI gate.

## 2026-10-02 01:17 to 02:31 — Mac Terminal local source boundary and Vercel `.gitignore` artifact fix

- **DATE / TASK / PURPOSE:** Establish isolated local repo/worktrees and fix a security-test failure caused by Vercel source artifact omissions.
- **START_BRANCH / START_HEAD:** local clone starts on `main` / `f00bd12` at reflog `2026-10-02T01:17:45+09:00`; Delivery worktree appears at `5870d86` 02:09; Preview/security-fix worktree appears at `13c32f5` 02:38.
- **END_BRANCH / END_HEAD:** `fix/vercel-security-regression-gitignore-20261002` / `13c32f5862a464a389926b5539ac5bf4aee96b09`.
- **FILES_CHANGED / IMPLEMENTATION:** `scripts/security-regression.mjs`, new `scripts/security-gitignore-policy.txt`, new `scripts/security-artifact-regression.mjs`. Vercel source upload excludes `.gitignore`; under `VERCEL=1`, regression reads a tracked exact policy copy; normal repo still reads `.gitignore` and asserts policy equality.
- **TESTS / REGRESSION / BUILD:** a targeted artifact regression script was added; specific CI execution record for that script is UNKNOWN. The Vercel check on `13c32f5` is SUCCESS.
- **CI:** commit check shows Vercel SUCCESS and Workers build SUCCESS (build `256327d1-d961-4254-bebc-f895417e25e0`). No PR was found for this branch.
- **PREVIEW:** Workers Preview URL `https://a10a75f9-3fc0-4f09-a13a-a4567a61c819-vercel-parts-ocr.massa-ikimono.workers.dev`; alias `https://fix-vercel-security-regression-gitignore--08e9-vercel-parts-ocr.massa-ikimono.workers.dev`; Vercel status succeeded.
- **COMMIT / PUSH:** `13c32f5` exists as remote branch head; no PR/promotion found.
- **EVIDENCE:** commit diff, tracked artifact policy/test, Vercel status, Preview check output.
- **RESULT / ADOPTION_STATUS:** The reported ENOENT was an artifact/environment assumption defect in the security regression path, not an app runtime defect. Fixed and verified on this isolated branch; main/#86/#87/#93 adoption is unproven.
- **BLOCKER / HUMAN_ACTION:** branch adoption/PR disposition is outstanding.
- **NEXT_ACTION:** management decides whether to include this isolated test-environment fix in the appropriate security/infra candidate.

## 2026-09-30 to 2026-10-02 — Certificate PDF current-main integration candidate

- **DATE / TASK / PURPOSE:** Protect per-document async run ownership, prevent stale OCR writers, reset document state, recover generic structural rows and expose selected form results for acceptance.
- **START_BRANCH / START_HEAD:** latest supplied named checkpoint `d3b925685786c8ae68a93f0f90e28d25266b93b5` on `candidate/certificate-pdf-current-main-integration-20260929`; earlier commits include `ea4f646`, `884e213`, `b574007`, `9ae6aed`, `bcaa00b`, `d9f2ff8`, `ae3c077`, `b5464e2`, `87f41de`, `7007a4c`.
- **END_BRANCH / END_HEAD:** same candidate / `5ca65e71312b1b352d1b042e8bc95715acb9c8e1` (latest remote and PR #87 head; commit `feat: copy current certificate form results for acceptance`).
- **BASE / DIVERGENCE:** merge base `776fc6288e8169466463729308dfe2cf41ab9113`; current branch is 12 commits ahead and 6 behind main. This branch is separate from Delivery UX and #92/#93.
- **FILES_CHANGED / IMPLEMENTATION:** current cumulative diff is 30 files (1,242 insertions / 111 deletions) against current main; PDF run isolation, one document owner, reset on document select, structural PDF row semantics, weak-fallback field retention and acceptance display.
- **TESTS / REGRESSION / BUILD:** At earlier exact head `d3b9256`, PR #87 records Full Regression `36800165640` SUCCESS, Certificate PDF Generalization `36800097765` SUCCESS and Deployment Safety `36800097821` SUCCESS. At later exact head `5ca65e7`, Full Regression `36970514308` SUCCESS and PDF/generalization/deployment checks succeeded.
- **FAILURE / RETRY:** At `5ca65e7`, separate OCR workflow run `36970481721` had `vehicle-certificate-regression` FAIL before its OCR assertions because `npm audit --omit=dev --audit-level=high` found older DOMPurify 3.4.13–3.4.15, fast-uri and a critical Next 16.2.0–16.3.5 advisory (force fix proposed Next 16.3.8). Its Parts job was skipped. This is a stale dependency/security gate on the branch, not evidence of an OCR algorithm assertion failure. Aggregate Full Regression and Preview checks were nevertheless green on that exact head.
- **PREVIEW:** Vercel status SUCCESS on #87 current head; Workers build `bccdec28-f418-490c-a273-664748f1663a`, URL `https://fb9c731f-vercel-parts-ocr.massa-ikimono.workers.dev`, alias `candidate-certificate-pdf-current-main-in-0f6e-vercel-parts-ocr.massa-ikimono.workers.dev`. PR body has an older d3 Vercel URL; treat it as historical, not current.
- **COMMIT / PUSH:** remote #87 branch head `5ca65e7`, PR #87 OPEN Draft; no merge.
- **EVIDENCE:** PR #87 current body/check rollup; `d3b9256` and `5ca65e7` commit history; workflow run `36970481721` failure log.
- **RESULT / ADOPTION_STATUS:** Candidate, not adopted. Native v3 *primary boundary* is separately adopted by PR #77; this async/generalization batch is not.
- **BLOCKER / HUMAN_ACTION:** main dependency synchronization/security gate; genuine iPhone/PDF/camera acceptance remains required; no OCR accuracy adoption claimed.
- **NEXT_ACTION:** management/specialist review and candidate-only dependency reconciliation before any adoption; keep this branch separate.

## 2026-10-03 — App-core overnight PR #92

- **DATE / TASK / PURPOSE:** Harden schedule navigation and operational responsive UX after current implementation audit.
- **START_BRANCH / START_HEAD:** main `f00bd12`.
- **END_BRANCH / END_HEAD:** `candidate/icb-app-overnight-20261003` / `8b38adba491020cc58a5f8b0af1e8349c145d396`.
- **FILES_CHANGED / IMPLEMENTATION:** 46-file candidate diff from main, 4,189 insertions / 210 deletions. Search/detail/back recovery, repeat-submit/stale-response defenses, date navigation, loading/error/404 paths and mobile/tablet/desktop work. Prior evidence describes the implementation; do not replay it.
- **TESTS / REGRESSION / BUILD:** committed `evidence/icb-overnight-20261003/summary.json` records 50 regression stages, full build PASS, fixture browser PASS, 28 extra route smoke checks, 390/768/1440 viewports. An inherited standalone vehicle-search/registration-separation assertion was recorded failing in that run; later continuation explicitly reclassified the blanket assertion as stale because a conditional history dock is valid and added a targeted separation regression. Do not treat it as an unresolved app regression after that follow-up.
- **CI / PREVIEW:** initial evidence records CI and Preview pending exact candidate push; after push, GitHub Full Regression `37081957317`, Deployment Safety `37081959446`, OCR routing `37081915194` (including vehicle-certificate and parts jobs), Vercel status and Workers build `f75b8310-dd0b-4c60-b12c-1f3f65fe4de7` all succeeded on exact `8b38adb`. Preview alias: `candidate-icb-app-overnight-20261003-vercel-parts-ocr.massa-ikimono.workers.dev`. PR #92 remains open Draft.
- **COMMIT / PUSH:** `8b38adb`; remote branch and PR #92 verified.
- **EVIDENCE:** `evidence/icb-overnight-20261003/` in candidate tree; PR #92.
- **RESULT / ADOPTION_STATUS:** Implemented and CI/Preview-validated candidate, not merged. Later #93 continues from this exact tested base.
- **BLOCKER / HUMAN_ACTION:** formal full parent spec absent from repo; DB and authenticated/device acceptance remain separate.
- **NEXT_ACTION:** reuse source; do not redo the 46-file batch.

## 2026-10-03 — App-core continuation begins; query/settings recovery (`e99d523`)

- **DATE / TASK / PURPOSE:** Continue from #92, classify existing work first, fix actual error/empty, stale-state and duplicate-write defects.
- **START_BRANCH / START_HEAD:** #92 / `8b38adb`.
- **END_BRANCH / END_HEAD:** `candidate/icb-continuation-20261003` / `e99d5235544d0dc6bb2d763af093294e1aa3170a`.
- **FILES_CHANGED / IMPLEMENTATION:** customer search error vs empty/retry/accessibility, history/photos/lease query failures, customer-link save duplicate/old-selection guards, settings staff/vendor error recovery/duplicate and blank-name validation; an obsolete broad source assertion was corrected to match conditional history behavior.
- **TESTS / REGRESSION / BUILD:** subsequent Phase 3 evidence counts 11 actual-function checks and 53 regression/build stages, build PASS, 44 fixture-browser checks at 390/768/1440.
- **CI / PREVIEW:** still blocked/pending on the same dependency audit; no bypass.
- **COMMIT / PUSH:** `e99d523`; remote continuation branch.
- **EVIDENCE:** `evidence/icb-continuation-20261003/summary.json`, `evidence/icb-phase3-20261003/summary.json`.
- **RESULT / ADOPTION_STATUS:** source remediation candidate, not merged.
- **BLOCKER / HUMAN_ACTION:** DB-required delivery/custom-time and `legal_3m`; full v1.3/v1.4 spec missing; real-device acceptance.
- **NEXT_ACTION:** continue independent schedule/vehicle and operational flows.

## 2026-10-03 to 2026-10-04 — Schedule/vehicle race recovery and daily operations (`4578802`, `20cb095`)

- **DATE / TASK / PURPOSE:** Prevent loss/repeat writes in schedule edits/registration, waiting-state mutation and daily/weekly loaner/workload operations.
- **START_BRANCH / START_HEAD:** continuation branch / `e99d523`.
- **END_BRANCH / END_HEAD:** continuation branch / `20cb095544bbb829367ee872c798af99dafadf6d`.
- **INTERMEDIATE_HEADS:** `4578802eeead79e2d107707515238ead991a3b87` (“preserve state and recover concurrent calendar and vehicle actions”) then `20cb095` (“harden schedule mutations and loaner workload recovery”).
- **FILES_CHANGED / IMPLEMENTATION:** schedule lookup contract fixed to latest explicit last-4-only rule; edit state/query ownership, partial-read isolation, waiting-service payload, option race and save/cancel serialization, uncertain-save reread; active vehicle duplicate/partial-write stop; work-state serialization/date refresh; loaner daily/weekly validation, URL sync, stale reads, errors/retry, mutation guards; workload complete reads, assignment duplicate protection and URL filters.
- **TESTS / REGRESSION / BUILD:** `evidence/icb-night-20261004/summary.json` records 19 actual-source focused checks, 54 regression/build stages, optimized Next build PASS, 64 fixture-browser checks, zero page errors, 3 viewports. Earlier same branch checkpoint records 11/53/44; those counts are successive checkpoints, not contradictory results for one run.
- **CI / PREVIEW:** CI on `20cb095` failed at `npm audit --omit=dev --audit-level=high` before application tests. Deployment safety and OCR routing succeeded; Vercel one-shot Preview skipped. Workers Git integration generated an automatic candidate Preview at checkpoint SHA; fixture preview is not device acceptance.
- **COMMIT / PUSH:** `4578802`, `20cb095`, then evidence commits `4020b54`, `3cfbcd9`; normal candidate pushes recorded.
- **EVIDENCE:** `evidence/icb-phase3-20261003/`, `evidence/icb-night-20261004/`, CI run `37166237648` and preview checkpoint JSON.
- **RESULT / ADOPTION_STATUS:** Candidate source changes remain unmerged. The old separation failure was addressed as a stale test assertion; audit failure remained external dependency gate.
- **BLOCKER / HUMAN_ACTION:** `braces` advisory, DB-required atomicity/time mutations, authenticated iOS/browser and print acceptance.
- **NEXT_ACTION:** triage dependency path, then continue only non-blocked work; this was performed on 2026-10-05 and ended in a formal hold.

## 2026-10-04 — Security checkpoint and final evidence normalization (`4020b54`, `3cfbcd9`)

- **DATE / TASK / PURPOSE:** Record exact dependency audit, advisory and Preview/CI outcomes; normalize captured whitespace only.
- **START_BRANCH / START_HEAD:** #93 / `20cb095`.
- **END_BRANCH / END_HEAD:** #93 / `3cfbcd9b10e0c4e80ebfe513891a69131536762a`.
- **FILES_CHANGED / IMPLEMENTATION:** evidence/docs only for `4020b54` and `3cfbcd9`; no source behavior changes.
- **TESTS / REGRESSION / BUILD:** prior 54-stage / build / 64-browser PASS remained; no new source test due whitespace-only final docs commit.
- **CI / PREVIEW:** Full Regression `37166468471` failed at seven High `braces` chain advisories. Deployment-safety success; Workers build/preview success. Vercel one-shot skipped by security-gated chain.
- **COMMIT / PUSH:** `4020b54`, `3cfbcd9`, normal push.
- **EVIDENCE:** `evidence/icb-night-20261004/` including security triage, audit, prior CI, Cloudflare preview check, browser results.
- **RESULT / ADOPTION_STATUS:** security remains `HOLD`; no policy weakening or dependency force fix.
- **BLOCKER / HUMAN_ACTION:** no current patched braces; authenticated SSO Preview/device acceptance.
- **NEXT_ACTION:** verify current source/remote before resuming; done in following runs.

## 2026-10-05 — Overnight reconciliation (latest supplied overnight run)

- **DATE / TASK / PURPOSE:** Reconcile current source, triage Security Gate, rerun current candidate build and fixture-browser coverage, preserve evidence.
- **START_BRANCH / START_HEAD:** candidate #93 / `3cfbcd9b10e0c4e80ebfe513891a69131536762a`; original workspace clean main `f00bd12`.
- **END_BRANCH / END_HEAD:** candidate #93 / `74ac541a061890f73553a2e8887cb1f72a8eb9ad`.
- **FILES_CHANGED / IMPLEMENTATION:** 72 evidence files only under `evidence/icb-overnight-20261005/`; zero app/dependency/DB/OCR/workflow changes.
- **TESTS / REGRESSION / BUILD:** `npm run build` PASS (full app regression chain + optimized Next build); fixture runner PASS, 64 checks/29 routes/390/768/1440/zero errors/no DB traffic.
- **CI:** New head deployment safety SUCCESS and Workers build SUCCESS. The preceding app-identical source head failed Full Regression at production audit: seven High findings through `braces <=3.0.3`, with npm proposing breaking Vinext downgrade. No new Full Regression was dispatched for an evidence-only commit.
- **PREVIEW:** current Workers candidate alias READY from final SHA; one-shot Vercel Preview remains skipped by the security-gated workflow.
- **COMMIT / PUSH:** `74ac541`, normal push to existing #93 branch; remote main unchanged.
- **EVIDENCE:** `evidence/icb-overnight-20261005/`.
- **RESULT / ADOPTION_STATUS:** candidate source revalidated; no new feature; security `HOLD`; PR #93 remains draft/unmerged.
- **BLOCKER / HUMAN_ACTION:** patched dependency release, DB holds and user device/print acceptance.
- **NEXT_ACTION:** use this complete ledger for management reconciliation; do not duplicate completed app work.

## 2026-10-05 — Complete handoff documentation (this artifact)

- **DATE / TASK / PURPOSE:** build this requested all-era handoff ledger from Git, PRs, branch refs, worktrees, docs and committed evidence.
- **START_BRANCH / START_HEAD:** isolated #93 worktree / `74ac541`; original workspace `main` / `f00bd12`.
- **END_BRANCH / END_HEAD:** documentation commit to existing candidate #93 branch; exact SHA to be filled in the final handoff report after commit. No application files touched.
- **FILES_CHANGED / IMPLEMENTATION:** only this seven-file ledger set under `evidence/icb-codex-era-complete-handoff-20261005/`; no product code.
- **TESTS / REGRESSION / BUILD / CI / PREVIEW:** none run by the ledger operation; earlier exact-head evidence cited above remains separated by SHA.
- **COMMIT / PUSH:** pending at document preparation; recorded in final user response after normal push/checks.
- **EVIDENCE:** companion branch map/current state/open items/evidence index/management copy block.
- **RESULT / ADOPTION_STATUS:** handoff complete; source implementation work intentionally not selected.
- **BLOCKER / HUMAN_ACTION:** adoption, dependency, DB and device gates listed in `OPEN_ITEMS.md`.
- **NEXT_ACTION:** ICB app management receives `MANAGEMENT_HANDOFF.md`.
