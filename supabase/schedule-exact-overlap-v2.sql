-- Schedule overlap/display rule patch (2026-09-03)
-- Goal:
--   * only exact-time appointments produce overlap warnings
--   * A中 / 午後 / 午前中 / 午後中 never produce overlap warnings
--   * customer_visit can choose exact time + A中 + 午後
--   * outsourced 一般整備 is preserved in batch registration
--
-- Applied to Supabase project wlwbgirumlqatwvilxsz during preview validation.

create or replace function public.schedule_slot_check_v2(
  p_entry_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default null,
  p_exclude_entry_id uuid default null,
  p_print_time_mode text default 'exact'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
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
    and not (
      v_mode <> 'exact'
      and warning_text = '来社予約は通常60分枠、17:00受付のみ30分枠です'
    );

  if v_mode = 'exact' then
    select count(*)::int
    into v_conflicts
    from public.schedule_entries se
    where (p_exclude_entry_id is null or se.id <> p_exclude_entry_id)
      and se.starts_at < p_ends_at
      and se.ends_at > p_starts_at
      and se.entry_type = p_entry_type
      and coalesce(nullif(btrim(se.print_time_mode),''),'exact') = 'exact';

    if v_conflicts > 0 then
      v_warnings := v_warnings || jsonb_build_array('同じ区分の予定が重複しています');
    end if;
  end if;

  return v_result || jsonb_build_object(
    'warnings', v_warnings,
    'override_required', jsonb_array_length(v_warnings) > 0,
    'conflicts', v_conflicts
  );
end;
$$;

revoke execute on function public.schedule_slot_check_v2(text,timestamptz,timestamptz,text,uuid,text)
from public, anon;
grant execute on function public.schedule_slot_check_v2(text,timestamptz,timestamptz,text,uuid,text)
to authenticated, service_role;

create or replace function public.schedule_time_availability(
  p_day date,
  p_entry_type text,
  p_reason text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_payload jsonb;
  v_option jsonb;
  v_check jsonb;
  v_options jsonb := '[]'::jsonb;
  v_status text;
begin
  v_payload := public.schedule_time_options(p_day, p_entry_type);

  for v_option in
    select value from jsonb_array_elements(coalesce(v_payload->'options','[]'::jsonb))
  loop
    v_check := public.schedule_slot_check_v2(
      p_entry_type,
      (v_option->>'startsAt')::timestamptz,
      (v_option->>'endsAt')::timestamptz,
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
$$;

revoke execute on function public.schedule_time_availability(date,text,text) from public, anon;
grant execute on function public.schedule_time_availability(date,text,text) to authenticated, service_role;

-- The live project also updates:
-- 1. create_schedule_registration_v2 -> use schedule_slot_check_v2 with p_print_time_mode
-- 2. reschedule_schedule_entry_v2 -> use schedule_slot_check_v2 with p_print_time_mode
-- 3. create_schedule_registration_batch_v1 -> allow vendor assignment for 一般整備
-- 4. schedule_time_options(customer_visit) -> append A中 and 午後 broad-time options
--
-- These replacements are intentionally kept as notes here because the existing
-- function bodies are already managed in the live DB and should be captured in
-- the next full schema pull before production merge.
