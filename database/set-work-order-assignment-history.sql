-- Deployed to the existing Supabase project on 2026-09-04.
-- set_work_order_assignment

CREATE OR REPLACE FUNCTION public.set_work_order_assignment(p_work_order_id uuid, p_staff_id uuid DEFAULT NULL::uuid, p_vendor_id uuid DEFAULT NULL::uuid, p_vendor_name text DEFAULT NULL::text, p_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_work public.work_orders%rowtype;
  v_staff_name text;
  v_vendor_name text;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  select * into v_work
  from public.work_orders
  where id=p_work_order_id
  for update;

  if not found then
    raise exception 'work order not found';
  end if;

  if p_staff_id is not null then
    select display_name into v_staff_name
    from public.staff_members
    where id = p_staff_id and is_active = true;

    if v_staff_name is null then
      raise exception 'active staff member not found';
    end if;
  end if;

  if p_vendor_id is not null then
    select display_name into v_vendor_name
    from public.external_vendors
    where id = p_vendor_id and is_active = true;

    if v_vendor_name is null then
      raise exception 'active external vendor not found';
    end if;
  else
    v_vendor_name := nullif(btrim(coalesce(p_vendor_name, '')), '');
  end if;

  update public.work_orders
  set worker_staff_id = p_staff_id,
      worker_name = v_staff_name,
      outsource_vendor_id = p_vendor_id,
      outsource_vendor_name = v_vendor_name,
      updated_at = now()
  where id = p_work_order_id;

  if not found then
    raise exception 'work order not found';
  end if;

  if v_work.worker_staff_id is distinct from p_staff_id
     or v_work.worker_name is distinct from v_staff_name
     or v_work.outsource_vendor_id is distinct from p_vendor_id
     or v_work.outsource_vendor_name is distinct from v_vendor_name then
    insert into public.work_order_schedule_changes(
      work_order_id,change_type,old_value,new_value,changed_by
    )
    values(
      p_work_order_id,'WORKER',
      jsonb_build_object(
        'eventType','work_order_assignment_changed',
        'staffId',v_work.worker_staff_id,
        'workerName',v_work.worker_name,
        'vendorId',v_work.outsource_vendor_id,
        'vendorName',v_work.outsource_vendor_name
      ),
      jsonb_build_object(
        'eventType','work_order_assignment_changed',
        'staffId',p_staff_id,
        'workerName',v_staff_name,
        'vendorId',p_vendor_id,
        'vendorName',v_vendor_name
      ),
      nullif(btrim(p_actor),'')
    );
  end if;

  return jsonb_build_object(
    'workOrderId', p_work_order_id,
    'staffId', p_staff_id,
    'workerName', v_staff_name,
    'vendorId', p_vendor_id,
    'vendorName', v_vendor_name,
    'changedBy', nullif(btrim(p_actor), '')
  );
end;
$function$;

revoke all on function public.set_work_order_assignment(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.set_work_order_assignment(uuid,uuid,uuid,text,text) to authenticated;
