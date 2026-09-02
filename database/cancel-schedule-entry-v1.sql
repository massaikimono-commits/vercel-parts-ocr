-- Atomically cancel a staff schedule reservation and its linked resources.
create or replace function public.cancel_schedule_entry_v1(
  p_entry_id uuid,
  p_reason text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_entry public.schedule_entries%rowtype;
  v_work public.work_orders%rowtype;
  v_booking_id uuid;
  v_deleted_entries integer := 0;
  v_cancelled_loaners integer := 0;
  v_rental_pending integer := 0;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  select * into v_entry
  from public.schedule_entries
  where id = p_entry_id
  for update;
  if not found then raise exception 'schedule entry not found'; end if;

  v_booking_id := v_entry.customer_booking_request_id;
  if v_booking_id is null then
    select id into v_booking_id
    from public.customer_booking_requests
    where schedule_entry_id = v_entry.id
       or (v_entry.work_order_id is not null and work_order_id = v_entry.work_order_id)
    order by created_at desc limit 1;
  end if;

  if v_booking_id is not null then
    return public.cancel_customer_booking_by_staff(v_booking_id, p_reason, p_actor)
      || jsonb_build_object('scheduleEntryId', v_entry.id, 'cancellationMode', 'customer_booking');
  end if;

  if v_entry.work_order_id is not null then
    select * into v_work from public.work_orders
    where id = v_entry.work_order_id for update;
    if found and (
      v_work.checked_in_at is not null or v_work.work_completed
      or v_work.status in ('in_progress', 'completed')
    ) then
      raise exception 'started work cannot be cancelled as a reservation';
    end if;

    update public.loaner_reservations lr
    set rental_provider_status = 'cancellation_requested',
        provider_contacted_at = now(),
        provider_note = nullif(btrim(p_reason), ''),
        updated_at = now()
    from public.loaner_vehicles lv
    where lr.work_order_id = v_entry.work_order_id
      and lr.loaner_vehicle_id = lv.id
      and lr.status in ('reserved', 'checked_out')
      and lv.source_type = 'rental_company';
    get diagnostics v_rental_pending = row_count;

    update public.loaner_reservations lr
    set status = 'cancelled',
        assigned_by = coalesce(nullif(btrim(p_actor), ''), assigned_by),
        updated_at = now()
    from public.loaner_vehicles lv
    where lr.work_order_id = v_entry.work_order_id
      and lr.loaner_vehicle_id = lv.id
      and lr.status in ('reserved', 'checked_out')
      and lv.source_type <> 'rental_company';
    get diagnostics v_cancelled_loaners = row_count;

    update public.work_orders
    set status = 'cancelled',
        notes = case
          when nullif(btrim(p_reason), '') is null then notes
          when nullif(btrim(notes), '') is null then '予約取消: ' || btrim(p_reason)
          else notes || E'\n予約取消: ' || btrim(p_reason)
        end,
        updated_at = now()
    where id = v_entry.work_order_id;

    delete from public.schedule_entries where work_order_id = v_entry.work_order_id;
    get diagnostics v_deleted_entries = row_count;
  else
    delete from public.schedule_entries where id = v_entry.id;
    get diagnostics v_deleted_entries = row_count;
  end if;

  return jsonb_build_object(
    'cancelled', true,
    'scheduleEntryId', v_entry.id,
    'workOrderId', v_entry.work_order_id,
    'deletedScheduleEntries', v_deleted_entries,
    'cancelledLoaners', v_cancelled_loaners,
    'rentalCancellationPending', v_rental_pending > 0,
    'rentalCancellationPendingCount', v_rental_pending,
    'cancellationMode', 'staff_schedule'
  );
end;
$function$;

revoke all on function public.cancel_schedule_entry_v1(uuid, text, text) from public, anon;
grant execute on function public.cancel_schedule_entry_v1(uuid, text, text) to authenticated;
