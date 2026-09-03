-- Applied to the existing Supabase project on 2026-09-03.
-- Keep customer-booking cancellation in the existing booking event stream,
-- and also record it in the common work-order schedule history.
-- No table/column/constraint changes.

do $do$
declare
  v_oid oid;
  v_def text;
  v_anchor text := '  if b.work_order_id is not null then
    update public.work_orders
    set status=''cancelled'',updated_at=now()
    where id=b.work_order_id;
  end if;';
  v_replacement text := '  if b.work_order_id is not null then
    update public.work_orders
    set status=''cancelled'',updated_at=now()
    where id=b.work_order_id;

    insert into public.work_order_schedule_changes(
      work_order_id,change_type,old_value,new_value,changed_by
    )
    values(
      b.work_order_id,''OTHER'',
      jsonb_build_object(
        ''eventType'',''customer_booking_cancelled_by_staff'',
        ''bookingRequestId'',b.id,
        ''scheduleEntryId'',b.schedule_entry_id,
        ''status'',b.status,
        ''requestedStartsAt'',b.requested_starts_at
      ),
      jsonb_build_object(
        ''eventType'',''customer_booking_cancelled_by_staff'',
        ''bookingRequestId'',b.id,
        ''scheduleEntryId'',b.schedule_entry_id,
        ''status'',''cancelled'',
        ''reason'',nullif(btrim(p_reason),''''),
        ''vacancyId'',v_vacancy_id
      ),
      nullif(btrim(p_actor),'''')
    );
  end if;';
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

  if position('''eventType'',''customer_booking_cancelled_by_staff''' in v_def) > 0 then
    return;
  end if;

  if position(v_anchor in v_def) = 0 then
    raise exception 'expected customer booking cancellation anchor not found';
  end if;

  v_def := replace(v_def,v_anchor,v_replacement);
  execute v_def;
end
$do$;
