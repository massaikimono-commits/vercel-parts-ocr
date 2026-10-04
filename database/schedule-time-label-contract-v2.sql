-- Candidate only. DO NOT APPLY to shared/Production Supabase without management GO.
-- Acceptance Revision: shared pickup + delivery time-label/range persistence.
-- New columns: 0. Backfill: 0. Mass update: 0.

create or replace function public.schedule_time_label_is_valid_v2(p_label text)
returns boolean
language sql
immutable
as $function$
  select case
    when nullif(btrim(coalesce(p_label,'')),'') is null then true
    when btrim(p_label) in (
      '14時まで','15時まで','16時まで','17時まで',
      '15時以降','16時以降','17時以降'
    ) then true
    when btrim(p_label) ~ '^(08:(30)|09:(00|30)|10:(00|30)|11:(00|30)|12:(00|30)|13:(00|30)|14:(00|30)|15:(00|30)|16:(00|30)|17:(00|30))～(08:(30)|09:(00|30)|10:(00|30)|11:(00|30)|12:(00|30)|13:(00|30)|14:(00|30)|15:(00|30)|16:(00|30)|17:(00|30))$'
      then split_part(btrim(p_label),'～',1) < split_part(btrim(p_label),'～',2)
    else false
  end;
$function$;

create or replace function public.create_schedule_registration_time_label_v2(
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
  p_print_time_label_override text default null,
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
  v_entry_id uuid;
  v_delivery_entry_id uuid;
  v_main_label text := nullif(btrim(coalesce(p_print_time_label_override,'')),'');
  v_delivery_label text := nullif(btrim(coalesce(p_delivery_print_time_label_override,'')),'');
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;
  if not public.schedule_time_label_is_valid_v2(v_main_label) then
    raise exception 'invalid schedule print time label override';
  end if;
  if not public.schedule_time_label_is_valid_v2(v_delivery_label) then
    raise exception 'invalid delivery print time label override';
  end if;

  v_result := public.create_schedule_registration_v2(
    p_customer_name => p_customer_name, p_entry_type => p_entry_type, p_reason => p_reason,
    p_starts_at => p_starts_at, p_ends_at => p_ends_at,
    p_is_waiting_service => coalesce(p_is_waiting_service,false), p_customer_type => p_customer_type,
    p_company_name => p_company_name, p_phone => p_phone, p_schedule_display_name => p_schedule_display_name,
    p_registration_number => p_registration_number, p_registration_last4 => p_registration_last4,
    p_maker => p_maker, p_model => p_model, p_staff_id => p_staff_id, p_notes => p_notes,
    p_inspection_schedule_type => p_inspection_schedule_type, p_print_time_mode => p_print_time_mode,
    p_is_urgent => p_is_urgent, p_needs_loaner => p_needs_loaner,
    p_existing_customer_id => p_existing_customer_id, p_existing_vehicle_id => p_existing_vehicle_id,
    p_add_delivery => p_add_delivery, p_delivery_starts_at => p_delivery_starts_at,
    p_delivery_ends_at => p_delivery_ends_at, p_delivery_print_time_mode => p_delivery_print_time_mode,
    p_allow_warning_override => p_allow_warning_override
  );

  if not coalesce((v_result->>'created')::boolean,false) then return v_result; end if;

  v_entry_id := nullif(v_result->>'scheduleEntryId','')::uuid;
  v_delivery_entry_id := nullif(v_result->>'deliveryScheduleEntryId','')::uuid;
  if v_entry_id is not null then
    update public.schedule_entries set print_time_label_override = v_main_label where id = v_entry_id;
  end if;
  if v_delivery_entry_id is not null then
    update public.schedule_entries set print_time_label_override = v_delivery_label
    where id = v_delivery_entry_id and entry_type = 'delivery';
  end if;

  return v_result || jsonb_build_object(
    'printTimeLabelOverride',v_main_label,
    'deliveryPrintTimeLabelOverride',v_delivery_label
  );
end;
$function$;

create or replace function public.create_schedule_registration_batch_time_label_v2(
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
  v_result jsonb; v_result_item jsonb; v_input_item jsonb; v_index integer;
  v_entry_id uuid; v_delivery_entry_id uuid; v_main_label text; v_delivery_label text;
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'batch items must be an array'; end if;

  for v_input_item in select value from jsonb_array_elements(p_items) loop
    v_main_label := nullif(btrim(coalesce(v_input_item->>'printTimeLabelOverride','')),'');
    v_delivery_label := nullif(btrim(coalesce(v_input_item->>'deliveryPrintTimeLabelOverride','')),'');
    if not public.schedule_time_label_is_valid_v2(v_main_label) then raise exception 'invalid schedule print time label override'; end if;
    if not public.schedule_time_label_is_valid_v2(v_delivery_label) then raise exception 'invalid delivery print time label override'; end if;
  end loop;

  v_result := public.create_schedule_registration_batch_v1(
    p_day => p_day, p_items => p_items, p_allow_warning_override => p_allow_warning_override
  );
  if not coalesce((v_result->>'created')::boolean,false) then return v_result; end if;

  for v_result_item in select value from jsonb_array_elements(coalesce(v_result->'items','[]'::jsonb)) loop
    v_index := coalesce((v_result_item->>'index')::integer,0);
    if v_index < 1 then continue; end if;
    v_input_item := p_items->(v_index - 1);
    v_main_label := nullif(btrim(coalesce(v_input_item->>'printTimeLabelOverride','')),'');
    v_delivery_label := nullif(btrim(coalesce(v_input_item->>'deliveryPrintTimeLabelOverride','')),'');
    v_entry_id := nullif(v_result_item->>'scheduleEntryId','')::uuid;
    v_delivery_entry_id := nullif(v_result_item->>'deliveryScheduleEntryId','')::uuid;
    if v_entry_id is not null then update public.schedule_entries set print_time_label_override = v_main_label where id = v_entry_id; end if;
    if v_delivery_entry_id is not null then
      update public.schedule_entries set print_time_label_override = v_delivery_label where id = v_delivery_entry_id and entry_type = 'delivery';
    end if;
  end loop;
  return v_result;
end;
$function$;

create or replace function public.reschedule_schedule_entry_time_label_v2(
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
  v_label text := nullif(btrim(coalesce(p_print_time_label_override,'')),'');
begin
  if not public.request_has_app_secret() and not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;
  if not public.schedule_time_label_is_valid_v2(v_label) then raise exception 'invalid schedule print time label override'; end if;

  v_result := public.reschedule_schedule_entry_v2(
    p_entry_id => p_entry_id, p_starts_at => p_starts_at, p_ends_at => p_ends_at,
    p_is_waiting_service => coalesce(p_is_waiting_service,false), p_print_time_mode => p_print_time_mode,
    p_stay_reason => p_stay_reason, p_planned_delivery_date => p_planned_delivery_date,
    p_actor => p_actor, p_allow_warning_override => p_allow_warning_override
  );
  if not coalesce((v_result->>'updated')::boolean,false) then return v_result; end if;
  update public.schedule_entries set print_time_label_override = v_label where id = p_entry_id;
  return v_result || jsonb_build_object('printTimeLabelOverride',v_label);
end;
$function$;

-- Grants are intentionally deferred until management authorizes DB APPLY.
-- Existing v1/v2 RPCs remain untouched by this candidate file.
