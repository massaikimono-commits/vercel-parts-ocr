-- Bulk import vehicle-certificate PDFs after the user reviews the parsed rows.
-- The RPC groups exact customer name+address matches, skips already-registered vehicles,
-- and inserts the selected rows in one transaction.
create or replace function public.bulk_import_vehicle_certificates_v1(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_count integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_customer_name text;
  v_customer_address text;
  v_customer_type text;
  v_registration text;
  v_last4 text;
  v_chassis text;
  v_existing_vehicle_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 then
    raise exception 'at least one row is required';
  end if;
  if v_count > 100 then
    raise exception 'maximum 100 rows per bulk import';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_customer_name := nullif(btrim(v_item->>'customerName'), '');
    v_customer_address := nullif(btrim(v_item->>'customerAddress'), '');
    v_customer_type := case when v_item->>'customerType' = 'company' then 'company' else 'individual' end;
    v_registration := nullif(btrim(v_item->>'registrationNumber'), '');
    v_chassis := nullif(btrim(v_item->>'chassisNumber'), '');
    v_last4 := nullif(btrim(v_item->>'registrationLast4'), '');

    if v_customer_name is null then
      raise exception 'customer name is required for every row';
    end if;
    if v_registration is null and v_chassis is null then
      raise exception 'registration number or chassis number is required for every row';
    end if;

    v_existing_vehicle_id := null;

    if v_chassis is not null then
      select id into v_existing_vehicle_id
      from public.vehicles
      where regexp_replace(upper(coalesce(chassis_number, '')), '[^A-Z0-9]', '', 'g')
            = regexp_replace(upper(v_chassis), '[^A-Z0-9]', '', 'g')
      order by updated_at desc
      limit 1;
    end if;

    if v_existing_vehicle_id is null and v_registration is not null then
      select id into v_existing_vehicle_id
      from public.vehicles
      where regexp_replace(upper(coalesce(registration_number, '')), '[[:space:]　・･-]+', '', 'g')
            = regexp_replace(upper(v_registration), '[[:space:]　・･-]+', '', 'g')
      order by updated_at desc
      limit 1;
    end if;

    if v_existing_vehicle_id is not null then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowKey', v_item->>'rowKey',
        'fileName', v_item->>'fileName',
        'status', 'skipped_existing',
        'vehicleId', v_existing_vehicle_id
      ));
      continue;
    end if;

    v_customer_id := null;
    select id into v_customer_id
    from public.customers
    where regexp_replace(coalesce(name, ''), '[[:space:]　]+', '', 'g')
          = regexp_replace(v_customer_name, '[[:space:]　]+', '', 'g')
      and coalesce(regexp_replace(coalesce(address, ''), '[[:space:]　]+', '', 'g'), '')
          = coalesce(regexp_replace(coalesce(v_customer_address, ''), '[[:space:]　]+', '', 'g'), '')
    order by updated_at desc
    limit 1;

    if v_customer_id is null then
      insert into public.customers(
        customer_type, name, company_name, address,
        is_provisional, created_from, updated_at
      )
      values(
        v_customer_type,
        v_customer_name,
        case when v_customer_type = 'company' then v_customer_name else null end,
        v_customer_address,
        false,
        'bulk_pdf_import',
        now()
      )
      returning id into v_customer_id;
    end if;

    insert into public.vehicles(
      customer_id,
      vehicle_number,
      registration_number,
      registration_last4,
      registration_number_last4,
      chassis_number,
      maker,
      model,
      model_code,
      engine_model,
      fuel_type,
      vehicle_type,
      first_registration,
      inspection_expiry_date,
      vehicle_weight,
      curb_weight_kg,
      gross_vehicle_weight_kg,
      seating_capacity,
      usage_category,
      body_type,
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
      nullif(btrim(v_item->>'maker'), ''),
      nullif(btrim(v_item->>'model'), ''),
      nullif(btrim(v_item->>'model'), ''),
      nullif(btrim(v_item->>'engineModel'), ''),
      nullif(btrim(v_item->>'fuelType'), ''),
      nullif(btrim(v_item->>'vehicleClass'), ''),
      nullif(btrim(v_item->>'firstRegistration'), ''),
      nullif(v_item->>'inspectionExpiryDate', '')::date,
      nullif(v_item->>'vehicleWeightKg', '')::numeric,
      nullif(v_item->>'vehicleWeightKg', '')::integer,
      nullif(v_item->>'grossVehicleWeightKg', '')::integer,
      nullif(v_item->>'seatingCapacity', '')::integer,
      nullif(btrim(v_item->>'purpose'), ''),
      nullif(btrim(v_item->>'bodyShape'), ''),
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

    v_inserted := v_inserted + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'rowKey', v_item->>'rowKey',
      'fileName', v_item->>'fileName',
      'status', 'inserted',
      'customerId', v_customer_id,
      'vehicleId', v_vehicle_id
    ));
  end loop;

  return jsonb_build_object(
    'imported', true,
    'requestedCount', v_count,
    'insertedCount', v_inserted,
    'skippedExistingCount', v_skipped,
    'items', v_results
  );
end;
$function$;

revoke all on function public.bulk_import_vehicle_certificates_v1(jsonb) from public, anon;
grant execute on function public.bulk_import_vehicle_certificates_v1(jsonb) to authenticated;
