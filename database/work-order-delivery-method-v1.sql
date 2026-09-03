-- Track how the completed vehicle is handed back while keeping the schedule row
-- in the delivery column. Existing rows remain ordinary delivery by default.
-- Source-only until the user approves activation/deployment.
alter table public.work_orders
  add column if not exists planned_delivery_method text not null default 'delivery';

alter table public.work_orders
  drop constraint if exists work_orders_planned_delivery_method_check;

alter table public.work_orders
  add constraint work_orders_planned_delivery_method_check
  check (planned_delivery_method in ('delivery','customer_visit'));

create or replace function public.set_work_order_delivery_method_v1(
  p_work_order_ids uuid[],
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count integer;
begin
  if auth.uid() is null and not public.request_has_app_secret() then
    raise exception 'not authorized';
  end if;

  if p_method not in ('delivery','customer_visit') then
    raise exception 'invalid delivery method';
  end if;

  if p_work_order_ids is null or coalesce(array_length(p_work_order_ids,1),0) < 1 then
    raise exception 'work order ids are required';
  end if;

  update public.work_orders
  set planned_delivery_method=p_method,
      updated_at=now()
  where id=any(p_work_order_ids);

  get diagnostics v_count = row_count;

  if v_count <> array_length(p_work_order_ids,1) then
    raise exception 'one or more work orders were not found';
  end if;

  return jsonb_build_object('updated',true,'count',v_count,'method',p_method);
end;
$function$;

revoke all on function public.set_work_order_delivery_method_v1(uuid[],text) from public, anon;
grant execute on function public.set_work_order_delivery_method_v1(uuid[],text) to authenticated;
