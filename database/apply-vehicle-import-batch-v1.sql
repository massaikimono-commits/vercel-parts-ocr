-- Deployed to the existing Supabase project on 2026-09-04.
-- Atomic bulk vehicle import apply for reviewed PDF imports.
-- Includes create/update identity-collision guards and last4 normalization.

CREATE OR REPLACE FUNCTION public.apply_vehicle_import_batch_v1(p_items jsonb, p_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item jsonb;
  v_import public.vehicle_imports%rowtype;
  v_existing public.vehicles%rowtype;
  v_parsed jsonb;
  v_action text;
  v_target_vehicle_id uuid;
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_duplicate_vehicle_id uuid;
  v_registration text;
  v_registration_last4 text;
  v_chassis text;
  v_model text;
  v_maker text;
  v_fuel text;
  v_first_registration text;
  v_weight numeric;
  v_results jsonb := '[]'::jsonb;
  v_failed_result jsonb := null;
  v_failed_index integer := null;
  v_index integer := 0;
  v_target_ids uuid[] := '{}';
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'import items must be an array';
  end if;
  if jsonb_array_length(p_items)<1 then
    return jsonb_build_object(
      'applied',false,'rolledBack',true,'appliedCount',0,
      'hardErrors',jsonb_build_array('保存するPDFを1件以上選択してください。')
    );
  end if;
  if jsonb_array_length(p_items)>100 then
    return jsonb_build_object(
      'applied',false,'rolledBack',true,'appliedCount',0,
      'hardErrors',jsonb_build_array('一度に保存できるのは100件までです。')
    );
  end if;

  begin
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_index := v_index + 1;

      select * into v_import
      from public.vehicle_imports
      where id=nullif(v_item->>'importId','')::uuid
      for update;

      if not found then
        v_failed_index:=v_index;
        v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('車両取込データが見つかりません。'));
        raise exception 'vehicle_batch_item_failed';
      end if;

      if v_import.status in ('APPLIED','REJECTED') then
        v_failed_index:=v_index;
        v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('すでに処理済みの車両取込データです。'));
        raise exception 'vehicle_batch_item_failed';
      end if;

      v_parsed := coalesce(v_item->'parsedFields',v_import.parsed_fields,'{}'::jsonb);
      v_action := upper(coalesce(nullif(v_item->>'action',''),coalesce(v_import.resolution_action,'')));
      v_target_vehicle_id := coalesce(
        nullif(v_item->>'targetVehicleId','')::uuid,
        v_import.matched_vehicle_id
      );
      v_customer_id := coalesce(
        nullif(v_item->>'customerId','')::uuid,
        v_import.resolved_customer_id
      );

      v_registration := nullif(btrim(coalesce(v_parsed->>'registration_number','')),'');
      v_chassis := nullif(btrim(coalesce(v_parsed->>'chassis_number','')),'');
      v_model := nullif(btrim(coalesce(v_parsed->>'model',v_parsed->>'model_code','')),'');
      v_maker := nullif(btrim(coalesce(v_parsed->>'maker','')),'');
      v_fuel := nullif(btrim(coalesce(v_parsed->>'fuel_type','')),'');
      v_first_registration := nullif(btrim(coalesce(v_parsed->>'first_registration','')),'');
      v_registration_last4 := coalesce(
        nullif(substring(coalesce(v_registration,'') from '([0-9]{4})(?!.*[0-9])'),''),
        nullif(btrim(coalesce(v_parsed->>'registration_last4','')),'')
      );
      v_weight := case
        when coalesce(v_parsed->>'vehicle_weight','') ~ '^[0-9]+([.][0-9]+)?$'
          then (v_parsed->>'vehicle_weight')::numeric
        else null
      end;

      if v_action='CREATE_VEHICLE' then
        if v_registration is null and v_chassis is null then
          v_failed_index:=v_index;
          v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('登録番号または車台番号が必要です。'));
          raise exception 'vehicle_batch_item_failed';
        end if;

        select v.id into v_duplicate_vehicle_id
        from public.vehicles v
        where
          (v_chassis is not null and lower(coalesce(v.chassis_number,''))=lower(v_chassis))
          or (
            v_registration is not null
            and regexp_replace(coalesce(v.registration_number,''),'[[:space:]・･-]','','g')
              = regexp_replace(v_registration,'[[:space:]・･-]','','g')
          )
        order by v.created_at desc
        limit 1;

        if v_duplicate_vehicle_id is not null then
          v_failed_index:=v_index;
          v_failed_result:=jsonb_build_object(
            'hardErrors',jsonb_build_array('同じ登録番号または車台番号の既存車両があります。新規ではなく既存車更新を選んでください。'),
            'duplicateVehicleId',v_duplicate_vehicle_id
          );
          raise exception 'vehicle_batch_item_failed';
        end if;

        insert into public.vehicles(
          customer_id,vehicle_number,registration_number,registration_last4,registration_number_last4,
          chassis_number,maker,model,model_code,fuel_type,vehicle_weight,first_registration,
          inspection_certificate_number,user_name_snapshot,certificate_fields,last_document_import_id,
          is_provisional,created_from,updated_at
        )
        values(
          v_customer_id,coalesce(v_registration,v_chassis),v_registration,v_registration_last4,v_registration_last4,
          v_chassis,v_maker,v_model,v_model,v_fuel,v_weight,v_first_registration,
          nullif(v_parsed->>'inspection_certificate_number',''),
          nullif(v_parsed->>'user_name',''),
          coalesce(v_parsed->'certificate_fields','{}'::jsonb),
          v_import.id,false,'vehicle_pdf_batch',now()
        )
        returning id into v_vehicle_id;

      elsif v_action='UPDATE_EXISTING' then
        if v_target_vehicle_id is null then
          v_failed_index:=v_index;
          v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('更新する既存車両を選択してください。'));
          raise exception 'vehicle_batch_item_failed';
        end if;

        if v_target_vehicle_id=any(v_target_ids) then
          v_failed_index:=v_index;
          v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('同じ既存車両を複数PDFから同時更新しようとしています。'));
          raise exception 'vehicle_batch_item_failed';
        end if;
        v_target_ids:=array_append(v_target_ids,v_target_vehicle_id);

        select * into v_existing
        from public.vehicles
        where id=v_target_vehicle_id
        for update;
        if not found then
          v_failed_index:=v_index;
          v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('更新対象の既存車両が見つかりません。'));
          raise exception 'vehicle_batch_item_failed';
        end if;

        v_duplicate_vehicle_id := null;
        select v.id into v_duplicate_vehicle_id
        from public.vehicles v
        where v.id<>v_target_vehicle_id
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

        if v_duplicate_vehicle_id is not null then
          v_failed_index:=v_index;
          v_failed_result:=jsonb_build_object(
            'hardErrors',jsonb_build_array('更新後の登録番号または車台番号が別の既存車両と重複します。更新対象を確認してください。'),
            'duplicateVehicleId',v_duplicate_vehicle_id
          );
          raise exception 'vehicle_batch_item_failed';
        end if;

        update public.vehicles
        set
          customer_id=coalesce(v_customer_id,v_existing.customer_id),
          vehicle_number=coalesce(v_registration,v_chassis,v_existing.vehicle_number),
          registration_number=coalesce(v_registration,v_existing.registration_number),
          registration_last4=coalesce(v_registration_last4,v_existing.registration_last4),
          registration_number_last4=coalesce(v_registration_last4,v_existing.registration_number_last4),
          chassis_number=coalesce(v_chassis,v_existing.chassis_number),
          maker=coalesce(v_maker,v_existing.maker),
          model=coalesce(v_model,v_existing.model),
          model_code=coalesce(v_model,v_existing.model_code),
          fuel_type=coalesce(v_fuel,v_existing.fuel_type),
          vehicle_weight=coalesce(v_weight,v_existing.vehicle_weight),
          first_registration=coalesce(v_first_registration,v_existing.first_registration),
          inspection_certificate_number=coalesce(nullif(v_parsed->>'inspection_certificate_number',''),v_existing.inspection_certificate_number),
          user_name_snapshot=coalesce(nullif(v_parsed->>'user_name',''),v_existing.user_name_snapshot),
          certificate_fields=coalesce(v_existing.certificate_fields,'{}'::jsonb) || coalesce(v_parsed->'certificate_fields','{}'::jsonb),
          last_document_import_id=v_import.id,
          is_provisional=false,
          updated_at=now()
        where id=v_target_vehicle_id;

        v_vehicle_id:=v_target_vehicle_id;
      else
        v_failed_index:=v_index;
        v_failed_result:=jsonb_build_object('hardErrors',jsonb_build_array('新規作成か既存車更新を選択してください。'));
        raise exception 'vehicle_batch_item_failed';
      end if;

      update public.vehicle_imports
      set
        parsed_fields=v_parsed,
        status='APPLIED',
        matched_vehicle_id=v_vehicle_id,
        resolved_customer_id=coalesce(v_customer_id,(select customer_id from public.vehicles where id=v_vehicle_id)),
        resolution_action=v_action,
        resolved_at=now(),
        resolved_by=nullif(btrim(p_actor),''),
        updated_at=now()
      where id=v_import.id;

      v_results:=v_results || jsonb_build_array(jsonb_build_object(
        'index',v_index,
        'importId',v_import.id,
        'vehicleId',v_vehicle_id,
        'action',v_action
      ));
    end loop;

    return jsonb_build_object(
      'applied',true,'rolledBack',false,
      'appliedCount',jsonb_array_length(v_results),
      'items',v_results,'hardErrors','[]'::jsonb
    );
  exception
    when others then
      if sqlerrm='vehicle_batch_item_failed' then
        return jsonb_build_object(
          'applied',false,'rolledBack',true,'appliedCount',0,
          'failedIndex',v_failed_index,
          'failure',coalesce(v_failed_result,'{}'::jsonb),
          'hardErrors',coalesce(v_failed_result->'hardErrors','[]'::jsonb)
        );
      end if;
      raise;
  end;
end;
$function$;

revoke all on function public.apply_vehicle_import_batch_v1(jsonb,text) from public, anon;
grant execute on function public.apply_vehicle_import_batch_v1(jsonb,text) to authenticated;
