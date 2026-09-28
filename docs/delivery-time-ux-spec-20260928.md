# Delivery time UX spec change — 2026-09-28

## Status

SPEC CHANGE GO. Candidate only. main / Production / shared Supabase remain HOLD.

## New input contract

- Remove `13時まで` from new-input presets only.
- Keep existing records containing 13:00 readable and editable; no backfill or rewrite.
- Show `中`, `15時以降`, `16時以降`, `17時以降` as one-tap choices.
- Always show the custom time input next to the presets. Do not require a separate `時間を指定` button or reveal step.
- Custom time uses the platform-native `input[type=time]` UI, 08:30–17:30, 30-minute step, matching the existing edit screen behavior.
- Selecting a preset synchronizes the custom-time value when the preset is exact.
- Editing the custom time switches the effective choice to that exact time without an extra confirmation step.

## Persistence

No schema change is required. Reuse existing exact-time persistence:

- `schedule_entries.starts_at`
- `schedule_entries.ends_at`
- `schedule_entries.print_time_mode`
- `work_orders.planned_delivery_at` / `planned_delivery_date` through the existing registration/reschedule RPC paths.

No new enum, column, migration, backfill, or shared Supabase APPLY is required for this UX change.

## Compatibility

Existing 13:00 delivery records remain untouched. Detail, day, week, search and daily-report views already derive exact display from `starts_at` plus `print_time_mode`; they must not round a custom time to a preset.

`is_waiting_service=true` continues to mean no delivery schedule entry.

## Important semantic note

The new preset labels are explicitly `15時以降`, `16時以降`, `17時以降`. Existing daily-report exact-delivery formatting currently renders exact times as `N時まで`. This wording difference must be verified in Preview before production adoption; do not silently reinterpret the new input label as `N時まで`.

## Parent-spec update item

Delivery-time input UX changes from legacy candidate-list selection to visible one-tap afternoon presets plus an always-visible native time selector, while retaining the existing exact-time persistence model and legacy-record read compatibility.
