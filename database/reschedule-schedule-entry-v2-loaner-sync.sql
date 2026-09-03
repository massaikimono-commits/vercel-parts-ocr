-- Keep an active loaner reservation aligned with schedule changes without adding tables or a new RPC.
-- Applied to the existing Supabase project as migration: sync_loaner_period_on_schedule_reschedule.
create or replace function public.reschedule_schedule_entry_v2(
  p_entry_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_print_time_mode text default null,
  p_stay_reason text default null,
  p_planned_delivery_date date default null,
  p_actor text default null,
  p_allow_warning_override boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  e public.schedule_entries%rowtype;
  w public.work_orders%rowtype;
  lr public.loaner_reservations%rowtype;
  v_check jsonb;
  v_warnings jsonb;
  v_hard_errors jsonb;
  v_reason text;
  v_stay_reason text;
  v_has_loaner boolean := false;
  v_loaner_starts_at timestamptz;
  v_loaner_ends_at timestamptz;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  select * into e
  from public.schedule_entries
  where id=p_entry_id
  for update;

  if not found then
    raise exception 'schedule entry not found';
  end if;

  if e.work_order_id is not null then
    select * into w from public.work_orders where id=e.work_order_id for update;
    v_reason := w.reason;

    select * into lr
    from public.loaner_reservations
    where work_order_id=e.work_order_id
      and status in ('reserved','checked_out')
    order by case when status='checked_out' then 0 else 1 end, starts_at desc
    limit 1
    for update;
    v_has_loaner := found;

    if v_has_loaner then
      v_loaner_starts_at := lr.starts_at;
      v_loaner_ends_at := lr.ends_at;

      if lr.status='reserved' and e.entry_type in ('pickup','customer_visit','onsite_repair') then
        v_loaner_starts_at := p_starts_at;
      end if;

      if e.entry_type='delivery' then
        v_loaner_ends_at := p_starts_at;
      elsif w.planned_delivery_at is null
        and p_planned_delivery_date is distinct from w.planned_delivery_date then
        if p_planned_delivery_date is null then
          return jsonb_build_object(
            'updated',false,'allowed',false,'warnings','[]'::jsonb,
            'hardErrors',jsonb_build_array('代車割当中は納車予定日を未定に戻せません。返却予定を設定してください。'),
            'overrideRequired',false
          );
        end if;
        v_loaner_ends_at := (p_planned_delivery_date::timestamp + time '17:30') at time zone 'Asia/Tokyo';
      end if;

      if v_loaner_ends_at <= v_loaner_starts_at then
        return jsonb_build_object(
          'updated',false,'allowed',false,'warnings','[]'::jsonb,
          'hardErrors',jsonb_build_array('代車の返却予定が貸出開始以前です。予約日時を確認してください。'),
          'overrideRequired',false
        );
      end if;

      perform pg_advisory_xact_lock(hashtext('loaner:' || lr.loaner_vehicle_id::text));
      if exists(
        select 1
        from public.loaner_reservations other
        where other.loaner_vehicle_id=lr.loaner_vehicle_id
          and other.id<>lr.id
          and other.status in ('reserved','checked_out')
          and other.starts_at < v_loaner_ends_at
          and other.ends_at > v_loaner_starts_at
      ) then
        return jsonb_build_object(
          'updated',false,'allowed',false,'warnings','[]'::jsonb,
          'hardErrors',jsonb_build_array('変更後の期間は現在の代車予約と重複します。代車の空きを確認してください。'),
          'overrideRequired',false
        );
      end if;
    end if;
  end if;

  v_check := public.schedule_slot_check(e.entry_type,p_starts_at,p_ends_at,v_reason,e.id);
  v_hard_errors := coalesce(v_check->'hard_errors','[]'::jsonb);
  v_warnings := coalesce(v_check->'warnings','[]'::jsonb);

  if not coalesce((v_check->>'allowed')::boolean,false)
     or jsonb_array_length(v_hard_errors)>0 then
    return jsonb_build_object(
      'updated',false,'allowed',false,'warnings',v_warnings,
      'hardErrors',v_hard_errors,'overrideRequired',false
    );
  end if;

  if coalesce((v_check->>'override_required')::boolean,false)
     and not p_allow_warning_override then
    return jsonb_build_object(
      'updated',false,'allowed',true,'warnings',v_warnings,
      'hardErrors','[]'::jsonb,'overrideRequired',true
    );
  end if;

  update public.schedule_entries
  set starts_at=p_starts_at,
      ends_at=p_ends_at,
      print_time_mode=coalesce(nullif(btrim(p_print_time_mode),''),print_time_mode)
  where id=e.id;

  if e.work_order_id is not null then
    v_stay_reason := nullif(btrim(coalesce(p_stay_reason,'')),'');

    update public.work_orders
    set scheduled_at = case when e.entry_type in ('pickup','customer_visit','onsite_repair') then p_starts_at else scheduled_at end,
        planned_pickup_at = case when e.entry_type='pickup' then p_starts_at else planned_pickup_at end,
        planned_delivery_at = case when e.entry_type='delivery' then p_starts_at else planned_delivery_at end,
        stay_reason = v_stay_reason,
        planned_delivery_date = p_planned_delivery_date,
        last_schedule_change_at=now(),
        updated_at=now()
    where id=e.work_order_id;

    if v_has_loaner and (lr.starts_at is distinct from v_loaner_starts_at or lr.ends_at is distinct from v_loaner_ends_at) then
      update public.loaner_reservations
      set starts_at=v_loaner_starts_at,
          ends_at=v_loaner_ends_at,
          updated_at=now()
      where id=lr.id;
    end if;

    insert into public.work_order_schedule_changes(
      work_order_id,change_type,old_value,new_value,changed_by
    )
    values(
      e.work_order_id,'OTHER',
      jsonb_build_object(
        'eventType','schedule_entry_rescheduled',
        'scheduleEntryId',e.id,'entryType',e.entry_type,
        'startsAt',e.starts_at,'endsAt',e.ends_at,'printTimeMode',e.print_time_mode,
        'loanerReservationId',case when v_has_loaner then lr.id else null end,
        'loanerStartsAt',case when v_has_loaner then lr.starts_at else null end,
        'loanerEndsAt',case when v_has_loaner then lr.ends_at else null end
      ),
      jsonb_build_object(
        'eventType','schedule_entry_rescheduled',
        'scheduleEntryId',e.id,'entryType',e.entry_type,
        'startsAt',p_starts_at,'endsAt',p_ends_at,
        'printTimeMode',coalesce(nullif(btrim(p_print_time_mode),''),e.print_time_mode),
        'loanerReservationId',case when v_has_loaner then lr.id else null end,
        'loanerStartsAt',case when v_has_loaner then v_loaner_starts_at else null end,
        'loanerEndsAt',case when v_has_loaner then v_loaner_ends_at else null end
      ),
      nullif(btrim(p_actor),'')
    );

    if w.stay_reason is distinct from v_stay_reason
       or w.planned_delivery_date is distinct from p_planned_delivery_date then
      insert into public.work_order_schedule_changes(
        work_order_id,change_type,old_value,new_value,changed_by
      )
      values(
        e.work_order_id,'OTHER',
        jsonb_build_object('stay_reason',w.stay_reason,'planned_delivery_date',w.planned_delivery_date),
        jsonb_build_object('stay_reason',v_stay_reason,'planned_delivery_date',p_planned_delivery_date),
        nullif(btrim(p_actor),'')
      );
    end if;
  end if;

  return jsonb_build_object(
    'updated',true,'allowed',true,'warnings',v_warnings,
    'hardErrors','[]'::jsonb,'overrideRequired',false,
    'scheduleEntryId',e.id,'workOrderId',e.work_order_id,
    'loanerSynced',v_has_loaner
  );
end;
$function$;
