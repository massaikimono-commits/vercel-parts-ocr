-- Candidate only. DO NOT APPLY to shared Supabase without management GO.
-- Delivery-time preset semantics persistence using the existing
-- schedule_entries.print_time_label_override column. No new column/backfill.
--
-- Distinct RPC names are intentional: Supabase/PostgREST recommends avoiding
-- overloaded RPC ambiguity. Existing v2/v1 callers remain untouched until the
-- candidate UI explicitly opts into these functions.

create or replace function public.create_schedule_registration_delivery_label_v1(
  p_customer_name text,
  p_entry_type text,
  p_reason text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_waiting_service boolean default false,
  p_customer_type text default 'individual',
  p_company_name text default null,
  p_phone text default null,
  p_schedule_display_name text default null,
  p_registration_number text default null,
  p_registration_last4 text default null,
  p_maker text default null,
  p_model text default null,
  p_staff_id uuid default null,
  p_notes text default null,
  p_inspection_schedule_type text default null,
  p_print_time_mode text default 'exact',
  p_is_urgent boolean default false,
  p_needs_loaner boolean default false,
  p_existing_customer_id uuid default null,
  p_existing_vehicle_id uuid default null,
  p_add_delivery boolean default false,
  p_delivery_starts_at timestamptz default null,
  p_delivery_ends_at timestamptz default null,
  p_delivery_print_time_mode text default null,
  p_delivery_print_time_label_override text default null,
  p_allow_warning_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_result jsonb;
  v_delivery_entry_id uuid;
  v_label text := nullif(btrim(coalesce(p_delivery_print_time_label_override,'')),'');
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  if v_label is not null and v_label not in ('15時以降','16時以降','17時以降') then
    raise exception 'invalid delivery print time label override';
  end if;

  v_result := public.create_schedule_registration_v2(
    p_customer_name => p_customer_name,
    p_entry_type => p_entry_type,
    p_reason => p_reason,
    p_starts_at => p_starts_at,
    p_ends_at => p_ends_at,
    p_is_waiting_service => coalesce(p_is_waiting_service,false),
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

  if not coalesce((v_result->>'created')::boolean,false) then
    return v_result;
  end if;

  v_delivery_entry_id := nullif(v_result->>'deliveryScheduleEntryId','')::uuid;
  if v_delivery_entry_id is not null then
    update public.schedule_entries
    set print_time_label_override = v_label
    where id = v_delivery_entry_id
      and entry_type = 'delivery';
  end if;

  return v_result || jsonb_build_object('deliveryPrintTimeLabelOverride',v_label);
end;
$function$;

revoke all on function public.create_schedule_registration_delivery_label_v1(
  text,text,text,timestamptz,timestamptz,boolean,text,text,text,text,text,text,text,text,uuid,text,text,text,boolean,boolean,uuid,uuid,boolean,timestamptz,timestamptz,text,text,boolean
) from public, anon;
grant execute on function public.create_schedule_registration_delivery_label_v1(
  text,text,text,timestamptz,timestamptz,boolean,text,text,text,text,text,text,text,text,uuid,text,text,text,boolean,boolean,uuid,uuid,boolean,timestamptz,timestamptz,text,text,boolean
) to authenticated, service_role;

create or replace function public.create_schedule_registration_batch_delivery_label_v1(
  p_day date,
  p_items jsonb,
  p_allow_warning_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_result jsonb;
  v_result_item jsonb;
  v_input_item jsonb;
  v_index integer;
  v_delivery_entry_id uuid;
  v_label text;
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'batch items must be an array';
  end if;

  for v_input_item in select value from jsonb_array_elements(p_items)
  loop
    v_label := nullif(btrim(coalesce(v_input_item->>'deliveryPrintTimeLabelOverride','')),'');
    if v_label is not null and v_label not in ('15時以降','16時以降','17時以降') then
      raise exception 'invalid delivery print time label override';
    end if;
  end loop;

  v_result := public.create_schedule_registration_batch_v1(
    p_day => p_day,
    p_items => p_items,
    p_allow_warning_override => p_allow_warning_override
  );

  if not coalesce((v_result->>'created')::boolean,false) then
    return v_result;
  end if;

  for v_result_item in select value from jsonb_array_elements(coalesce(v_result->'items','[]'::jsonb))
  loop
    v_index := coalesce((v_result_item->>'index')::integer,0);
    if v_index < 1 then
      continue;
    end if;
    v_input_item := p_items->(v_index - 1);
    v_label := nullif(btrim(coalesce(v_input_item->>'deliveryPrintTimeLabelOverride','')),'');
    v_delivery_entry_id := nullif(v_result_item->>'deliveryScheduleEntryId','')::uuid;
    if v_delivery_entry_id is not null then
      update public.schedule_entries
      set print_time_label_override = v_label
      where id = v_delivery_entry_id
        and entry_type = 'delivery';
    end if;
  end loop;

  return v_result;
end;
$function$;

revoke all on function public.create_schedule_registration_batch_delivery_label_v1(date,jsonb,boolean) from public, anon;
grant execute on function public.create_schedule_registration_batch_delivery_label_v1(date,jsonb,boolean) to authenticated, service_role;

create or replace function public.reschedule_schedule_entry_delivery_label_v1(
  p_entry_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_waiting_service boolean,
  p_print_time_mode text default null,
  p_print_time_label_override text default null,
  p_stay_reason text default null,
  p_planned_delivery_date date default null,
  p_actor text default null,
  p_allow_warning_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_result jsonb;
  v_entry_type text;
  v_label text := nullif(btrim(coalesce(p_print_time_label_override,'')),'');
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  select entry_type into v_entry_type
  from public.schedule_entries
  where id = p_entry_id;

  if v_entry_type is null then
    raise exception 'schedule entry not found';
  end if;
  if v_entry_type <> 'delivery' and v_label is not null then
    raise exception 'print time label override is delivery-only';
  end if;
  if v_label is not null and v_label not in ('15時以降','16時以降','17時以降') then
    raise exception 'invalid delivery print time label override';
  end if;

  v_result := public.reschedule_schedule_entry_v2(
    p_entry_id => p_entry_id,
    p_starts_at => p_starts_at,
    p_ends_at => p_ends_at,
    p_is_waiting_service => coalesce(p_is_waiting_service,false),
    p_print_time_mode => p_print_time_mode,
    p_stay_reason => p_stay_reason,
    p_planned_delivery_date => p_planned_delivery_date,
    p_actor => p_actor,
    p_allow_warning_override => p_allow_warning_override
  );

  if not coalesce((v_result->>'updated')::boolean,false) then
    return v_result;
  end if;

  if v_entry_type = 'delivery' then
    update public.schedule_entries
    set print_time_label_override = v_label
    where id = p_entry_id;
  end if;

  return v_result || jsonb_build_object('printTimeLabelOverride',case when v_entry_type='delivery' then v_label else null end);
end;
$function$;

revoke all on function public.reschedule_schedule_entry_delivery_label_v1(uuid,timestamptz,timestamptz,boolean,text,text,text,date,text,boolean) from public, anon;
grant execute on function public.reschedule_schedule_entry_delivery_label_v1(uuid,timestamptz,timestamptz,boolean,text,text,text,date,text,boolean) to authenticated, service_role;

-- PostgREST schema cache refresh is required only when this candidate is eventually applied.
-- notify pgrst, 'reload schema';
