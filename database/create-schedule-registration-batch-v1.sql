-- Deployed to the existing Supabase project on 2026-09-04.
-- create_schedule_registration_batch_v1

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
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
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
          'deliveryScheduleEntryId',v_result->>'deliveryScheduleEntryId'
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
$function$;

revoke all on function public.create_schedule_registration_batch_v1(date,jsonb,boolean) from public, anon;
grant execute on function public.create_schedule_registration_batch_v1(date,jsonb,boolean) to authenticated;
