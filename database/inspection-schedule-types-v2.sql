-- Add the legal 3-month inspection schedule type without changing existing stored values.
-- Source-only until the user approves activation/deployment.
alter table public.work_orders
  drop constraint if exists work_orders_inspection_schedule_type_check;

alter table public.work_orders
  add constraint work_orders_inspection_schedule_type_check
  check (
    inspection_schedule_type is null
    or inspection_schedule_type = any (
      array['schedule'::text, 'legal_3m'::text, 'legal_6m'::text, 'legal_12m'::text]
    )
  );
