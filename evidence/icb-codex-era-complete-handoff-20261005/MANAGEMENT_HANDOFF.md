# Copy-ready ICB management handoff

## 【送信先：ICBアプリ総合管理14】
## 【Codex移行後 COMPLETE HANDOFF｜Current State Reconciliation】

このLedgerは、Git/PR/branch/worktree/committed evidence/docs/CI/Preview記録で、Mac Terminal Codex運用に入ってから現在までの状態を復元したものです。アプリsource実装は行っていません。

### Codex移行点と証拠範囲

Mac Terminal上で確認できる最初のローカルrepo cloneは**2026-10-02 01:17:45 JST**、`main`=`f00bd12`です。Codex sessionの実開始日時はGitからは証明できないためUNKNOWNとします。Delivery候補`5870d86`、Certificate PDF predecessor `d3b9256`、Native v3 adoption PR #77はこのcloneより前のcommitです。これらは作成者/UIをCodexと断定せず、引き継いだ関連candidate/historyとして記録しました。

### Current source of truth

- `origin/main`=`f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`, original workspaceはclean。PR #90 dependency recovery (`faa5ab3`) はmerge済み。
- Current app-core candidate: Draft PR #92 `candidate/icb-app-overnight-20261003`=`8b38adba491020cc58a5f8b0af1e8349c145d396`。
- Current stacked continuation: Draft PR #93 `candidate/icb-continuation-20261003`=`74ac541a061890f73553a2e8887cb1f72a8eb9ad`。#93は#92にstackされ、どちらも未merge/未採用。
- Current app-core source work is already in candidate. The final 2026-10-05 code run made **no app-source/dependency/DB/OCR/workflow changes**; it recorded evidence only.
- Current secondary candidates remain separate: Delivery UX PR #86=`5870d86846a961ae2f9dccae993740b728df59d9`; Certificate PDF PR #87=`5ca65e71312b1b352d1b042e8bc95715acb9c8e1`. Do not merge/cherry-pick them into app continuation without explicit stream review.
- The Native v3 primary boundary was adopted separately by merged PR #77 (`bda9a6b`). Later PDF async/generalization work in #87 remains unadopted.

### Timeline and completed candidate work

1. **Certificate PDF Native v3:** PR #77 adopted the validated primary boundary on 2026-09-19. Subsequent #87 work isolates async PDF writers, resets document state on selection, recovers generic structural fields and exposes current results for acceptance. Latest #87 head is `5ca65e7`, not the earlier `d3b9256` checkpoint. It is 12 commits ahead and 6 behind current main.
2. **Delivery Time UX:** candidate evolved from `8285d9f` to #86 `5870d86`, adding unified time selection, labels/custom range and three-column compact visual tests. GitHub reports 52/52 acceptance/regression stages and Full Regression/Deployment Safety/Vercel/Workers checks all SUCCESS for the exact candidate. PR #86 remains open and unmerged; DB persistence contract and iPhone reacceptance remain gated.
3. **Main dependency recovery:** PR #90 merged `faa5ab3` as main `f00bd12`, pinning Next 16.3.6 and updating DOMPurify/fast-uri; its full regression/security checks passed. This does not address the subsequently seen `braces` path in Vinext.
4. **Vercel security-test artifact:** commit `13c32f5` handles Vercel source artifacts that omit `.gitignore` by validating a tracked policy copy only when `VERCEL=1`; normal repo execution still validates the actual `.gitignore`. Vercel and Workers checks passed on that branch. No PR or merge was found, so adoption is unresolved.
5. **App-core PR #92:** from main `f00bd12` to `8b38adb`; 46-file batch for navigation, search/detail/back, duplicate/stale-operation recovery, responsive behavior and route failures. Its committed evidence records 50 regression stages/full build/browser fixture pass, plus 28 route smoke checks at 390/768/1440. After push, exact-head Full Regression `37081957317`, Deployment Safety `37081959446`, OCR jobs `37081915194`, Vercel and Workers Preview all passed. It remains unmerged.
6. **App-core continuation PR #93:** source sequence `e99d523 → 4578802 → 20cb095`; error-vs-empty recovery for customer/history/photos/lease/staff/vendors, selected-customer write guards, schedule edit/cancel/active-registration protection, waiting/service state handling, date navigation, per-work status locking, loaner daily/weekly recovery and workload assignment/filter recovery. Evidence progresses from 11 focused / 53 stages / 44 fixture checks to 19 focused / 54 stages / 64 browser checks. Build passed. Existing latest candidate still preserves DB/device limitations.
7. **Latest security triage:** PR #93 audit reports seven High findings via Vinext/Vite→micromatch→`braces <=3.0.3`; registry latest checked was 3.0.3. npm proposes a breaking Vinext downgrade to 0.0.15. Gate was not weakened. The #93 Full Regression at run `37166468471` stops at audit before app tests; deployment safety and candidate Workers build pass.
8. **Latest 2026-10-05 verification/checkpoint:** local `npm run build` passed the full registered application regression chain and optimized Next build. Fixture browser regression passed 64 checks over 29 routes at 390/768/1440, zero page errors, backend intercepted/no shared DB traffic. Evidence-only commit `74ac541` pushed normally; safety and Workers Preview build passed. Full handoff files are in `evidence/icb-codex-era-complete-handoff-20261005/`.

### Tests, CI, Preview and their limits

- **#86 Delivery:** PR body records 52/52; Full Regression run `36801336815`, Deployment Safety `36801304322`, Vercel status and Workers build passed on `5870d86`. It is still a candidate, not adoption or device acceptance.
- **#87 Certificate PDF:** Full Regression `36970514308`, PDF/generalization and deployment checks and Vercel/Workers Preview passed on `5ca65e7`. A separate OCR workflow `36970481721` failed in `vehicle-certificate-regression` at npm audit due older DOMPurify/fast-uri and a critical Next advisory; the Parts job was skipped. This was an audit gate before algorithm tests, not an OCR assertion failure. The branch has not absorbed main PR #90.
- **#93 App core:** local full build/regression and 64 fixture checks pass. GitHub Full Regression `37166468471` failed only at the production dependency audit before source tests. The `74ac541` evidence-only update has Deployment Safety SUCCESS and Workers build SUCCESS; a duplicate Full Regression was not dispatched for that documentation-only commit.
- **Current #93 candidate Preview:** Cloudflare Workers build `4fe00640-0091-4e96-b57e-6e1ef70332e1` SUCCESS; non-production alias `https://candidate-icb-continuation-20261003-vercel-parts-ocr.massa-ikimono.workers.dev`.
- **Vercel one-shot for #93:** skipped because Full Regression has not passed the security gate. #86/#87/13c Vercel statuses apply only to those candidate SHAs.
- Preview and Chromium fixture PASS do not prove authenticated live Supabase, real iPhone/iPad/Safari, physical A4/A3 print, or Production readiness.

### Functional state and boundaries

- Customer/vehicle: current lookup and history/photos/lease recovery is implemented and candidate-tested; actual live authenticated records are unverified.
- Schedule: latest accepted contract says schedule search is last-four-only; customer/vehicle lookup remains last4/name/phone; first visit can be name+last4. Hours are 08:30–17:30 with 12:00–13:00 closed; arrival windows 08:30–11:00 and 13:00–17:00; combined caps 15 AM/10 PM, AM pickup 10, AM vehicle-inspection intake 4. Waiting is valid for any `customer_visit` reason with no delivery plan; work progresses `未→中→完`. Cancellation is one work-order at a time. Source guards reduce repeat writes/stale state, but multi-RPC writes are not atomic.
- Desktop/mobile: current candidate has compact/responsive changes and 390/768/1440 fixture evidence. Native mobile/browser acceptance still required.
- Vehicle Certificate PDF: Native v3 primary boundary is adopted on main; later #87 generic/async safety is candidate-only. Do not mix its specialized branch into #93.
- Parts OCR: current run did not alter yellow/white OCR algorithms or evaluation branches; mainline OCR contracts/tests are described in `docs/ocr-test-ledger.md`. Frozen/scoring-only data must not be treated as runtime/adopted algorithm changes.
- Bulk PDF import: route exists and was route-smoke tested; this run did not change its runtime or claim live-data acceptance.
- Delivery labels: 15:00/16:00/17:00-afternoon presets and arbitrary time are required; “13時まで” is removed. Persistence is DB-gated.
- Printing: existing blank parts slip, inspection record A4, designated inspection record A3 portrait, daily report A3/no-total regression contracts were kept. Physical print acceptance is still open.
- Parent spec: repo has no standalone full v1.3/v1.4 source in audited paths. Audited ledgers/current instructions/tests; no ambiguous rule was invented.

### Holds and ownership

- **DB_HOLD (3):** delivery label/custom-time persistence schema/RPC; `legal_3m`; atomic multi-RPC schedule edit/active registration. No DB query/apply occurred in this ledger task; current live Supabase revision is UNKNOWN beyond dated repo docs.
- **DEPENDENCY_BLOCKED (2 candidate heads):** #93 `braces` High path; #87 outdated dependency branch relative to PR #90/main.
- **DEVICE_REQUIRED (3):** authenticated live-backend acceptance; actual iPhone/iPad/Safari; physical printing.
- **ADOPTION_REVIEW (5 records):** PR #86, #87, #92/#93 stacked pair, and standalone `13c32f5` artifact fix.
- **PRODUCTION_HOLD:** no merge or Production deployment was made; Production approval remains separate. Current Production revision was not looked up in this reconciliation.
- **CODEX_READY=0; CHATGPT_READY=0:** no additional safe unimplemented app change evidenced. Do not create work to keep Codex active. This conclusion is for implementation, not candidate adoption/device/DB decisions.

### Git and safety outcome

Latest documentation/evidence checkpoint before this ledger was `74ac541`, pushed non-force to PR #93. This ledger is also documentation/evidence only and will be committed to the candidate branch if its content validation succeeds. `main`, Production, DB, credentials and Frozen OCR remain untouched; no force push or destructive workspace operation was used.

### Required disposition from ICB management

Treat #86, #87 and the stacked #92/#93 as distinct candidates. Decide adoption/review order only after acknowledging each branch's exact checks and current gates. Keep `13c32f5` as an isolated tested artifact fix until management assigns it to a PR. Keep the current #93 dependency gate enabled. Defer DB/device items to their existing owners/gates. The next app implementation should be selected only after management has accepted this ledger and provided any missing formal spec or safe dependency resolution.
