-- Deployed to the existing Supabase project on 2026-09-04.
-- Atomic reservation/stay + staff/vendor update wrapper.

CREATE OR REPLACE FUNCTION public.update_schedule_entry_and_assignment_v1(p_entry_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_print_time_mode text, p_stay_reason text, p_planned_delivery_date date, p_staff_id uuid, p_vendor_id uuid, p_vendor_name text, p_update_schedule boolean DEFAULT true, p_update_assignment boolean DEFAULT false, p_actor text DEFAULT NULL::text, p_allow_warning_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_entry public.schedule_entries%rowtype;
  v_schedule_result jsonb := jsonb_build_object(
    'updated',true,
    'warnings','[]'::jsonb,
    'hardErrors','[]'::jsonb,
    'overrideRequired',false
  );
  v_assignment_result jsonb := null;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  select * into v_entry
  from public.schedule_entries
  where id=p_entry_id
  for update;

  if not found then
    raise exception 'schedule entry not found';
  end if;

  if coalesce(p_update_schedule,false) then
    v_schedule_result := public.reschedule_schedule_entry_v2(
      p_entry_id,
      p_starts_at,
      p_ends_at,
      p_print_time_mode,
      p_stay_reason,
      p_planned_delivery_date,
      p_actor,
      p_allow_warning_override
    );

    if not coalesce((v_schedule_result->>'updated')::boolean,false) then
      return v_schedule_result || jsonb_build_object(
        'assignmentUpdated',false,
        'transactional',true
      );
    end if;
  end if;

  if coalesce(p_update_assignment,false) then
    if v_entry.work_order_id is null then
      raise exception 'schedule entry has no work order for assignment';
    end if;

    v_assignment_result := public.set_work_order_assignment(
      v_entry.work_order_id,
      p_staff_id,
      p_vendor_id,
      p_vendor_name,
      p_actor
    );
  end if;

  return v_schedule_result || jsonb_build_object(
    'updated',true,
    'scheduleUpdated',coalesce(p_update_schedule,false),
    'assignmentUpdated',coalesce(p_update_assignment,false),
    'assignment',v_assignment_result,
    'transactional',true
  );
end;
$function$;

revoke all on function public.update_schedule_entry_and_assignment_v1(
  uuid,timestamptz,timestamptz,text,text,date,uuid,uuid,text,boolean,boolean,text,boolean
) from public, anon;
grant execute on function public.update_schedule_entry_and_assignment_v1(
  uuid,timestamptz,timestamptz,text,text,date,uuid,uuid,text,boolean,boolean,text,boolean
) to authenticated;
