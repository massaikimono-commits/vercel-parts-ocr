-- Applied to the existing Supabase project on 2026-09-03.
-- Finalize rental-company cancellation safely:
-- 1) remove every linked schedule entry when approved,
-- 2) record approval/refusal in common work-order history,
-- 3) preserve existing booking-event history.
-- No table/column/constraint changes.

do $do$
declare
  v_oid oid;
  v_def text;
  v_refusal_anchor text := '    return jsonb_build_object(
      ''bookingRequestId'',b.id,
      ''reference'',b.public_reference,
      ''status'',b.status,
      ''cancelled'',false,
      ''rentalCancellationApproved'',false
    );';
  v_refusal_new text := '    if b.work_order_id is not null then
      insert into public.work_order_schedule_changes(
        work_order_id,change_type,old_value,new_value,changed_by
      )
      values(
        b.work_order_id,''OTHER'',
        jsonb_build_object(
          ''eventType'',''rental_cancellation_requested'',
          ''bookingRequestId'',b.id,
          ''status'',b.status
        ),
        jsonb_build_object(
          ''eventType'',''rental_cancellation_refused'',
          ''bookingRequestId'',b.id,
          ''status'',b.status,
          ''providerNote'',nullif(btrim(p_provider_note),'''')
        ),
        nullif(btrim(p_actor),'''')
      );
    end if;

    return jsonb_build_object(
      ''bookingRequestId'',b.id,
      ''reference'',b.public_reference,
      ''status'',b.status,
      ''cancelled'',false,
      ''rentalCancellationApproved'',false
    );';
  v_delete_anchor text := '  if b.schedule_entry_id is not null then
    delete from public.schedule_entries where id=b.schedule_entry_id;
  end if;

  if b.work_order_id is not null then';
  v_delete_new text := '  if b.work_order_id is not null then
    delete from public.schedule_entries where work_order_id=b.work_order_id;
  elsif b.schedule_entry_id is not null then
    delete from public.schedule_entries where id=b.schedule_entry_id;
  end if;

  if b.work_order_id is not null then';
  v_approve_anchor text := '  if b.work_order_id is not null then
    update public.work_orders
    set status=''cancelled'',updated_at=now()
    where id=b.work_order_id;
  end if;

  update private.customer_booking_access_tokens';
  v_approve_new text := '  if b.work_order_id is not null then
    update public.work_orders
    set status=''cancelled'',updated_at=now()
    where id=b.work_order_id;

    insert into public.work_order_schedule_changes(
      work_order_id,change_type,old_value,new_value,changed_by
    )
    values(
      b.work_order_id,''OTHER'',
      jsonb_build_object(
        ''eventType'',''rental_cancellation_requested'',
        ''bookingRequestId'',b.id,
        ''scheduleEntryId'',b.schedule_entry_id,
        ''status'',b.status,
        ''requestedStartsAt'',b.requested_starts_at
      ),
      jsonb_build_object(
        ''eventType'',''rental_cancellation_approved'',
        ''bookingRequestId'',b.id,
        ''scheduleEntryId'',b.schedule_entry_id,
        ''status'',''cancelled'',
        ''providerNote'',nullif(btrim(p_provider_note),''''),
        ''vacancyId'',v_vacancy_id
      ),
      nullif(btrim(p_actor),'''')
    );
  end if;

  update private.customer_booking_access_tokens';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='finalize_rental_company_cancellation'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'finalize_rental_company_cancellation not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('''eventType'',''rental_cancellation_refused''' in v_def)=0 then
    if position(v_refusal_anchor in v_def)=0 then raise exception 'refusal anchor not found'; end if;
    v_def := replace(v_def,v_refusal_anchor,v_refusal_new);
  end if;

  if position('delete from public.schedule_entries where work_order_id=b.work_order_id' in v_def)=0 then
    if position(v_delete_anchor in v_def)=0 then raise exception 'delete anchor not found'; end if;
    v_def := replace(v_def,v_delete_anchor,v_delete_new);
  end if;

  if position('''eventType'',''rental_cancellation_approved''' in v_def)=0 then
    if position(v_approve_anchor in v_def)=0 then raise exception 'approval anchor not found'; end if;
    v_def := replace(v_def,v_approve_anchor,v_approve_new);
  end if;

  execute v_def;
end
$do$;
