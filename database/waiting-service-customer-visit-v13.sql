-- ICB waiting-service v1.3: all customer_visit reasons may use is_waiting_service.
-- No new column and no backfill. This file supersedes the v1.2 function rules while preserving its schema.

-- ICB waiting-service v1.3 function baseline, superseding the v1.2 reason restriction.
-- Source derived from the deployed v1.2 functions plus the later active-app-user hardening.
-- No column/backfill change is required by v1.3.
--
-- Meaning:
--   work_orders.is_waiting_service = true only for customer_visit entries where
--   the customer waits on site until the scheduled work is completed.
--   Never infer this flag from notes, status, or stay_reason.
--
-- Existing rows are intentionally false. No inferred backfill is allowed.

alter table public.work_orders
  add column if not exists is_waiting_service boolean not null default false;

comment on column public.work_orders.is_waiting_service is
  'True only when a customer_visit customer waits on site until the scheduled work is finished. Never infer from notes, status, or stay_reason.';

-- The definitions below are the live post-migration RPC definitions.
-- They include legacy-signature compatibility wrappers so older callers keep
-- working with is_waiting_service=false while v1.2-aware callers pass it explicitly.

CREATE OR REPLACE FUNCTION public.create_schedule_registration_batch_v1(p_day date, p_items jsonb, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_failed_result jsonb := null;
  v_failed_index integer := null;
  v_index integer := 0;
  v_vehicle_id uuid;
  v_customer_id uuid;
  v_work_order_id uuid;
  v_vendor_id uuid;
  v_starts_at timestamptz;
  v_delivery_starts_at timestamptz;
  v_vehicle_ids uuid[] := '{}';
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  if p_day is null then
    raise exception 'batch day is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'batch items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 then
    return jsonb_build_object(
      'created',false,'rolledBack',true,'createdCount',0,
      'hardErrors',jsonb_build_array('登録する車両を1台以上選択してください。')
    );
  end if;
  if jsonb_array_length(p_items) > 50 then
    return jsonb_build_object(
      'created',false,'rolledBack',true,'createdCount',0,
      'hardErrors',jsonb_build_array('一度に登録できるのは50台までです。')
    );
  end if;

  begin
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_index := v_index + 1;
      v_vehicle_id := nullif(v_item->>'vehicleId','')::uuid;
      v_customer_id := nullif(v_item->>'customerId','')::uuid;
      v_vendor_id := nullif(v_item->>'vendorId','')::uuid;
      v_starts_at := nullif(v_item->>'startsAt','')::timestamptz;
      v_delivery_starts_at := nullif(v_item->>'deliveryStartsAt','')::timestamptz;

      if v_vehicle_id is null then
        v_failed_index := v_index;
        v_failed_result := jsonb_build_object(
          'created',false,
          'hardErrors',jsonb_build_array('既存車両を選択してください。')
        );
        raise exception 'batch_item_failed';
      end if;

      if v_vehicle_id = any(v_vehicle_ids) then
        v_failed_index := v_index;
        v_failed_result := jsonb_build_object(
          'created',false,
          'hardErrors',jsonb_build_array('同じ車両がまとめ登録内で重複しています。')
        );
        raise exception 'batch_item_failed';
      end if;
      v_vehicle_ids := array_append(v_vehicle_ids,v_vehicle_id);

      if v_starts_at is null
         or (v_starts_at at time zone 'Asia/Tokyo')::date <> p_day then
        v_failed_index := v_index;
        v_failed_result := jsonb_build_object(
          'created',false,
          'hardErrors',jsonb_build_array('まとめ登録の入庫・作業日は全車両で同じ日にしてください。')
        );
        raise exception 'batch_item_failed';
      end if;

      v_result := public.create_schedule_registration_v2(
        p_customer_name => coalesce(nullif(btrim(v_item->>'customerName'),''),'顧客未割当'),
        p_entry_type => v_item->>'entryType',
        p_reason => v_item->>'reason',
        p_starts_at => v_starts_at,
        p_ends_at => nullif(v_item->>'endsAt','')::timestamptz,
        p_is_waiting_service => coalesce((v_item->>'isWaitingService')::boolean,false),
        p_customer_type => coalesce(nullif(v_item->>'customerType',''),'individual'),
        p_company_name => nullif(v_item->>'companyName',''),
        p_phone => nullif(v_item->>'phone',''),
        p_schedule_display_name => nullif(v_item->>'scheduleDisplayName',''),
        p_registration_number => nullif(v_item->>'registrationNumber',''),
        p_registration_last4 => nullif(v_item->>'registrationLast4',''),
        p_maker => nullif(v_item->>'maker',''),
        p_model => nullif(v_item->>'model',''),
        p_staff_id => nullif(v_item->>'staffId','')::uuid,
        p_notes => nullif(v_item->>'notes',''),
        p_inspection_schedule_type => nullif(v_item->>'inspectionScheduleType',''),
        p_print_time_mode => coalesce(nullif(v_item->>'printTimeMode',''),'exact'),
        p_is_urgent => coalesce((v_item->>'isUrgent')::boolean,false),
        p_needs_loaner => coalesce((v_item->>'needsLoaner')::boolean,false),
        p_existing_customer_id => v_customer_id,
        p_existing_vehicle_id => v_vehicle_id,
        p_add_delivery => coalesce((v_item->>'addDelivery')::boolean,false),
        p_delivery_starts_at => v_delivery_starts_at,
        p_delivery_ends_at => nullif(v_item->>'deliveryEndsAt','')::timestamptz,
        p_delivery_print_time_mode => nullif(v_item->>'deliveryPrintTimeMode',''),
        p_allow_warning_override => p_allow_warning_override
      );

      if not coalesce((v_result->>'created')::boolean,false) then
        v_failed_index := v_index;
        v_failed_result := v_result;
        raise exception 'batch_item_failed';
      end if;

      v_work_order_id := nullif(v_result->>'workOrderId','')::uuid;

      if v_work_order_id is not null
         and (v_vendor_id is not null or nullif(btrim(v_item->>'vendorName'),'') is not null) then
        perform public.set_work_order_assignment(
          v_work_order_id,
          nullif(v_item->>'staffId','')::uuid,
          v_vendor_id,
          case when v_vendor_id is null then nullif(btrim(v_item->>'vendorName'),'') else null end,
          'schedule-batch'
        );
      end if;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'index',v_index,
          'vehicleId',v_vehicle_id,
          'customerId',v_customer_id,
          'workOrderId',v_result->>'workOrderId',
          'scheduleEntryId',v_result->>'scheduleEntryId',
          'deliveryScheduleEntryId',v_result->>'deliveryScheduleEntryId',
          'isWaitingService',v_result->'isWaitingService'
        )
      );
    end loop;

    return jsonb_build_object(
      'created',true,
      'rolledBack',false,
      'createdCount',jsonb_array_length(v_results),
      'items',v_results,
      'warnings','[]'::jsonb,
      'hardErrors','[]'::jsonb
    );
  exception
    when others then
      if sqlerrm = 'batch_item_failed' then
        return jsonb_build_object(
          'created',false,
          'rolledBack',true,
          'createdCount',0,
          'failedIndex',v_failed_index,
          'failure',coalesce(v_failed_result,'{}'::jsonb),
          'warnings',coalesce(v_failed_result->'warnings','[]'::jsonb),
          'hardErrors',coalesce(v_failed_result->'hardErrors','[]'::jsonb),
          'overrideRequired',coalesce((v_failed_result->>'overrideRequired')::boolean,false)
        );
      end if;
      raise;
  end;
end;
$function$


CREATE OR REPLACE FUNCTION public.create_schedule_registration_batch_v1(p_vehicle_ids uuid[], p_entry_type text, p_reason text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_staff_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_inspection_schedule_type text DEFAULT NULL::text, p_print_time_mode text DEFAULT 'exact'::text, p_is_urgent boolean DEFAULT false, p_needs_loaner boolean DEFAULT false, p_vendor_id uuid DEFAULT NULL::uuid, p_vendor_name text DEFAULT NULL::text, p_add_delivery boolean DEFAULT false, p_delivery_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_print_time_mode text DEFAULT NULL::text, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_vehicle_id uuid;
  v_customer_id uuid;
  v_expected_customer_id uuid;
  v_customer public.customers%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_result jsonb;
  v_failure jsonb;
  v_results jsonb := '[]'::jsonb;
  v_work_order_id uuid;
  v_unique_count integer;
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  if p_vehicle_ids is null or coalesce(array_length(p_vehicle_ids, 1), 0) < 1 then
    raise exception 'at least one vehicle is required';
  end if;

  select count(distinct x) into v_unique_count
  from unnest(p_vehicle_ids) as t(x);

  if v_unique_count <> array_length(p_vehicle_ids, 1) then
    raise exception 'duplicate vehicle ids are not allowed';
  end if;
  if v_unique_count > 20 then
    raise exception 'too many vehicles in one batch';
  end if;

  -- Validate and lock the selected vehicles before starting the atomic insert block.
  foreach v_vehicle_id in array p_vehicle_ids loop
    select * into v_vehicle
    from public.vehicles
    where id = v_vehicle_id
    for update;

    if not found then
      raise exception 'existing vehicle not found';
    end if;
    if v_vehicle.customer_id is null then
      raise exception 'selected vehicle has no customer';
    end if;

    if v_expected_customer_id is null then
      v_expected_customer_id := v_vehicle.customer_id;
    elsif v_vehicle.customer_id is distinct from v_expected_customer_id then
      raise exception 'all selected vehicles must belong to the same customer';
    end if;
  end loop;

  select * into v_customer
  from public.customers
  where id = v_expected_customer_id
  for update;

  if not found then
    raise exception 'existing customer not found';
  end if;

  -- This block is a PL/pgSQL subtransaction. If any vehicle cannot be created,
  -- raise and catch our own exception so every earlier insert in the batch rolls back.
  begin
    foreach v_vehicle_id in array p_vehicle_ids loop
      select * into v_vehicle
      from public.vehicles
      where id = v_vehicle_id;

      v_result := public.create_schedule_registration_v2(
        p_customer_name => coalesce(nullif(btrim(v_customer.name), ''), nullif(btrim(v_customer.company_name), ''), '顧客'),
        p_entry_type => p_entry_type,
        p_reason => p_reason,
        p_starts_at => p_starts_at,
        p_ends_at => p_ends_at,
        p_customer_type => coalesce(nullif(v_customer.customer_type, ''), 'individual'),
        p_company_name => v_customer.company_name,
        p_phone => v_customer.phone,
        p_schedule_display_name => v_customer.schedule_display_name,
        p_registration_number => v_vehicle.registration_number,
        p_registration_last4 => coalesce(v_vehicle.registration_number_last4, v_vehicle.registration_last4),
        p_maker => v_vehicle.maker,
        p_model => v_vehicle.model,
        p_staff_id => p_staff_id,
        p_notes => p_notes,
        p_inspection_schedule_type => p_inspection_schedule_type,
        p_print_time_mode => p_print_time_mode,
        p_is_urgent => p_is_urgent,
        p_needs_loaner => p_needs_loaner,
        p_existing_customer_id => v_expected_customer_id,
        p_existing_vehicle_id => v_vehicle_id,
        p_add_delivery => p_add_delivery,
        p_delivery_starts_at => p_delivery_starts_at,
        p_delivery_ends_at => p_delivery_ends_at,
        p_delivery_print_time_mode => p_delivery_print_time_mode,
        p_allow_warning_override => p_allow_warning_override
      );

      if not coalesce((v_result->>'created')::boolean, false) then
        v_failure := v_result || jsonb_build_object(
          'batchCreated', false,
          'failedVehicleId', v_vehicle_id,
          'vehicleCount', v_unique_count
        );
        raise exception using errcode = 'P0001', message = 'batch registration rejected';
      end if;

      v_work_order_id := nullif(v_result->>'workOrderId', '')::uuid;
      if v_work_order_id is not null then
        perform public.set_work_order_assignment(
          v_work_order_id,
          p_staff_id,
          case when p_reason in ('板金塗装','一般整備') then p_vendor_id else null end,
          case when p_reason in ('板金塗装','一般整備') then nullif(btrim(p_vendor_name), '') else null end,
          'schedule-registration-batch'
        );
      end if;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'vehicleId', v_vehicle_id,
          'workOrderId', v_result->>'workOrderId',
          'scheduleEntryId', v_result->>'scheduleEntryId',
          'deliveryScheduleEntryId', v_result->>'deliveryScheduleEntryId'
        )
      );
    end loop;
  exception
    when sqlstate 'P0001' then
      return coalesce(v_failure, jsonb_build_object(
        'batchCreated', false,
        'created', false,
        'allowed', false,
        'hardErrors', jsonb_build_array('複数台の一括登録を完了できませんでした。'),
        'warnings', '[]'::jsonb,
        'overrideRequired', false
      ));
  end;

  return jsonb_build_object(
    'batchCreated', true,
    'created', true,
    'allowed', true,
    'vehicleCount', v_unique_count,
    'customerId', v_expected_customer_id,
    'items', v_results,
    'warnings', '[]'::jsonb,
    'hardErrors', '[]'::jsonb,
    'overrideRequired', false
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.create_schedule_registration_v2(p_customer_name text, p_entry_type text, p_reason text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_customer_type text DEFAULT 'individual'::text, p_company_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_schedule_display_name text DEFAULT NULL::text, p_registration_number text DEFAULT NULL::text, p_registration_last4 text DEFAULT NULL::text, p_maker text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_inspection_schedule_type text DEFAULT NULL::text, p_print_time_mode text DEFAULT 'exact'::text, p_is_urgent boolean DEFAULT false, p_needs_loaner boolean DEFAULT false, p_existing_customer_id uuid DEFAULT NULL::uuid, p_existing_vehicle_id uuid DEFAULT NULL::uuid, p_add_delivery boolean DEFAULT false, p_delivery_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_print_time_mode text DEFAULT NULL::text, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.create_schedule_registration_v2(
    p_customer_name => p_customer_name,
    p_entry_type => p_entry_type,
    p_reason => p_reason,
    p_starts_at => p_starts_at,
    p_ends_at => p_ends_at,
    p_is_waiting_service => false,
    p_customer_type => p_customer_type,
    p_company_name => p_company_name,
    p_phone => p_phone,
    p_schedule_display_name => p_schedule_display_name,
    p_registration_number => p_registration_number,
    p_registration_last4 => p_registration_last4,
    p_maker => p_maker,
    p_model => p_model,
    p_staff_id => p_staff_id,
    p_notes => p_notes,
    p_inspection_schedule_type => p_inspection_schedule_type,
    p_print_time_mode => p_print_time_mode,
    p_is_urgent => p_is_urgent,
    p_needs_loaner => p_needs_loaner,
    p_existing_customer_id => p_existing_customer_id,
    p_existing_vehicle_id => p_existing_vehicle_id,
    p_add_delivery => p_add_delivery,
    p_delivery_starts_at => p_delivery_starts_at,
    p_delivery_ends_at => p_delivery_ends_at,
    p_delivery_print_time_mode => p_delivery_print_time_mode,
    p_allow_warning_override => p_allow_warning_override
  );
$function$


CREATE OR REPLACE FUNCTION public.create_schedule_registration_v2(p_customer_name text, p_entry_type text, p_reason text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_is_waiting_service boolean, p_customer_type text DEFAULT 'individual'::text, p_company_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_schedule_display_name text DEFAULT NULL::text, p_registration_number text DEFAULT NULL::text, p_registration_last4 text DEFAULT NULL::text, p_maker text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_inspection_schedule_type text DEFAULT NULL::text, p_print_time_mode text DEFAULT 'exact'::text, p_is_urgent boolean DEFAULT false, p_needs_loaner boolean DEFAULT false, p_existing_customer_id uuid DEFAULT NULL::uuid, p_existing_vehicle_id uuid DEFAULT NULL::uuid, p_add_delivery boolean DEFAULT false, p_delivery_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_delivery_print_time_mode text DEFAULT NULL::text, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_vehicle_customer_id uuid;
  v_work_order_id uuid;
  v_schedule_entry_id uuid;
  v_delivery_entry_id uuid;
  v_check jsonb;
  v_delivery_check jsonb;
  v_worker_name text;
  v_hard_errors jsonb;
  v_warnings jsonb;
  v_waiting_service boolean := coalesce(p_is_waiting_service,false);
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  if nullif(btrim(p_customer_name),'') is null then
    raise exception 'customer name is required';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'invalid main schedule time range';
  end if;

  if v_waiting_service
     and p_entry_type <> 'customer_visit' then
    return jsonb_build_object(
      'created',false,'allowed',false,'warnings','[]'::jsonb,
      'hardErrors',jsonb_build_array('作業待ちは「来社」の予定だけで使用できます。'),
      'overrideRequired',false
    );
  end if;

  if v_waiting_service and p_add_delivery then
    return jsonb_build_object(
      'created',false,'allowed',false,'warnings','[]'::jsonb,
      'hardErrors',jsonb_build_array('来社・作業待ちには納車予定を登録しません。'),
      'overrideRequired',false
    );
  end if;

  v_check := public.schedule_slot_check_v2(
    p_entry_type,
    p_starts_at,
    p_ends_at,
    v_waiting_service,
    p_reason,
    null,
    p_print_time_mode
  );
  v_hard_errors := coalesce(v_check->'hard_errors','[]'::jsonb);
  v_warnings := coalesce(v_check->'warnings','[]'::jsonb);

  if not coalesce((v_check->>'allowed')::boolean,false)
     or jsonb_array_length(v_hard_errors) > 0 then
    return jsonb_build_object(
      'created',false,'allowed',false,'warnings',v_warnings,
      'hardErrors',v_hard_errors,'overrideRequired',false
    );
  end if;

  if coalesce((v_check->>'override_required')::boolean,false)
     and not p_allow_warning_override then
    return jsonb_build_object(
      'created',false,'allowed',true,'warnings',v_warnings,
      'hardErrors','[]'::jsonb,'overrideRequired',true
    );
  end if;

  if p_add_delivery and p_entry_type <> 'delivery' then
    if p_delivery_starts_at is null or p_delivery_ends_at is null then
      raise exception 'delivery time is required';
    end if;
    if p_delivery_ends_at <= p_delivery_starts_at then
      raise exception 'invalid delivery time range';
    end if;
    if (
      coalesce(nullif(btrim(p_delivery_print_time_mode),''),'exact') = 'exact'
      and p_delivery_starts_at < p_ends_at
    ) or (
      coalesce(nullif(btrim(p_delivery_print_time_mode),''),'exact') <> 'exact'
      and (p_delivery_starts_at at time zone 'Asia/Tokyo')::date
          < (p_starts_at at time zone 'Asia/Tokyo')::date
    ) then
      return jsonb_build_object(
        'created',false,'allowed',false,
        'warnings','[]'::jsonb,
        'hardErrors',jsonb_build_array('納車予定は入庫・作業予定の終了後に設定してください。'),
        'overrideRequired',false
      );
    end if;

    v_delivery_check := public.schedule_slot_check_v2(
      'delivery',
      p_delivery_starts_at,
      p_delivery_ends_at,
      false,
      p_reason,
      null,
      coalesce(p_delivery_print_time_mode,'exact')
    );
    v_hard_errors := v_hard_errors || coalesce(v_delivery_check->'hard_errors','[]'::jsonb);
    v_warnings := v_warnings || coalesce(v_delivery_check->'warnings','[]'::jsonb);

    if not coalesce((v_delivery_check->>'allowed')::boolean,false)
       or jsonb_array_length(v_hard_errors) > 0 then
      return jsonb_build_object(
        'created',false,'allowed',false,'warnings',v_warnings,
        'hardErrors',v_hard_errors,'overrideRequired',false
      );
    end if;

    if coalesce((v_delivery_check->>'override_required')::boolean,false)
       and not p_allow_warning_override then
      return jsonb_build_object(
        'created',false,'allowed',true,'warnings',v_warnings,
        'hardErrors','[]'::jsonb,'overrideRequired',true
      );
    end if;
  end if;

  if p_staff_id is not null then
    select display_name into v_worker_name
    from public.staff_members
    where id = p_staff_id and is_active = true;
    if v_worker_name is null then
      raise exception 'active staff member not found';
    end if;
  end if;

  if p_existing_vehicle_id is not null then
    select customer_id into v_vehicle_customer_id
    from public.vehicles
    where id = p_existing_vehicle_id
    for update;
    if not found then
      raise exception 'existing vehicle not found';
    end if;
    if p_existing_customer_id is not null
       and v_vehicle_customer_id is distinct from p_existing_customer_id then
      raise exception 'existing vehicle does not belong to selected customer';
    end if;
    v_vehicle_id := p_existing_vehicle_id;
    v_customer_id := v_vehicle_customer_id;
  elsif p_existing_customer_id is not null then
    select id into v_customer_id
    from public.customers
    where id = p_existing_customer_id
    for update;
    if not found then
      raise exception 'existing customer not found';
    end if;

    insert into public.vehicles(
      customer_id, registration_number, registration_last4,
      registration_number_last4, maker, model, is_provisional, created_from
    )
    values(
      v_customer_id,
      nullif(btrim(p_registration_number),''),
      nullif(btrim(p_registration_last4),''),
      nullif(btrim(p_registration_last4),''),
      nullif(btrim(p_maker),''),
      nullif(btrim(p_model),''),
      true,
      'manual_schedule'
    )
    returning id into v_vehicle_id;
  else
    insert into public.customers(
      customer_type, name, company_name, phone, schedule_display_name,
      is_provisional, created_from
    )
    values(
      coalesce(nullif(p_customer_type,''),'individual'),
      btrim(p_customer_name),
      nullif(btrim(p_company_name),''),
      nullif(btrim(p_phone),''),
      nullif(btrim(p_schedule_display_name),''),
      true,
      'manual_schedule'
    )
    returning id into v_customer_id;

    insert into public.vehicles(
      customer_id, registration_number, registration_last4,
      registration_number_last4, maker, model, is_provisional, created_from
    )
    values(
      v_customer_id,
      nullif(btrim(p_registration_number),''),
      nullif(btrim(p_registration_last4),''),
      nullif(btrim(p_registration_last4),''),
      nullif(btrim(p_maker),''),
      nullif(btrim(p_model),''),
      true,
      'manual_schedule'
    )
    returning id into v_vehicle_id;
  end if;

  insert into public.work_orders(
    vehicle_id, reason, worker_name, worker_staff_id, notes, scheduled_at,
    inspection_schedule_type, is_urgent, needs_loaner, is_waiting_service,
    planned_delivery_at, planned_delivery_date
  )
  values(
    v_vehicle_id, p_reason, v_worker_name, p_staff_id,
    nullif(btrim(p_notes),''), p_starts_at,
    p_inspection_schedule_type, coalesce(p_is_urgent,false), coalesce(p_needs_loaner,false),
    v_waiting_service,
    case when p_add_delivery and p_entry_type <> 'delivery' then p_delivery_starts_at else null end,
    case when p_add_delivery and p_entry_type <> 'delivery'
      then (p_delivery_starts_at at time zone 'Asia/Tokyo')::date else null end
  )
  returning id into v_work_order_id;

  insert into public.schedule_entries(
    vehicle_id, work_order_id, entry_type, starts_at, ends_at, notes, print_time_mode
  )
  values(
    v_vehicle_id, v_work_order_id, p_entry_type, p_starts_at, p_ends_at,
    nullif(btrim(p_notes),''), p_print_time_mode
  )
  returning id into v_schedule_entry_id;

  if p_add_delivery and p_entry_type <> 'delivery' then
    insert into public.schedule_entries(
      vehicle_id, work_order_id, entry_type, starts_at, ends_at, notes, print_time_mode
    )
    values(
      v_vehicle_id, v_work_order_id, 'delivery',
      p_delivery_starts_at, p_delivery_ends_at,
      nullif(btrim(p_notes),''),
      coalesce(nullif(btrim(p_delivery_print_time_mode),''),'exact')
    )
    returning id into v_delivery_entry_id;
  end if;

  return jsonb_build_object(
    'created',true,'allowed',true,'warnings',v_warnings,
    'hardErrors','[]'::jsonb,'overrideRequired',false,
    'customerId',v_customer_id,'vehicleId',v_vehicle_id,
    'workOrderId',v_work_order_id,'scheduleEntryId',v_schedule_entry_id,
    'deliveryScheduleEntryId',v_delivery_entry_id,
    'isWaitingService',v_waiting_service,
    'reusedCustomer',p_existing_customer_id is not null or p_existing_vehicle_id is not null,
    'reusedVehicle',p_existing_vehicle_id is not null
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.reschedule_schedule_entry_v2(p_entry_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_is_waiting_service boolean, p_print_time_mode text DEFAULT NULL::text, p_stay_reason text DEFAULT NULL::text, p_planned_delivery_date date DEFAULT NULL::date, p_actor text DEFAULT NULL::text, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  e public.schedule_entries%rowtype;
  w public.work_orders%rowtype;
  lr public.loaner_reservations%rowtype;
  v_check jsonb;
  v_warnings jsonb;
  v_hard_errors jsonb;
  v_reason text;
  v_stay_reason text;
  v_waiting_service boolean := false;
  v_has_customer_visit boolean := false;
  v_has_loaner boolean := false;
  v_loaner_starts_at timestamptz;
  v_loaner_ends_at timestamptz;
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  select * into e
  from public.schedule_entries
  where id=p_entry_id
  for update;

  if not found then
    raise exception 'schedule entry not found';
  end if;

  if e.work_order_id is not null then
    select * into w
    from public.work_orders
    where id=e.work_order_id
    for update;

    v_reason := w.reason;
    v_waiting_service := coalesce(p_is_waiting_service,w.is_waiting_service,false);

    select exists(
      select 1
      from public.schedule_entries se
      where se.work_order_id=e.work_order_id
        and se.entry_type='customer_visit'
    ) into v_has_customer_visit;

    if v_waiting_service
       and not v_has_customer_visit then
      return jsonb_build_object(
        'updated',false,'allowed',false,'warnings','[]'::jsonb,
        'hardErrors',jsonb_build_array('作業待ちは「来社」の予定だけで使用できます。'),
        'overrideRequired',false
      );
    end if;

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
        and p_planned_delivery_date is distinct from w.planned_delivery_date
        and not v_waiting_service then
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

  v_check := public.schedule_slot_check_v2(
    e.entry_type,
    p_starts_at,
    p_ends_at,
    v_waiting_service,
    v_reason,
    e.id,
    coalesce(nullif(btrim(p_print_time_mode),''),e.print_time_mode,'exact')
  );
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

    if v_waiting_service then
      delete from public.schedule_entries
      where work_order_id=e.work_order_id
        and entry_type='delivery'
        and id<>e.id;
    end if;

    update public.work_orders
    set scheduled_at = case when e.entry_type in ('pickup','customer_visit','onsite_repair') then p_starts_at else scheduled_at end,
        planned_pickup_at = case when e.entry_type='pickup' then p_starts_at else planned_pickup_at end,
        planned_delivery_at = case
          when v_waiting_service then null
          when e.entry_type='delivery' then p_starts_at
          else planned_delivery_at
        end,
        stay_reason = v_stay_reason,
        planned_delivery_date = case
          when v_waiting_service then null
          else p_planned_delivery_date
        end,
        is_waiting_service = v_waiting_service,
        last_schedule_change_at=now(),
        updated_at=now()
    where id=e.work_order_id;

    if v_has_loaner
       and (lr.starts_at is distinct from v_loaner_starts_at
            or lr.ends_at is distinct from v_loaner_ends_at) then
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
        'is_waiting_service',w.is_waiting_service,
        'loanerReservationId',case when v_has_loaner then lr.id else null end,
        'loanerStartsAt',case when v_has_loaner then lr.starts_at else null end,
        'loanerEndsAt',case when v_has_loaner then lr.ends_at else null end
      ),
      jsonb_build_object(
        'eventType','schedule_entry_rescheduled',
        'scheduleEntryId',e.id,'entryType',e.entry_type,
        'startsAt',p_starts_at,'endsAt',p_ends_at,
        'printTimeMode',coalesce(nullif(btrim(p_print_time_mode),''),e.print_time_mode),
        'is_waiting_service',v_waiting_service,
        'loanerReservationId',case when v_has_loaner then lr.id else null end,
        'loanerStartsAt',case when v_has_loaner then v_loaner_starts_at else null end,
        'loanerEndsAt',case when v_has_loaner then v_loaner_ends_at else null end
      ),
      nullif(btrim(p_actor),'')
    );

    if w.stay_reason is distinct from v_stay_reason
       or w.planned_delivery_date is distinct from (
         case when v_waiting_service then null else p_planned_delivery_date end
       )
       or w.is_waiting_service is distinct from v_waiting_service then
      insert into public.work_order_schedule_changes(
        work_order_id,change_type,old_value,new_value,changed_by
      )
      values(
        e.work_order_id,'OTHER',
        jsonb_build_object(
          'stay_reason',w.stay_reason,
          'planned_delivery_date',w.planned_delivery_date,
          'is_waiting_service',w.is_waiting_service
        ),
        jsonb_build_object(
          'stay_reason',v_stay_reason,
          'planned_delivery_date',
            case when v_waiting_service then null else p_planned_delivery_date end,
          'is_waiting_service',v_waiting_service
        ),
        nullif(btrim(p_actor),'')
      );
    end if;
  end if;

  return jsonb_build_object(
    'updated',true,'allowed',true,'warnings',v_warnings,
    'hardErrors','[]'::jsonb,'overrideRequired',false,
    'scheduleEntryId',e.id,'workOrderId',e.work_order_id,
    'isWaitingService',v_waiting_service,
    'loanerSynced',v_has_loaner
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.reschedule_schedule_entry_v2(p_entry_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_print_time_mode text DEFAULT NULL::text, p_stay_reason text DEFAULT NULL::text, p_planned_delivery_date date DEFAULT NULL::date, p_actor text DEFAULT NULL::text, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_waiting boolean := null;
begin
  select wo.is_waiting_service
  into v_waiting
  from public.schedule_entries se
  left join public.work_orders wo on wo.id=se.work_order_id
  where se.id=p_entry_id;

  return public.reschedule_schedule_entry_v2(
    p_entry_id => p_entry_id,
    p_starts_at => p_starts_at,
    p_ends_at => p_ends_at,
    p_is_waiting_service => coalesce(v_waiting,false),
    p_print_time_mode => p_print_time_mode,
    p_stay_reason => p_stay_reason,
    p_planned_delivery_date => p_planned_delivery_date,
    p_actor => p_actor,
    p_allow_warning_override => p_allow_warning_override
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.schedule_slot_check_v2(p_entry_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_is_waiting_service boolean, p_reason text DEFAULT NULL::text, p_exclude_entry_id uuid DEFAULT NULL::uuid, p_print_time_mode text DEFAULT 'exact'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_warnings jsonb;
  v_mode text := coalesce(nullif(btrim(p_print_time_mode),''),'exact');
  v_conflicts integer := 0;
begin
  v_result := public.schedule_slot_check(
    p_entry_type, p_starts_at, p_ends_at, p_reason, p_exclude_entry_id
  );

  select coalesce(jsonb_agg(to_jsonb(warning_text)), '[]'::jsonb)
  into v_warnings
  from jsonb_array_elements_text(coalesce(v_result->'warnings','[]'::jsonb)) as t(warning_text)
  where warning_text <> '同じ区分の予定が重複しています'
    and warning_text <> '来社予定が重複しています'
    and warning_text <> '来社・作業待ちが同じ時刻に重複しています'
    and warning_text <> '来社・作業待ちが同じ時刻に重複しています'
    and not (
      v_mode <> 'exact'
      and warning_text = '来社予約は通常60分枠、17:00受付のみ30分枠です'
    );

  if v_mode = 'exact'
     and p_entry_type = 'customer_visit'
     and coalesce(p_is_waiting_service,false) then
    select count(*)::int
    into v_conflicts
    from public.schedule_entries se
    join public.work_orders wo on wo.id = se.work_order_id
    where (p_exclude_entry_id is null or se.id <> p_exclude_entry_id)
      and se.entry_type = 'customer_visit'
      and coalesce(nullif(btrim(se.print_time_mode),''),'exact') = 'exact'
      and se.starts_at = p_starts_at
      and wo.is_waiting_service = true
      and wo.status <> 'cancelled';

    if v_conflicts > 0 then
      v_warnings := v_warnings || jsonb_build_array(
        '来社・作業待ちが同じ時刻に重複しています'
      );
    end if;
  end if;

  return v_result || jsonb_build_object(
    'warnings', v_warnings,
    'override_required', jsonb_array_length(v_warnings) > 0,
    'conflicts', v_conflicts
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.schedule_slot_check_v2(p_entry_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_reason text DEFAULT NULL::text, p_exclude_entry_id uuid DEFAULT NULL::uuid, p_print_time_mode text DEFAULT 'exact'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.schedule_slot_check_v2(
    p_entry_type,
    p_starts_at,
    p_ends_at,
    false,
    p_reason,
    p_exclude_entry_id,
    p_print_time_mode
  );
$function$


CREATE OR REPLACE FUNCTION public.schedule_time_availability(p_day date, p_entry_type text, p_is_waiting_service boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_payload jsonb;
  v_option jsonb;
  v_check jsonb;
  v_options jsonb := '[]'::jsonb;
  v_status text;
begin
  v_payload := public.schedule_time_options(p_day, p_entry_type);

  for v_option in
    select value
    from jsonb_array_elements(coalesce(v_payload->'options','[]'::jsonb))
  loop
    v_check := public.schedule_slot_check_v2(
      p_entry_type,
      (v_option->>'startsAt')::timestamptz,
      (v_option->>'endsAt')::timestamptz,
      coalesce(p_is_waiting_service,false),
      p_reason,
      null,
      coalesce(v_option->>'mode','exact')
    );

    v_status := case
      when not coalesce((v_check->>'allowed')::boolean,false) then 'blocked'
      when coalesce((v_check->>'override_required')::boolean,false) then 'warning'
      else 'open'
    end;

    v_options := v_options || jsonb_build_array(
      v_option || jsonb_build_object(
        'availability', v_status,
        'warnings', coalesce(v_check->'warnings','[]'::jsonb),
        'hardErrors', coalesce(v_check->'hard_errors','[]'::jsonb),
        'conflicts', coalesce((v_check->>'conflicts')::int,0)
      )
    );
  end loop;

  return v_payload || jsonb_build_object('options', v_options);
end;
$function$


CREATE OR REPLACE FUNCTION public.schedule_time_availability(p_day date, p_entry_type text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.schedule_time_availability(
    p_day,
    p_entry_type,
    false,
    p_reason
  );
$function$


-- Extended v1.2 signatures are never callable by public/anon.
revoke all on function public.schedule_slot_check_v2(
  text,timestamptz,timestamptz,boolean,text,uuid,text
) from public, anon;
grant execute on function public.schedule_slot_check_v2(
  text,timestamptz,timestamptz,boolean,text,uuid,text
) to authenticated, service_role;

revoke all on function public.schedule_time_availability(
  date,text,boolean,text
) from public, anon;
grant execute on function public.schedule_time_availability(
  date,text,boolean,text
) to authenticated, service_role;

revoke all on function public.create_schedule_registration_v2(
  text,text,text,timestamptz,timestamptz,boolean,text,text,text,text,text,text,text,text,uuid,text,text,text,boolean,boolean,uuid,uuid,boolean,timestamptz,timestamptz,text,boolean
) from public, anon;
grant execute on function public.create_schedule_registration_v2(
  text,text,text,timestamptz,timestamptz,boolean,text,text,text,text,text,text,text,text,uuid,text,text,text,boolean,boolean,uuid,uuid,boolean,timestamptz,timestamptz,text,boolean
) to authenticated, service_role;

revoke all on function public.reschedule_schedule_entry_v2(
  uuid,timestamptz,timestamptz,boolean,text,text,date,text,boolean
) from public, anon;
grant execute on function public.reschedule_schedule_entry_v2(
  uuid,timestamptz,timestamptz,boolean,text,text,date,text,boolean
) to authenticated, service_role;
