-- Applied to the existing Supabase project on 2026-09-03.
-- Record staff reservation cancellation in the existing structured history table.
-- Uses allowed change_type=OTHER and keeps the precise event in JSON.
-- No table/column/constraint changes.

do $do$
declare
  v_oid oid;
  v_def text;
  v_anchor text := '    delete from public.schedule_entries where work_order_id = v_entry.work_order_id;
    get diagnostics v_deleted_entries = row_count;
  else';
  v_replacement text := '    delete from public.schedule_entries where work_order_id = v_entry.work_order_id;
    get diagnostics v_deleted_entries = row_count;

    insert into public.work_order_schedule_changes(
      work_order_id,change_type,old_value,new_value,changed_by
    )
    values(
      v_entry.work_order_id,''OTHER'',
      jsonb_build_object(
        ''eventType'',''schedule_entry_cancelled'',
        ''scheduleEntryId'',v_entry.id,
        ''entryType'',v_entry.entry_type,
        ''startsAt'',v_entry.starts_at,
        ''endsAt'',v_entry.ends_at,
        ''printTimeMode'',v_entry.print_time_mode,
        ''status'',v_work.status
      ),
      jsonb_build_object(
        ''eventType'',''schedule_entry_cancelled'',
        ''reason'',nullif(btrim(p_reason),''''),
        ''deletedScheduleEntries'',v_deleted_entries,
        ''cancelledLoaners'',v_cancelled_loaners,
        ''rentalCancellationPendingCount'',v_rental_pending,
        ''status'',''cancelled''
      ),
      nullif(btrim(p_actor),'''')
    );
  else';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='cancel_schedule_entry_v1'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'cancel_schedule_entry_v1 not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('''eventType'',''schedule_entry_cancelled''' in v_def) > 0 then
    return;
  end if;

  if position(v_anchor in v_def) = 0 then
    raise exception 'expected cancellation anchor not found';
  end if;

  v_def := replace(v_def,v_anchor,v_replacement);
  execute v_def;
end
$do$;
