# App Development Ledger

Last updated: 2026-09-02
Shared baseline: see `docs/shared-project-state.md`

## Purpose

Track app-core decisions and implementation state independently of any single chat so scheduling, customer/vehicle, loaner, printing, inspection, security, and deployment work do not disappear between workstreams.

## Product scope that must remain present

### Customer / vehicle

- Customer and vehicle records shared through Supabase.
- Vehicle input from certificate PDF/photo/manual.
- Search by plate last 4, phone, or customer name; duplicate results require explicit selection.
- Vehicle/VIN links to parts, photos, history, and workflow state.

### Login

- Operational requirement is ID + password rather than email-facing login.
- Security work includes session lifetime, login anomaly handling, and safe error behavior.
- Passkey/Windows Hello/iPhone Face ID remains an optional future decision, not a finalized replacement.

### Schedule / intake-delivery

Types:

- pickup,
- delivery,
- customer visit,
- mobile service.

Reasons include inspection, vehicle inspection, general repair, and body/paint.

Business rules include:

- reception 08:30-11:00 and 13:00-17:00,
- no registration 12:00-13:00,
- business hours 08:30-17:30,
- one-hour visit slots,
- overlap warning with explicit override,
- combined AM cap 15 / PM cap 10 for pickup/visit/mobile,
- vehicle-inspection AM cap 4, warn on 5th; PM uncapped,
- annual business-calendar input,
- delivery date/time can be registered together with intake and changed later.
- morning pickup has its own limit of 10 entries; exact pickup deadlines and A中 both count toward the same 10 (for example, one 9時まで pickup plus one A中 pickup counts as 2).
- pickup choices include 9時まで / 10時まで / 11時まで / A中 in the morning and an afternoon period option.
- exact pickup and delivery times are operational deadlines, so user-facing labels use 「〜時まで」 / 「〜時〜分まで」 rather than plain clock-time wording.
- pickup entries may share the same deadline/placeholder without triggering the generic same-type overlap warning; capacity rules still apply.

- schedule registration can search registered customer/vehicle data by customer name, company, phone, registration, plate last4, chassis, maker, or model; selecting a result reuses the existing customer/vehicle IDs instead of creating duplicates.

### Daily schedule print

Portrait paper:

- left side deliveries,
- right side pickup/visit/mobile,
- upper half AM,
- lower half PM,
- customer/name, plate last4, reason, time,
- completion indicator for delivery,
- staying vehicles show worker, planned completion, reason.

### Loaner / workload

Recent app-core source includes:

- weekly loaner view,
- attention/shortage-focused view,
- loaner assignment from schedule,
- loaner period sync when schedule changes,
- workload/schedule search improvements.

### Lease maintenance contracts

- Lease-maintenance contract terms are stored separately from vehicle-certificate fields and inspection-record print fields, linked by vehicle ID.
- Preserve contract history instead of overwriting old contracts; original one-page PDF can be linked through `vehicle_documents`.
- Extraction states use explicit `yes / no / not_stated / needs_review`; absence of wording must never be silently treated as `no`.
- Initial target fields: substitute-car rider, eligible work types, start-day condition, duration limit, inspection intervals, battery, summer tires, winter tires, tire storage, oil special interval, tire maker restriction, contract period, evidence excerpts.
- Expired/missing/unreviewed contracts must surface as `契約期限経過・要確認` / review-needed rather than being treated as current.
- Company courtesy vehicles remain selectable regardless of rental-company coverage. Rental-company vehicles will later be gated by effective contract terms.
- Foundation includes a fail-closed rental eligibility helper, but current loaner assignment behavior is deliberately not changed until sample PDFs are validated and contract data is populated.

### Reservation cancellation

Integrated practical-test batch includes:

- cancellation UI,
- two-stage confirmation,
- linked cancellation of intake/delivery schedule entries,
- linked work-order cancellation handling,
- linked loaner reservation handling,
- rental-company cancellation-pending state.

Relevant Supabase RPCs are already live; deployed UI may still be older.

### Inspection records

点検整備記録簿:

- vehicle-certificate data feeds vehicle fields,
- applicability changes by vehicle/fuel/drive/brake configuration,
- parts data can drive symbols such as `/`, check, replacement, refill, and disassembly-related markings,
- uncertain items should remain blank for handwritten completion,
- handwritten/re-upload learning workflow is optional and should not block independent printing.

指定整備記録簿 braking formulas requested:

- rear brake ratio = rear left+right braking value / rear axle weight,
- total brake ratio = total braking value / inspection vehicle weight,
- parking brake ratio = parking brake left+right / inspection vehicle weight.

Staff confirmation precedes print.

### Parts print/data

- Fixed OCR output: part name, quantity, retail/list price, cost.
- Save/copy as text for spreadsheet use.
- Link records to vehicle/VIN.
- Save source photos/history.
- Print onto designated blank areas of forms.
- Do not print total amount.

## Recent integrated source work

Recent main includes:

- practical-test reservation/loaner batch,
- deployment fail-closed safeguards,
- recovered OCR regression coverage,
- QR distractor/noise correction,
- vehicle-certificate v2 legacy-override cleanup,
- parts OCR redundant-pass reduction.
- schedule registration selection from existing registered customer/vehicle records.
- desktop daily schedule view is compacted for higher information density; mobile layout and A3 one-day print remain separate and unchanged by this screen-only density pass.
- mobile one-day schedule now keeps the daily-report placement standard: delivery left, pickup/customer-visit/mobile-service right, morning above afternoon.
- weekly schedule now renders each day as a compact daily-report layout with morning/afternoon sections and delivery/inbound columns instead of one flat vertical list; mobile week view snaps horizontally day-by-day.
- refined pickup capacity/deadline rules: morning pickup cap 10, afternoon pickup option, and deadline wording for pickup/delivery exact times.
- lease-maintenance contract foundation: vehicle-linked contract history, evidence/review states, contract expiry handling, and a fail-closed rental-company eligibility helper; assignment enforcement remains intentionally disconnected until real PDFs are validated.

Latest integrated feature baseline before this ledger-only sync:
`5c86b7c76401d3bfa814f21536dc772a60bf1815`.

## Database state

Supabase already contains the newer cancellation/reschedule/loaner-board functions even though the currently available Netlify UI is older.
Therefore "database live" and "UI live" must be reported separately.

As of 2026-09-02, the refined pickup scheduling rules are also database-live: morning pickup limit 10, afternoon pickup option, and backward-compatible deadline display metadata for pickup/delivery time choices. The latest UI code that renders the deadline labels is source-only until the next deliberate deployment.

The lease-maintenance contract foundation is also database-live: `lease_maintenance_contracts` has RLS, anon CRUD is unavailable, and `lease_rental_eligibility(...)` is authenticated/service-role only. Current loaner assignment remains intentionally unchanged until sample PDFs are validated.

## Security / operations

Already integrated or discussed:

- suspicious-login detection/alerts,
- vendored/local OCR assets rather than depending on an external OCR CDN,
- encrypted off-site Supabase backup workflow,
- retention/security regressions,
- RLS on checked app tables.

Still requiring careful dedicated work:

- Supabase advisor warnings around SECURITY DEFINER/auth token functions,
- leaked-password protection setting,
- any MFA/passkey final policy decision.

Do not mass-change SECURITY DEFINER functions simply to clear advisor warnings; inspect app dependencies and anonymous/authenticated intent first.

## Deployment state

See `docs/shared-project-state.md`.

Important practical rule:

- current Netlify Preview #4 is an older practical-test baseline,
- current main is source-ready but not deployed there,
- Vercel Git auto-deploy is off,
- do not create a deployment for each small fix.

## Dependency upgrades

Major framework/toolchain dependency upgrades are not "missing app fixes".
Do not mix major Next/TypeScript/PDF/Tesseract/ZXing/GitHub Action upgrades into the practical-test release without a dedicated compatibility/regression pass.

## Chat handoff rule

- Before an app-development chat becomes too long or unstable, prepare a handoff before switching chats.
- The handoff must include: current branch/commit, what was changed, what is preview-live vs source-only, current Vercel preview URL if any, pending-fix ledger items, unresolved questions, and the next concrete action.
- Do not rely on the next chat to rediscover project state from scratch; `docs/app-development-ledger.md` and `docs/pending-fix-ledger.md` are the shared handoff baseline.

## Workstream completion rule

Before an app-development chat finishes a batch:

1. update code through branch/PR,
2. run relevant CI,
3. merge only after green,
4. update this ledger when behavior/decision/state changed,
5. state whether the change is source-only, database-live, preview-live, or production-live.

### 2026-09-03 — Schedule workflow UX batch
- Top page changed to weekly-schedule-first.
- Day/week naming cleaned up to reduce duplicated meaning.
- Reservation registration reordered to customer/vehicle first, then work type, then date/time.
- Cancellation reason made optional; blank cancellation reason is allowed.
- Added schedule workflow UX regression and CI coverage.
- PR #51 merged: `95df8e5eb0ab6c0417913ae0dc84442853040008`.
- Hosting deployment intentionally not run.

### 2026-09-03 — Customer cleanup and migration efficiency batch
- Added safe customer record deletion while retaining linked vehicle/work/schedule history.
- Added same-customer multi-vehicle schedule selection and atomic batch registration RPC source.
- Added multi-PDF vehicle-certificate migration page with review-before-import.
- Added atomic bulk customer/vehicle import RPC source and duplicate matching safeguards.
- Removed the native PDF reader's jsDelivr PDF.js worker dependency in favor of the bundled local worker.
- Added customer migration workflow regression; full CI/build passed.
- SQL was validated in a rolled-back transaction only; new RPCs remain unapplied to live Supabase.
- PR #53 merged: `52ebc1612b003031137925736304dfbbf9e6f555`.
- Hosting deployment intentionally not run.

### 2026-09-03 — Customer migration safety hardening
- Bulk PDF customer import now keeps individual/company type instead of forcing all imported customers to individual.
- Same-name customer matching was tightened to avoid merging addressed customers when the source PDF has no address.
- Bulk import UI now shows a saved state after successful registration.
- PR #56 merged: `ae7f015b278e6ecf0cde3616cccb291c1a639100`.
- Full regression and Next.js build passed.
- Batch RPC SQL is still not applied to live Supabase; hosting deployment also remains intentionally not run.

### 2026-09-03 — Morning additions deployed to Vercel Preview
- Applied live Supabase RPCs for same-customer multi-vehicle schedule registration and bulk vehicle-certificate PDF import; anon execute remains disabled.
- Updated stale single-vehicle regression to cover multi-select scheduling.
- Updated app-core cancellation regression to preserve optional cancellation reason.
- Changed GitHub pre-deploy CI final gate to the exact `npm run build` used by Vercel.
- Exact full build passed in GitHub before final deployment.
- Vercel Preview READY: `dpl_DeQ2s7Nu5GzBAjZoqPBBLvhimu73`, source `1f50b4e4e2c27ed6b13aa6883aae83c436f2b1cb`.
- Preview root returned HTTP 200. Netlify was not changed.


### 2026-09-05 — DBを触らない先行修正バッチ
- Netlify本番が再デプロイ不可の間は、共有Supabase DBを変更せずに進められる修正を優先する運用へ整理。
- 予定登録の点検区分表示を「スケジュール点検 / 法定6ヶ月点検 / 法定12ヶ月点検」に統一。法定3ヶ月点検はDB制約変更が必要なため保留 #001。
- 点検区分は `reason=点検` の時だけ表示し、車検では不要な点検区分値を保持しないよう整理。
- 点検の納車予定初期値は当日「中」、車検は既存 `business_calendar` を読み取って翌営業日「中」を優先するよう変更。DB変更なし。
- 予定登録成功後に1日の予定へ強制遷移せず、そのまま連続登録できるよう変更。
- トップページの独立した「今日の予定 / 1日の予定」導線を削除し、1週間スケジュールを主導線として維持。日別詳細は週/月/日付検索から開く。
- 廃止済みの appointment completion（`schedule_entries.completed`）を1日の予定UIの状態判定から除外。作業状態は work_order の「未実施 → 作業中 → 作業完了」に一本化。
- 予定検索と登録済み車両ピッカーの下4桁表示を自然表示（例: 0010 → 10）へ統一。
- 入庫区分表示「引き取り」を「引取」に統一。
- 現在の共有DB `schedule_slot_check_v2` が exact の同一entry_type全般で重複警告を出すことを確認。確定仕様「時間指定の来社×来社のみ警告」と不一致のため保留 #003 を追加。DBは未変更。
- #003用SQLソースは将来適用できるよう customer_visit exact のみに限定する形へ準備済みだが、ライブSupabaseには未適用。
- Vercel / Netlifyへの新規デプロイはまだ実施していない。次回は複数修正をまとめて1回のVercel Previewで確認する。

### 2026-09-05 — Post-v1.1 DB-free confirmation pass
- Reviewed the confirmed post-v1.1 schedule/report changes against `preview/schedule-ux-20260903`.
- Confirmed the shared `schedule_entries.delivery` business-state source, staying/body-shop/planned-delivery rules, schedule/6m/12m inspection labels and report codes, delivery-plan editing, natural plate display, pickup label cleanup, and deprecated appointment-completion removal are already present.
- Hardened schedule registration so `inspection_schedule_type` is sent only when `reason=点検`; changing to 車検/一般整備/板金 cannot submit a stale inspection subtype even if UI state has not finished clearing.
- Added regression coverage for the single-vehicle and batch registration paths.
- Deferred items remain #001 legal_3m, #002 来社「作業待ち」, #003 来社以外の exact-time 重複警告停止; shared Supabase DB was not changed.


### 2026-09-05 — Schedule duplicate rule split
- Confirmed schedule-registration operation: normally select an already-registered customer/vehicle and reflect it into the schedule.
- Added a separate schedule duplicate warning: same vehicle ID + same JST calendar day warns regardless of time or work reason; user may explicitly choose to register anyway.
- Vehicle identity/deduplication is not inferred from plate last4 or score. The current manual schedule form has no chassis input, so it is information-insufficient and must not assert that a provisional/manual entry is the same vehicle.
- Customer candidate reuse remains a separate customer-only confirmation.
- Full registration number differences (including area/class/hiragana/serial) are therefore never collapsed by schedule duplicate logic; schedule duplicate uses the selected existing vehicle ID only.
- No Supabase schema/function change. main/Netlify untouched.

### 2026-09-06 — Schedule search / edit / cancellation preview handoff
- User verified on iPhone/Vercel Preview:
  - schedule registration reset/defaults/top-success flow,
  - iPhone Safari scroll-to-top after successful registration,
  - cross-customer multi-vehicle batch registration,
  - unified inbound time selector in schedule registration,
  - unified inbound time selector in schedule edit,
  - schedule search short numeric last4 behavior,
  - work_order-based schedule search grouping and combined inbound+delivery edit,
  - work_order-based cancellation including a successful real cancellation test.
- Current schedule model is explicitly `1 work_order = 1入庫予定一式` for search/edit/cancel:
  - schedule search groups inbound + delivery by `work_order_id`,
  - edit loads related delivery by the same `work_order_id`,
  - existing `cancel_schedule_entry_v1` already deletes all `schedule_entries` for the work order and keeps existing loaner/rental-company safety behavior.
- Cancellation confirmation now shows customer name, natural last4, reason, inbound plan, and delivery plan, with “この入庫予定一式を取消します”.
- Latest cancellation practical-test Preview that passed: https://vercel-parts-7878q7o48-massa-ikimono-8427s-projects.vercel.app/?_vercel_share=vcbRHad07CYo0cd76myGyDRY6OfK8zp1
- Current source head before this ledger update: `e0ec8663f20834fa1b986380bc644540c77a4631`.
- PR #62 remains Draft/unmerged. main / Netlify / shared Supabase schema/functions were not changed by these UI updates.
- Deferred DB items remain unchanged: #001 legal_3m, #002 来社「作業待ち」, #003 exact-time overlap warning scope.
- Next requested action: simplify schedule-search result cards so each work-order set has side-by-side `予約変更` / `予約取消` actions; cancellation should open the existing two-step work-order cancellation confirmation directly from search without weakening safety.

