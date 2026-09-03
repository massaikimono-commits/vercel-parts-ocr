-- Deployed to the existing Supabase project on 2026-09-04.
-- Guarded single-vehicle certificate save with duplicate identity protection.

CREATE OR REPLACE FUNCTION public.save_vehicle_certificate_v1(p_vehicle_id uuid, p_payload jsonb, p_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_vehicle_id uuid;
  v_duplicate_id uuid;
  v_registration text;
  v_registration_last4 text;
  v_chassis text;
  v_customer_id uuid;
  v_certificate jsonb;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'vehicle payload must be an object';
  end if;

  v_registration := nullif(btrim(coalesce(p_payload->>'registration_number','')),'');
  v_chassis := nullif(btrim(coalesce(p_payload->>'chassis_number','')),'');
  v_registration_last4 := coalesce(
    nullif(substring(coalesce(v_registration,'') from '([0-9]{4})(?!.*[0-9])'),''),
    nullif(btrim(coalesce(p_payload->>'registration_number_last4','')),'')
  );
  v_customer_id := nullif(p_payload->>'customer_id','')::uuid;
  v_certificate := coalesce(p_payload->'certificate_fields','{}'::jsonb);

  if v_registration is null and v_chassis is null then
    return jsonb_build_object(
      'saved',false,
      'hardErrors',jsonb_build_array('登録番号または車台番号を確認してください。')
    );
  end if;

  select v.id into v_duplicate_id
  from public.vehicles v
  where (p_vehicle_id is null or v.id<>p_vehicle_id)
    and (
      (v_chassis is not null and lower(coalesce(v.chassis_number,''))=lower(v_chassis))
      or (
        v_registration is not null
        and regexp_replace(coalesce(v.registration_number,''),'[[:space:]・･-]','','g')
          = regexp_replace(v_registration,'[[:space:]・･-]','','g')
      )
    )
  order by v.created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'saved',false,
      'duplicateVehicleId',v_duplicate_id,
      'hardErrors',jsonb_build_array('同じ登録番号または車台番号の既存車両があります。既存車両を選択して更新してください。')
    );
  end if;

  if p_vehicle_id is null then
    insert into public.vehicles(
      customer_id,vehicle_number,registration_number,registration_last4,registration_number_last4,
      chassis_number,maker,model,model_code,fuel_type,vehicle_weight,curb_weight_kg,
      gross_vehicle_weight_kg,seating_capacity,engine_model,usage_category,body_type,
      inspection_certificate_number,user_name_snapshot,first_registration,inspection_expiry_date,
      certificate_fields,front_front_axle_weight_kg,front_rear_axle_weight_kg,
      rear_front_axle_weight_kg,rear_rear_axle_weight_kg,is_provisional,created_from,updated_at
    )
    values(
      v_customer_id,coalesce(v_chassis,v_registration),v_registration,v_registration_last4,v_registration_last4,
      v_chassis,nullif(v_certificate->>'vehicleName',''),
      nullif(p_payload->>'model',''),nullif(p_payload->>'model',''),
      nullif(p_payload->>'fuel_type',''),
      nullif(p_payload->>'vehicle_weight','')::numeric,
      nullif(p_payload->>'curb_weight_kg','')::integer,
      nullif(p_payload->>'gross_vehicle_weight_kg','')::integer,
      nullif(p_payload->>'seating_capacity','')::integer,
      nullif(p_payload->>'engine_model',''),
      nullif(p_payload->>'usage_category',''),
      nullif(p_payload->>'body_type',''),
      nullif(p_payload->>'inspection_certificate_number',''),
      nullif(p_payload->>'user_name_snapshot',''),
      nullif(p_payload->>'first_registration',''),
      nullif(p_payload->>'inspection_expiry_date','')::date,
      v_certificate,
      nullif(p_payload->>'front_front_axle_weight_kg','')::integer,
      nullif(p_payload->>'front_rear_axle_weight_kg','')::integer,
      nullif(p_payload->>'rear_front_axle_weight_kg','')::integer,
      nullif(p_payload->>'rear_rear_axle_weight_kg','')::integer,
      false,'vehicle_certificate',now()
    )
    returning id into v_vehicle_id;
  else
    update public.vehicles
    set
      customer_id=v_customer_id,
      vehicle_number=coalesce(v_chassis,v_registration,vehicle_number),
      registration_number=v_registration,
      registration_last4=v_registration_last4,
      registration_number_last4=v_registration_last4,
      chassis_number=v_chassis,
      maker=coalesce(nullif(v_certificate->>'vehicleName',''),maker),
      model=nullif(p_payload->>'model',''),
      model_code=coalesce(nullif(p_payload->>'model',''),model_code),
      fuel_type=nullif(p_payload->>'fuel_type',''),
      vehicle_weight=nullif(p_payload->>'vehicle_weight','')::numeric,
      curb_weight_kg=nullif(p_payload->>'curb_weight_kg','')::integer,
      gross_vehicle_weight_kg=nullif(p_payload->>'gross_vehicle_weight_kg','')::integer,
      seating_capacity=nullif(p_payload->>'seating_capacity','')::integer,
      engine_model=nullif(p_payload->>'engine_model',''),
      usage_category=nullif(p_payload->>'usage_category',''),
      body_type=nullif(p_payload->>'body_type',''),
      inspection_certificate_number=nullif(p_payload->>'inspection_certificate_number',''),
      user_name_snapshot=nullif(p_payload->>'user_name_snapshot',''),
      first_registration=nullif(p_payload->>'first_registration',''),
      inspection_expiry_date=nullif(p_payload->>'inspection_expiry_date','')::date,
      certificate_fields=v_certificate,
      front_front_axle_weight_kg=nullif(p_payload->>'front_front_axle_weight_kg','')::integer,
      front_rear_axle_weight_kg=nullif(p_payload->>'front_rear_axle_weight_kg','')::integer,
      rear_front_axle_weight_kg=nullif(p_payload->>'rear_front_axle_weight_kg','')::integer,
      rear_rear_axle_weight_kg=nullif(p_payload->>'rear_rear_axle_weight_kg','')::integer,
      is_provisional=false,
      updated_at=now()
    where id=p_vehicle_id
    returning id into v_vehicle_id;

    if v_vehicle_id is null then
      return jsonb_build_object(
        'saved',false,
        'hardErrors',jsonb_build_array('更新対象の既存車両が見つかりません。')
      );
    end if;
  end if;

  return jsonb_build_object(
    'saved',true,
    'vehicleId',v_vehicle_id,
    'created',p_vehicle_id is null,
    'registrationLast4',v_registration_last4,
    'actor',nullif(btrim(p_actor),'')
  );
end;
$function$;

revoke all on function public.save_vehicle_certificate_v1(uuid,jsonb,text) from public, anon;
grant execute on function public.save_vehicle_certificate_v1(uuid,jsonb,text) to authenticated;
