# Shared Project State

Last updated: 2026-09-02
Canonical main baseline at creation: `7d5848ed78bc146bc22c0ff3f0c19fe8f6382adf`

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
- Netlify production deployments are currently paused by the credit limit. Support case: #1103777.
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

Checked customer/vehicle/schedule/work/loaner/OCR/parts tables have RLS enabled; anonymous CRUD was not available on the checked tables. Security advisor warnings around selected SECURITY DEFINER/auth-token functions still require dedicated review rather than mass changes.

## Release principle

A green GitHub main means "source ready", not "live".
Always identify three states separately:

- source state,
- database state,
- deployed UI state.
