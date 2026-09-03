-- Applied to the existing Supabase project on 2026-09-03.
-- Legacy reschedule_schedule_entry still remains callable, so keep its
-- history writes compatible with work_order_schedule_changes.
-- No table/column/constraint changes.

do $do$
declare
  v_oid oid;
  v_def text;
  v_old_type text := 'e.work_order_id,''schedule_entry_rescheduled'',';
  v_new_type text := 'e.work_order_id,''OTHER'',';
  v_old_payload text := 'jsonb_build_object(
        ''scheduleEntryId'',e.id,''entryType'',e.entry_type,';
  v_new_payload text := 'jsonb_build_object(
        ''eventType'',''schedule_entry_rescheduled'',
        ''scheduleEntryId'',e.id,''entryType'',e.entry_type,';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reschedule_schedule_entry'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'reschedule_schedule_entry not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position(v_old_type in v_def) > 0 then
    v_def := replace(v_def,v_old_type,v_new_type);
  elsif position(v_new_type in v_def) = 0 then
    raise exception 'expected legacy reschedule history type not found';
  end if;

  if position('''eventType'',''schedule_entry_rescheduled''' in v_def) = 0 then
    if position(v_old_payload in v_def) = 0 then
      raise exception 'expected legacy reschedule payload not found';
    end if;
    v_def := replace(v_def,v_old_payload,v_new_payload);
  end if;

  execute v_def;
end
$do$;
