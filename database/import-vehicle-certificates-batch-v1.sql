-- Bulk import vehicle-certificate PDF parse results in one transaction.
-- Additive migration. Apply before deploying the bulk import UI.
create or replace function public.import_vehicle_certificates_batch_v1(
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_customer_name text;
  v_customer_address text;
  v_registration text;
  v_last4 text;
  v_chassis text;
  v_maker text;
  v_model text;
  v_fuel text;
  v_weight numeric;
  v_created_customers integer := 0;
  v_inserted_vehicles integer := 0;
  v_updated_vehicles integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'at least one item is required';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items in one import';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    v_customer_id := null;
    v_vehicle_id := null;
    v_customer_name := nullif(btrim(v_item->>'customerName'), '');
    v_customer_address := nullif(btrim(v_item->>'customerAddress'), '');
    v_registration := nullif(btrim(v_item->>'registrationNumber'), '');
    v_last4 := nullif(btrim(v_item->>'registrationLast4'), '');
    v_chassis := nullif(btrim(v_item->>'chassisNumber'), '');
    v_maker := nullif(btrim(v_item->>'maker'), '');
    v_model := nullif(btrim(v_item->>'model'), '');
    v_fuel := nullif(btrim(v_item->>'fuelType'), '');
    v_weight := nullif(v_item->>'vehicleWeightKg', '')::numeric;

    if v_customer_name is null then
      raise exception 'customer name is required at item %', v_index;
    end if;
    if v_registration is null and v_chassis is null then
      raise exception 'registration or chassis number is required at item %', v_index;
    end if;

    -- Exact normalized customer match. Address is used when available so same names
    -- at different addresses do not get merged accidentally.
    select c.id into v_customer_id
    from public.customers c
    where lower(regexp_replace(coalesce(c.name, ''), '[[:space:]　]+', '', 'g'))
          = lower(regexp_replace(v_customer_name, '[[:space:]　]+', '', 'g'))
      and (
        v_customer_address is null
        or lower(regexp_replace(coalesce(c.address, ''), '[[:space:]　]+', '', 'g'))
           = lower(regexp_replace(v_customer_address, '[[:space:]　]+', '', 'g'))
      )
    order by
      case when v_customer_address is not null
             and lower(regexp_replace(coalesce(c.address, ''), '[[:space:]　]+', '', 'g'))
                 = lower(regexp_replace(v_customer_address, '[[:space:]　]+', '', 'g'))
           then 0 else 1 end,
      c.created_at
    limit 1
    for update;

    if v_customer_id is null then
      insert into public.customers(
        customer_type, name, address, is_provisional, created_from, updated_at
      )
      values(
        'individual', v_customer_name, v_customer_address, false, 'bulk_pdf_import', now()
      )
      returning id into v_customer_id;
      v_created_customers := v_created_customers + 1;
    elsif v_customer_address is not null then
      update public.customers
      set address = coalesce(nullif(btrim(address), ''), v_customer_address),
          updated_at = now()
      where id = v_customer_id;
    end if;

    -- Prefer chassis number for duplicate detection, then registration number.
    select v.id into v_vehicle_id
    from public.vehicles v
    where (
      v_chassis is not null
      and regexp_replace(upper(coalesce(v.chassis_number, '')), '[[:space:]　]+', '', 'g')
          = regexp_replace(upper(v_chassis), '[[:space:]　]+', '', 'g')
    ) or (
      v_registration is not null
      and regexp_replace(upper(coalesce(v.registration_number, '')), '[[:space:]　・･]+', '', 'g')
          = regexp_replace(upper(v_registration), '[[:space:]　・･]+', '', 'g')
    )
    order by case when v_chassis is not null and v.chassis_number is not null then 0 else 1 end, v.created_at
    limit 1
    for update;

    if v_vehicle_id is null then
      insert into public.vehicles(
        customer_id,
        vehicle_number,
        registration_number,
        registration_last4,
        registration_number_last4,
        chassis_number,
        maker,
        model,
        fuel_type,
        vehicle_weight,
        first_registration,
        inspection_expiry_date,
        engine_model,
        usage_category,
        body_type,
        gross_vehicle_weight_kg,
        curb_weight_kg,
        seating_capacity,
        inspection_certificate_number,
        user_name_snapshot,
        certificate_fields,
        front_front_axle_weight_kg,
        front_rear_axle_weight_kg,
        rear_front_axle_weight_kg,
        rear_rear_axle_weight_kg,
        is_provisional,
        created_from,
        updated_at
      )
      values(
        v_customer_id,
        coalesce(v_chassis, v_registration),
        v_registration,
        v_last4,
        v_last4,
        v_chassis,
        v_maker,
        v_model,
        v_fuel,
        v_weight,
        nullif(btrim(v_item->>'firstRegistration'), ''),
        nullif(v_item->>'inspectionExpiryDate', '')::date,
        nullif(btrim(v_item->>'engineModel'), ''),
        nullif(btrim(v_item->>'usageCategory'), ''),
        nullif(btrim(v_item->>'bodyType'), ''),
        nullif(v_item->>'grossVehicleWeightKg', '')::integer,
        nullif(v_item->>'curbWeightKg', '')::integer,
        nullif(v_item->>'seatingCapacity', '')::integer,
        nullif(btrim(v_item->>'documentNumber'), ''),
        v_customer_name,
        coalesce(v_item->'certificateFields', '{}'::jsonb),
        nullif(v_item->>'frontFrontAxleWeightKg', '')::integer,
        nullif(v_item->>'frontRearAxleWeightKg', '')::integer,
        nullif(v_item->>'rearFrontAxleWeightKg', '')::integer,
        nullif(v_item->>'rearRearAxleWeightKg', '')::integer,
        false,
        'bulk_pdf_import',
        now()
      )
      returning id into v_vehicle_id;
      v_inserted_vehicles := v_inserted_vehicles + 1;
    else
      update public.vehicles
      set customer_id = coalesce(customer_id, v_customer_id),
          vehicle_number = coalesce(nullif(v_chassis, ''), nullif(v_registration, ''), vehicle_number),
          registration_number = coalesce(v_registration, registration_number),
          registration_last4 = coalesce(v_last4, registration_last4),
          registration_number_last4 = coalesce(v_last4, registration_number_last4),
          chassis_number = coalesce(v_chassis, chassis_number),
          maker = coalesce(v_maker, maker),
          model = coalesce(v_model, model),
          fuel_type = coalesce(v_fuel, fuel_type),
          vehicle_weight = coalesce(v_weight, vehicle_weight),
          first_registration = coalesce(nullif(btrim(v_item->>'firstRegistration'), ''), first_registration),
          inspection_expiry_date = coalesce(nullif(v_item->>'inspectionExpiryDate', '')::date, inspection_expiry_date),
          engine_model = coalesce(nullif(btrim(v_item->>'engineModel'), ''), engine_model),
          usage_category = coalesce(nullif(btrim(v_item->>'usageCategory'), ''), usage_category),
          body_type = coalesce(nullif(btrim(v_item->>'bodyType'), ''), body_type),
          gross_vehicle_weight_kg = coalesce(nullif(v_item->>'grossVehicleWeightKg', '')::integer, gross_vehicle_weight_kg),
          curb_weight_kg = coalesce(nullif(v_item->>'curbWeightKg', '')::integer, curb_weight_kg),
          seating_capacity = coalesce(nullif(v_item->>'seatingCapacity', '')::integer, seating_capacity),
          inspection_certificate_number = coalesce(nullif(btrim(v_item->>'documentNumber'), ''), inspection_certificate_number),
          user_name_snapshot = coalesce(v_customer_name, user_name_snapshot),
          certificate_fields = case
            when jsonb_typeof(v_item->'certificateFields') = 'object'
              then coalesce(certificate_fields, '{}'::jsonb) || (v_item->'certificateFields')
            else certificate_fields
          end,
          front_front_axle_weight_kg = coalesce(nullif(v_item->>'frontFrontAxleWeightKg', '')::integer, front_front_axle_weight_kg),
          front_rear_axle_weight_kg = coalesce(nullif(v_item->>'frontRearAxleWeightKg', '')::integer, front_rear_axle_weight_kg),
          rear_front_axle_weight_kg = coalesce(nullif(v_item->>'rearFrontAxleWeightKg', '')::integer, rear_front_axle_weight_kg),
          rear_rear_axle_weight_kg = coalesce(nullif(v_item->>'rearRearAxleWeightKg', '')::integer, rear_rear_axle_weight_kg),
          is_provisional = false,
          updated_at = now()
      where id = v_vehicle_id;
      v_updated_vehicles := v_updated_vehicles + 1;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'index', v_index,
      'fileName', v_item->>'fileName',
      'customerId', v_customer_id,
      'vehicleId', v_vehicle_id
    ));
  end loop;

  return jsonb_build_object(
    'imported', true,
    'itemCount', jsonb_array_length(p_items),
    'createdCustomers', v_created_customers,
    'insertedVehicles', v_inserted_vehicles,
    'updatedVehicles', v_updated_vehicles,
    'items', v_results
  );
end;
$function$;

revoke all on function public.import_vehicle_certificates_batch_v1(jsonb) from public, anon;
grant execute on function public.import_vehicle_certificates_batch_v1(jsonb) to authenticated;
