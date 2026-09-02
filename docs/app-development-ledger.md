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

At the time this ledger was created, main baseline is:
`7d5848ed78bc146bc22c0ff3f0c19fe8f6382adf`.

## Database state

Supabase already contains the newer cancellation/reschedule/loaner-board functions even though the currently available Netlify UI is older.
Therefore "database live" and "UI live" must be reported separately.

As of 2026-09-02, the refined pickup scheduling rules are also database-live: morning pickup limit 10, afternoon pickup option, and backward-compatible deadline display metadata for pickup/delivery time choices. The latest UI code that renders the deadline labels is source-only until the next deliberate deployment.

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

## Workstream completion rule

Before an app-development chat finishes a batch:

1. update code through branch/PR,
2. run relevant CI,
3. merge only after green,
4. update this ledger when behavior/decision/state changed,
5. state whether the change is source-only, database-live, preview-live, or production-live.
