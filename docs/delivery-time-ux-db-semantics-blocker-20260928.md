# Delivery time UX — persistence semantics blocker (2026-09-28)

Status: **DB CHANGE REQUIRED — MANAGEMENT GO REQUIRED BEFORE APPLY**

## Finding

The approved preset semantics (`15時以降`, `16時以降`, `17時以降`) must remain distinguishable from an arbitrary exact time (`15:00`, `16:00`, `17:00`).

Current `schedule_entries` already has:

- `starts_at timestamptz not null`
- `ends_at timestamptz not null`
- `print_time_mode text not null` constrained to `exact | morning | unspecified`
- `print_time_label_override text null`

Therefore **no new column is required**. `print_time_label_override` is an existing suitable persistence field for the preset label/semantics.

However, the current registration/reschedule RPC contracts do not accept or persist a delivery `print_time_label_override`. They only persist time and `print_time_mode`. Consequently:

- preset `15時以降` stored as `starts_at=15:00, print_time_mode=exact`
- arbitrary exact `15:00` stored as `starts_at=15:00, print_time_mode=exact`

are indistinguishable after persistence.

The same collision exists for 16:00 and 17:00.

## Governance conclusion

Do **not** integrate the approved presets into Schedule New/Edit using the current RPC contract. Doing so would violate the management requirement that preset semantics and exact-time semantics remain distinct across save / reload / display.

A DB schema migration/new column is not required, but a **shared DB function/RPC contract change is required** to carry and persist the already-existing `print_time_label_override` field atomically.

No shared Supabase changes were applied during this audit.

## Minimum DB-side candidate direction (not applied)

Extend the relevant registration and reschedule RPC path(s) with a nullable label-override parameter and persist it to `schedule_entries.print_time_label_override`.

Contract:

- `15時以降` preset: `starts_at=15:00`, `print_time_mode=exact`, `print_time_label_override='15時以降'`
- `16時以降` preset: same pattern with `16時以降`
- `17時以降` preset: same pattern with `17時以降`
- arbitrary exact time: `print_time_label_override=null`
- `中`: existing `unspecified` behavior; no preset label override needed
- historical records: untouched; no backfill

All consumers must prefer a non-empty `print_time_label_override` over derived exact-time labels. Historical exact records with no override retain existing display behavior.

## Stop condition

Per management instruction, implementation stops before UI integration / DB apply until DB-change governance is decided.
