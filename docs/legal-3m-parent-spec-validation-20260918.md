# legal_3m parent-spec resume validation

Status: SOURCE/MIGRATION CANDIDATE READY — SHARED DB APPLY HOLD

## Parent contract
- internal value: `legal_3m`
- display: `法定 3 ヶ月点検`
- compact choice: `法3`
- daily report mark: `3`
- existing values preserved: `schedule`, `legal_6m`, `legal_12m`

## Current shared DB audit (pre-apply)
- `work_orders_inspection_schedule_type_check`: legal_3m absent
- `daily_report_work_mark()`: legal_3m absent
- `quick_choice_catalog()`: legal_3m absent

## Prepared migration
`supabase/migrations/20260918070200_add_legal_3m_inspection.sql`

The migration only:
1. expands the existing CHECK constraint to permit `legal_3m`;
2. maps `legal_3m` to daily-report mark `3`;
3. exposes `legal_3m` / `法3` in `quick_choice_catalog()`.

No new work_orders column is introduced.

## Compatibility
Existing rows using NULL / schedule / legal_6m / legal_12m remain valid under the expanded CHECK. Existing work-reason mappings and quick-choice entries are preserved.

## Governance gate
Do NOT execute the migration against shared Supabase until management explicitly issues DB APPLY GO.
Do NOT merge to main or deploy Production before that gate.

## Protected scope
No certificate PDF/OCR, QR, parts OCR, print-layout, backup, or production-hosting logic is changed by this candidate.
