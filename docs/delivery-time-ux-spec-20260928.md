# Delivery time UX spec change — 2026-09-28

## Status

SPEC CHANGE GO. DB FUNCTION CONTRACT CHANGE GO for candidate source only. main / Production / shared Supabase APPLY remain HOLD.

## New input contract

- Remove `13時まで` from new-input presets only.
- Keep existing records containing 13:00 readable and editable; no backfill or rewrite.
- Show `中`, `15時以降`, `16時以降`, `17時以降` as one-tap choices.
- Always show the custom time input next to the presets. Do not require a separate `時間を指定` button or reveal step.
- Custom time uses the platform-native `input[type=time]` UI, 08:30–17:30, 30-minute step.
- Selecting a preset synchronizes the custom-time value when the preset is exact.
- Editing the custom time switches the effective choice to that exact time without an extra confirmation step.

## Persistence contract

No new schema column is required. Reuse the existing fields:

- `schedule_entries.starts_at`
- `schedule_entries.ends_at`
- `schedule_entries.print_time_mode`
- `schedule_entries.print_time_label_override`
- `work_orders.planned_delivery_at` / `planned_delivery_date`

Preset semantics and arbitrary exact time must remain distinguishable after persistence:

- preset `15時以降`: `starts_at=15:00`, `print_time_mode=exact`, `print_time_label_override='15時以降'`
- preset `16時以降`: same contract with `16:00` / `16時以降`
- preset `17時以降`: same contract with `17:00` / `17時以降`
- arbitrary exact `15:00`, `16:00`, `17:00`: `print_time_label_override=null`
- `中`: existing `unspecified` behavior with no override

Candidate DB functions may carry the existing override field atomically, but shared Supabase APPLY requires a separate management GO.

## Compatibility

Existing 13:00 delivery records remain untouched. Existing exact records remain untouched. No backfill or mass UPDATE is allowed.

Consumers prefer a non-empty `print_time_label_override` for display; when it is NULL they retain the existing formatter. Sorting and business-time logic continue to use `starts_at`, never the label string.

`is_waiting_service=true` continues to mean no delivery schedule entry.

## Candidate DB function strategy

Do not overload the existing PostgREST RPC names with ambiguous signatures. Preserve existing callers and introduce distinct candidate RPC names that delegate to the current atomic v2/v1 functions, then persist `print_time_label_override` in the same transaction:

- `create_schedule_registration_delivery_label_v1`
- `create_schedule_registration_batch_delivery_label_v1`
- `reschedule_schedule_entry_delivery_label_v1`

These remain candidate-only until shared Supabase APPLY is explicitly approved.

## Parent-spec update item

Delivery-time input UX changes from legacy candidate-list selection to visible one-tap afternoon presets plus an always-visible native time selector. Preset labels are durable business semantics stored in the existing `print_time_label_override`; arbitrary exact times keep that field NULL. Historical records are not rewritten.
