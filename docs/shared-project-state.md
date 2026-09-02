# Shared Project State

Last updated: 2026-09-02
Latest integrated feature baseline before this state sync: `5c86b7c76401d3bfa814f21536dc772a60bf1815`

## Purpose

This file is the synchronization point for every ChatGPT workstream touching this repository.
Chats do not message each other directly and chat-local context must never be treated as the source of truth.

## Mandatory startup checklist for any chat/workstream

Before changing code or claiming current status:

1. Read this file.
2. Read `docs/ocr-test-ledger.md` for OCR/vehicle-certificate/parts-slip work.
3. Read `docs/app-development-ledger.md` for app-core/schedule/loaner/customer/printing/security work.
4. Check current `main`, relevant open PRs, and CI.
5. Check the actual hosting/database state before saying a change is live.

## Source-of-truth order

1. GitHub `main`, PRs, commit history, CI.
2. Supabase schema/functions/policies for database state.
3. Netlify/Vercel deployment records for what is actually deployed.
4. These ledgers for cross-chat decisions, known gaps, and next steps.
5. Chat history/memory only as supporting context.

## Cross-chat rule

There is no direct chat-to-chat messaging. A workstream that changes a shared assumption, fixes a bug, adds a regression, or changes release/deployment state must update the relevant ledger in GitHub so another chat can recover the same state without relying on a handoff message.

## Deployment safety

Normal development must not deploy automatically.

- Netlify normal commits are fail-closed.
- Netlify Preview requires an intentional `[deploy netlify preview]` release marker.
- Netlify Production requires explicit user approval before using `[deploy netlify production]`.
- Vercel Git auto-deploy is disabled.
- Batch fixes -> CI/regression -> one deliberate test deployment -> practical test -> one deliberate production deployment.
- Never use deployment as a substitute for local/CI validation.

## Known deployment boundary

- Netlify Production: `https://icb-vehicle-app.netlify.app`
- Netlify Deploy Preview #4: `https://deploy-preview-4--icb-vehicle-app.netlify.app`
- Preview #4 is confirmed at commit `6a9155e`.
- GitHub `main` is newer than that preview; do not claim recent main changes are visible there.
- Netlify credit exhaustion currently blocks new Production deploys and also cancels new Deploy Previews; Trigger deploy is disabled. Support case: #1103777.
- PR #43 is retained as the prepared latest-main Preview trigger, but it cannot build until Netlify restores deployment capacity. Do not repeatedly retrigger it while the account is paused.
- Vercel Git auto-deploy remains disabled; use only a deliberate test deployment when capacity is available.

## Netlify credit incident

Netlify Usage & Billing confirmed:

- 21 Production Deploys = 315 credits.
- Total usage shown = 316.4 credits.
- AI inference = 0 credits.
- The Production Deploys account for essentially all exhausted credits.
- Safeguards have since been added to prevent recurrence.

## Database baseline

Supabase project `wlwbgirumlqatwvilxsz` is the shared backend.
Known live RPCs include:

- `cancel_schedule_entry_v1(uuid,text,text)`
- `reschedule_schedule_entry_v2(...)`
- `loaner_day_board(date)`
- `lease_rental_eligibility(uuid,text,timestamptz,timestamptz,timestamptz)`

`lease_maintenance_contracts` is database-live for vehicle-linked lease contract history; its RLS is enabled, anonymous CRUD is unavailable, and its rental eligibility RPC is not executable by anon. Current loaner assignment is deliberately not connected to that eligibility RPC until real contract PDFs are validated and contract data is populated.

Checked customer/vehicle/schedule/work/loaner/OCR/parts tables have RLS enabled; anonymous CRUD was not available on the checked tables. Security advisor warnings around selected SECURITY DEFINER/auth-token functions still require dedicated review rather than mass changes.

## Vercel manual deploy check 2026-09-03

- User explicitly authorized exactly one manual Vercel deploy to check whether the previous limit had cleared.
- One Preview deployment was created: `dpl_uTg42gvMzcMFDAKfh4Ek8aGefB1S`.
- It reached BUILDING, so Vercel was no longer blocking deployment creation at the previous quota/limit gate.
- The build then failed in `schedule-desktop-density-regression.mjs`, not because of Vercel quota.
- Cause: the regression still expected A3 `@page` CSS in `app/schedule/page.tsx`, while printing had already moved to the dedicated `app/schedule/print/page.tsx`, where A3 portrait remains configured.
- The regression was corrected and merged to main as `130d56e317d632760ee007aff8be6c55e704f847`; GitHub regression/build passed.
- No second Vercel deployment was attempted because the user authorized one deploy only.

## Release principle

A green GitHub main means "source ready", not "live".
Always identify three states separately:

- source state,
- database state,
- deployed UI state.

## Schedule UX update 2026-09-03

- Top/dashboard now places the current 1-week schedule before the daily summary; week cards are always visible and link to day detail / registration.
- Terminology clarified: detailed day view is `1日の予定`; weekly view is `1週間のスケジュール`.
- New reservation flow order: `① お客様・車両 → ② 入庫内容 → ③ 日時 → ④ 納車予定`.
- Schedule cancellation reason is optional in the UI. Existing Supabase cancellation RPCs already accept NULL/blank reasons, so no database migration was required.
- Regression coverage added: `scripts/schedule-workflow-ux-regression.mjs` and CI step.
- PR #51 merged as `95df8e5eb0ab6c0417913ae0dc84442853040008`.
- No Vercel or Netlify deployment was triggered for this change; deploy only after explicit user approval.

## Customer cleanup / multi-vehicle reservation / bulk PDF migration 2026-09-03

- PR #53 merged to main as `52ebc1612b003031137925736304dfbbf9e6f555`.
- Customer management now supports deleting the customer record itself. The UI explicitly preserves linked vehicles, schedules and work history; vehicles become unassigned customers through the existing FK `ON DELETE SET NULL`.
- Reservation registration supports selecting multiple registered vehicles belonging to the same customer and registering them with shared work type/date/time.
- Atomic batch scheduling RPC source added: `database/create-schedule-registration-batch-v1.sql`. It rolls back the whole batch if any selected vehicle cannot be registered.
- Bulk migration screen added: `/customer-vehicles/bulk-import`. It accepts multiple vehicle-certificate PDFs, parses native PDF text, shows review/edit rows, then imports selected rows in one batch.
- Bulk import RPC source added: `database/import-vehicle-certificates-batch-v1.sql`. Existing vehicles are matched by chassis/registration; exact normalized customer name/address matching avoids unsafe merges.
- Image-only / insufficient-text PDFs are not auto-imported by the bulk screen; they stop at review/error for manual handling.
- Native PDF.js worker in `certificate-pdf-native-reader-v2.jsx` was changed from external jsDelivr to the bundled local worker.
- New regression: `scripts/customer-migration-workflow-regression.mjs`; CI, security regression and Next.js build passed.
- Both new SQL files were syntax/schema checked against the live Supabase schema inside `BEGIN ... ROLLBACK`; the test succeeded and a follow-up query confirmed neither new function was left installed.
- IMPORTANT: the two new Supabase RPCs are NOT live yet. Apply them before deploying the UI that calls them.
- No Vercel or Netlify deployment was performed for this batch.
