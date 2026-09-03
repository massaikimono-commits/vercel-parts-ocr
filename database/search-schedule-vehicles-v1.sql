-- Deployed to the existing Supabase project on 2026-09-04.
-- search_schedule_vehicles_v1

CREATE OR REPLACE FUNCTION public.search_schedule_vehicles_v1(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := btrim(coalesce(p_query,''));
  v_digits text := regexp_replace(coalesce(p_query,''),'[^0-9]','','g');
  v_limit integer := greatest(1,least(coalesce(p_limit,80),200));
  v_rows jsonb;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(row_data order by sort_key desc, vehicle_id),'[]'::jsonb)
  into v_rows
  from (
    select
      v.id as vehicle_id,
      v.created_at as sort_key,
      jsonb_build_object(
        'vehicleId',v.id,
        'customerId',v.customer_id,
        'customerName',c.name,
        'companyName',c.company_name,
        'scheduleDisplayName',c.schedule_display_name,
        'phone',c.phone,
        'registrationNumber',v.registration_number,
        'registrationLast4',coalesce(v.registration_number_last4,v.registration_last4),
        'chassisNumber',v.chassis_number,
        'maker',v.maker,
        'model',v.model
      ) as row_data
    from public.vehicles v
    left join public.customers c on c.id=v.customer_id
    where
      v_query=''
      or concat_ws(' ',
        coalesce(c.name,''),coalesce(c.company_name,''),coalesce(c.schedule_display_name,''),
        coalesce(v.registration_number,''),coalesce(v.registration_number_last4,''),coalesce(v.registration_last4,''),
        coalesce(v.chassis_number,''),coalesce(v.maker,''),coalesce(v.model,'')
      ) ilike '%'||v_query||'%'
      or (
        length(v_digits)>=2
        and regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') like '%'||v_digits||'%'
      )
      or (
        length(v_digits)>=1
        and regexp_replace(coalesce(v.registration_number_last4,v.registration_last4,''),'[^0-9]','','g')
            like '%'||right(v_digits,4)||'%'
      )
      or (
        length(v_digits)>=2
        and regexp_replace(coalesce(v.registration_number,''),'[^0-9]','','g')
            like '%'||v_digits||'%'
      )
    order by v.created_at desc
    limit v_limit
  ) q;

  return jsonb_build_object(
    'query',v_query,
    'count',jsonb_array_length(v_rows),
    'items',v_rows
  );
end;
$function$;

revoke all on function public.search_schedule_vehicles_v1(text,integer) from public, anon;
grant execute on function public.search_schedule_vehicles_v1(text,integer) to authenticated;
