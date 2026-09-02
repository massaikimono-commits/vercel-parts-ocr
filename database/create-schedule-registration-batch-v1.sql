-- Atomically register the same customer's multiple vehicles in one operation.
-- Additive migration. Apply before deploying the UI that calls this RPC.
create or replace function public.create_schedule_registration_batch_v1(
  p_vehicle_ids uuid[],
  p_entry_type text,
  p_reason text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_staff_id uuid default null,
  p_notes text default null,
  p_inspection_schedule_type text default null,
  p_print_time_mode text default 'exact',
  p_is_urgent boolean default false,
  p_needs_loaner boolean default false,
  p_vendor_id uuid default null,
  p_vendor_name text default null,
  p_add_delivery boolean default false,
  p_delivery_starts_at timestamptz default null,
  p_delivery_ends_at timestamptz default null,
  p_delivery_print_time_mode text default null,
  p_allow_warning_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
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
          case when p_reason = '板金塗装' then p_vendor_id else null end,
          case when p_reason = '板金塗装' then nullif(btrim(p_vendor_name), '') else null end,
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
$function$;

revoke all on function public.create_schedule_registration_batch_v1(
  uuid[], text, text, timestamptz, timestamptz, uuid, text, text, text,
  boolean, boolean, uuid, text, boolean, timestamptz, timestamptz, text, boolean
) from public, anon;
grant execute on function public.create_schedule_registration_batch_v1(
  uuid[], text, text, timestamptz, timestamptz, uuid, text, text, text,
  boolean, boolean, uuid, text, boolean, timestamptz, timestamptz, text, boolean
) to authenticated;
