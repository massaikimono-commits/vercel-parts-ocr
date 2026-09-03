-- Do not warn on same-time delivery overlaps.
-- Source-only until the user approves activation/deployment.
create or replace function public.schedule_slot_check(
  p_entry_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default null,
  p_exclude_entry_id uuid default null
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_day date;
  v_start_time time;
  v_end_time time;
  v_duration_minutes integer;
  v_business_hours jsonb;
  v_visit_slots jsonb;
  v_visit_time_options jsonb;
  v_capacity_rules jsonb;
  v_is_business_day boolean := true;
  v_conflicts integer := 0;
  v_morning_count integer := 0;
  v_afternoon_count integer := 0;
  v_morning_inspection_count integer := 0;
  v_morning_pickup_count integer := 0;
  v_morning_limit integer := 15;
  v_afternoon_limit integer := 10;
  v_inspection_warning integer := 4;
  v_morning_pickup_limit integer := 10;
  v_standard_visit_minutes integer := 60;
  v_last_visit_start time := time '17:00';
  v_last_visit_minutes integer := 30;
  v_hard_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_override_required boolean := false;
begin
  if p_entry_type not in ('delivery','pickup','customer_visit','onsite_repair') then
    v_hard_errors := v_hard_errors || jsonb_build_array('不明な入出庫区分です');
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return jsonb_build_object(
      'allowed', false,
      'override_required', false,
      'hard_errors', jsonb_build_array('開始・終了日時が正しくありません'),
      'warnings', '[]'::jsonb
    );
  end if;

  v_day := (p_starts_at at time zone 'Asia/Tokyo')::date;
  v_start_time := (p_starts_at at time zone 'Asia/Tokyo')::time;
  v_end_time := (p_ends_at at time zone 'Asia/Tokyo')::time;
  v_duration_minutes := round(extract(epoch from (p_ends_at-p_starts_at))/60.0)::integer;

  if (p_ends_at at time zone 'Asia/Tokyo')::date <> v_day then
    v_hard_errors := v_hard_errors || jsonb_build_array('日をまたぐ予定は登録できません');
  end if;

  select rule_value into v_business_hours
  from public.schedule_rules where rule_key='business_hours';

  select rule_value into v_visit_slots
  from public.schedule_rules where rule_key='customer_visit_slots';

  select rule_value into v_visit_time_options
  from public.schedule_rules where rule_key='customer_visit_time_options';

  select rule_value into v_capacity_rules
  from public.schedule_rules where rule_key='daily_capacity';

  v_morning_limit := coalesce((v_capacity_rules->>'morning_total')::int,15);
  v_afternoon_limit := coalesce((v_capacity_rules->>'afternoon_total')::int,10);
  v_inspection_warning := coalesce((v_capacity_rules->>'inspection_morning_warning')::int,4);
  v_morning_pickup_limit := coalesce((v_capacity_rules->>'pickup_morning_limit')::int,10);
  v_standard_visit_minutes := coalesce(
    (v_visit_time_options->>'standard_duration_minutes')::int,
    (v_visit_slots->>'slot_minutes')::int,
    60
  );
  v_last_visit_start := coalesce(
    (v_visit_time_options->>'last_start')::time,
    time '17:00'
  );
  v_last_visit_minutes := coalesce(
    (v_visit_time_options->>'last_start_duration_minutes')::int,
    30
  );

  select coalesce(bc.is_business_day,true)
  into v_is_business_day
  from (select 1) x
  left join public.business_calendar bc on bc.business_date=v_day;

  if not v_is_business_day then
    v_hard_errors := v_hard_errors || jsonb_build_array('休業日です');
  end if;

  if v_start_time < coalesce((v_business_hours->>'start')::time,time '08:30')
     or v_end_time > coalesce((v_business_hours->>'end')::time,time '17:30') then
    v_hard_errors := v_hard_errors || jsonb_build_array('営業時間外です');
  end if;

  if v_start_time < coalesce((v_business_hours->>'lunch_end')::time,time '13:00')
     and v_end_time > coalesce((v_business_hours->>'lunch_start')::time,time '12:00') then
    v_hard_errors := v_hard_errors || jsonb_build_array('12:00〜13:00は登録できません');
  end if;

  if p_entry_type='customer_visit' then
    if not (
      (v_start_time >= coalesce((v_visit_slots->>'morning_start')::time,time '08:30')
       and v_start_time <= coalesce((v_visit_slots->>'morning_end')::time,time '11:00'))
      or
      (v_start_time >= coalesce((v_visit_slots->>'afternoon_start')::time,time '13:00')
       and v_start_time <= coalesce((v_visit_slots->>'afternoon_end')::time,time '17:00'))
    ) then
      v_hard_errors := v_hard_errors || jsonb_build_array('来社受付時間外です');
    end if;

    if not (
      v_duration_minutes=v_standard_visit_minutes
      or (
        v_start_time=v_last_visit_start
        and v_duration_minutes=v_last_visit_minutes
      )
    ) then
      v_warnings := v_warnings || jsonb_build_array('来社予約は通常60分枠、17:00受付のみ30分枠です');
      v_override_required := true;
    end if;
  end if;

  select count(*)::int
  into v_conflicts
  from public.schedule_entries se
  where (p_exclude_entry_id is null or se.id<>p_exclude_entry_id)
    and se.starts_at<p_ends_at
    and se.ends_at>p_starts_at
    and se.entry_type=p_entry_type;

  -- Pickup deadlines/placeholders and deliveries can legitimately overlap.
  -- Delivery is operationally required even when another delivery uses the same time,
  -- so neither type should create a same-type overlap warning.
  if v_conflicts>0 and p_entry_type not in ('pickup','delivery') then
    v_warnings := v_warnings || jsonb_build_array('同じ区分の予定が重複しています');
    v_override_required := true;
  end if;

  select
    count(*) filter (
      where se.entry_type in ('pickup','customer_visit','onsite_repair')
        and (se.starts_at at time zone 'Asia/Tokyo')::time<time '12:00'
    )::int,
    count(*) filter (
      where se.entry_type in ('pickup','customer_visit','onsite_repair')
        and (se.starts_at at time zone 'Asia/Tokyo')::time>=time '13:00'
    )::int,
    count(*) filter (
      where se.entry_type in ('pickup','customer_visit','onsite_repair')
        and (se.starts_at at time zone 'Asia/Tokyo')::time<time '12:00'
        and wo.reason='車検'
    )::int,
    count(*) filter (
      where se.entry_type='pickup'
        and (se.starts_at at time zone 'Asia/Tokyo')::time<time '12:00'
    )::int
  into v_morning_count,v_afternoon_count,v_morning_inspection_count,v_morning_pickup_count
  from public.schedule_entries se
  left join public.work_orders wo on wo.id=se.work_order_id
  where (se.starts_at at time zone 'Asia/Tokyo')::date=v_day
    and (p_exclude_entry_id is null or se.id<>p_exclude_entry_id);

  if p_entry_type in ('pickup','customer_visit','onsite_repair') then
    if v_start_time<time '12:00' then
      if v_morning_count>=v_morning_limit then
        v_warnings := v_warnings || jsonb_build_array('午前の入庫系予定が上限に達しています');
        v_override_required := true;
      end if;

      if p_entry_type='pickup' and v_morning_pickup_count>=v_morning_pickup_limit then
        v_warnings := v_warnings || jsonb_build_array(
          format('午前の引取が上限%s件に達しています',v_morning_pickup_limit)
        );
        v_override_required := true;
      end if;

      if p_reason='車検' and v_morning_inspection_count>=v_inspection_warning then
        v_warnings := v_warnings || jsonb_build_array('午前の車検入庫が4台以上になります');
        v_override_required := true;
      end if;
    elsif v_start_time>=time '13:00' and v_afternoon_count>=v_afternoon_limit then
      v_warnings := v_warnings || jsonb_build_array('午後の入庫系予定が上限に達しています');
      v_override_required := true;
    end if;
  end if;

  return jsonb_build_object(
    'allowed',jsonb_array_length(v_hard_errors)=0,
    'override_required',v_override_required,
    'hard_errors',v_hard_errors,
    'warnings',v_warnings,
    'business_day',v_is_business_day,
    'conflicts',v_conflicts,
    'duration_minutes',v_duration_minutes,
    'capacity',jsonb_build_object(
      'morning_count',v_morning_count,
      'morning_limit',v_morning_limit,
      'afternoon_count',v_afternoon_count,
      'afternoon_limit',v_afternoon_limit,
      'morning_inspection_count',v_morning_inspection_count,
      'morning_inspection_warning',v_inspection_warning,
      'morning_pickup_count',v_morning_pickup_count,
      'morning_pickup_limit',v_morning_pickup_limit
    )
  );
end;
$function$;
