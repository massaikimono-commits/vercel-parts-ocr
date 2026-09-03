-- Applied to the existing Supabase project on 2026-09-03.
-- Staff cancellation of a customer booking must remove every schedule entry
-- tied to the same work order (e.g. a later-added delivery plan), not only
-- the original booking entry.
-- No table/column/constraint changes.

do $do$
declare
  v_oid oid;
  v_def text;
  v_old text := '  if b.schedule_entry_id is not null then
    delete from public.schedule_entries where id=b.schedule_entry_id;
  end if;

  if b.work_order_id is not null then';
  v_new text := '  if b.work_order_id is not null then
    delete from public.schedule_entries where work_order_id=b.work_order_id;
  elsif b.schedule_entry_id is not null then
    delete from public.schedule_entries where id=b.schedule_entry_id;
  end if;

  if b.work_order_id is not null then';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='cancel_customer_booking_by_staff'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'cancel_customer_booking_by_staff not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('delete from public.schedule_entries where work_order_id=b.work_order_id' in v_def) > 0 then
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise exception 'expected customer booking schedule deletion block not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end
$do$;
