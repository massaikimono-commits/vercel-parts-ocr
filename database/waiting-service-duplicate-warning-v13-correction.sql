-- ICB waiting-service v1.3 correction
-- Selection eligibility remains every customer_visit.
-- Only the special duplicate warning is restored to the formal v1.2 rule:
-- inspection + customer_visit + waiting-service + exact + identical starts_at.
-- Do not replay or roll back earlier migrations; patch the CURRENT live function body only.

do $migration$
declare
  v_oid regprocedure;
  v_def text;
  v_next text;
begin
  v_oid := to_regprocedure(
    'public.schedule_slot_check_v2(text,timestamp with time zone,timestamp with time zone,boolean,text,uuid,text)'
  );
  if v_oid is null then
    raise exception 'waiting-service v1.3 correction: waiting-aware schedule_slot_check_v2 not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('来社・作業待ちが同じ時刻に重複しています' in v_def) = 0 then
    raise exception 'waiting-service v1.3 correction: reason-neutral warning text not found';
  end if;
  if position(E'     and p_reason = ''点検''\n' in v_def) > 0
     or position(E'      and wo.reason = ''点検''\n' in v_def) > 0 then
    raise exception 'waiting-service v1.3 correction: inspection filters already present unexpectedly';
  end if;

  v_next := replace(
    v_def,
    E'     and p_entry_type = ''customer_visit''\n     and coalesce(p_is_waiting_service,false) then',
    E'     and p_entry_type = ''customer_visit''\n     and p_reason = ''点検''\n     and coalesce(p_is_waiting_service,false) then'
  );

  v_next := replace(
    v_next,
    E'      and se.starts_at = p_starts_at\n      and wo.is_waiting_service = true',
    E'      and se.starts_at = p_starts_at\n      and wo.reason = ''点検''\n      and wo.is_waiting_service = true'
  );

  v_next := replace(
    v_next,
    '来社・作業待ちが同じ時刻に重複しています',
    '点検の来社・作業待ちが同じ時刻に重複しています'
  );

  if position(E'     and p_reason = ''点検''\n' in v_next) = 0
     or position(E'      and wo.reason = ''点検''\n' in v_next) = 0
     or position('点検の来社・作業待ちが同じ時刻に重複しています' in v_next) = 0 then
    raise exception 'waiting-service v1.3 correction: corrected duplicate-warning contract was not produced';
  end if;

  execute v_next;
end
$migration$;
