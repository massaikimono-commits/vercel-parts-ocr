-- ICB waiting-service v1.3
-- Expand is_waiting_service from inspection-only customer visits to every customer_visit.
-- No new column, no backfill, and no existing work_order data changes.
--
-- IMPORTANT:
-- v1.2 was followed by SECURITY DEFINER active-app-user hardening.  Do not replay the
-- historical v1.2 function bodies here.  Instead patch the CURRENT live definitions so
-- authorization, grants, later compatibility work, and unrelated behavior stay intact.

comment on column public.work_orders.is_waiting_service is
  'True only when a customer_visit customer waits on site until the scheduled work is finished. Never infer from notes, status, or stay_reason.';

do $migration$
declare
  v_oid regprocedure;
  v_def text;
  v_next text;
begin
  v_oid := to_regprocedure(
    'public.create_schedule_registration_v2(text,text,text,timestamp with time zone,timestamp with time zone,boolean,text,text,text,text,text,text,text,text,uuid,text,text,text,boolean,boolean,uuid,uuid,boolean,timestamp with time zone,timestamp with time zone,text,boolean)'
  );
  if v_oid is null then
    raise exception 'waiting-service v1.3: waiting-aware create_schedule_registration_v2 not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position('not public.request_has_app_secret() and not public.is_active_app_user()' in v_def) = 0 then
    raise exception 'waiting-service v1.3: create_schedule_registration_v2 active-user hardening missing';
  end if;
  if position('not (p_reason = ''点検'' and p_entry_type = ''customer_visit'')' in v_def) = 0 then
    raise exception 'waiting-service v1.3: create waiting-service reason guard not found';
  end if;

  v_next := replace(
    v_def,
    'not (p_reason = ''点検'' and p_entry_type = ''customer_visit'')',
    'p_entry_type <> ''customer_visit'''
  );
  v_next := replace(
    v_next,
    '作業待ちは「点検・来社」の予定だけで使用できます。',
    '作業待ちは「来社」の予定だけで使用できます。'
  );
  execute v_next;
end
$migration$;

do $migration$
declare
  v_oid regprocedure;
  v_def text;
  v_next text;
begin
  v_oid := to_regprocedure(
    'public.reschedule_schedule_entry_v2(uuid,timestamp with time zone,timestamp with time zone,boolean,text,text,date,text,boolean)'
  );
  if v_oid is null then
    raise exception 'waiting-service v1.3: waiting-aware reschedule_schedule_entry_v2 not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position('not public.request_has_app_secret() and not public.is_active_app_user()' in v_def) = 0 then
    raise exception 'waiting-service v1.3: reschedule active-user hardening missing';
  end if;
  if position('not (v_reason=''点検'' and v_has_customer_visit)' in v_def) = 0 then
    raise exception 'waiting-service v1.3: reschedule waiting-service reason guard not found';
  end if;

  v_next := replace(
    v_def,
    'not (v_reason=''点検'' and v_has_customer_visit)',
    'not v_has_customer_visit'
  );
  v_next := replace(
    v_next,
    '作業待ちは「点検・来社」の予定だけで使用できます。',
    '作業待ちは「来社」の予定だけで使用できます。'
  );
  execute v_next;
end
$migration$;

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
    raise exception 'waiting-service v1.3: waiting-aware schedule_slot_check_v2 not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position('and p_reason = ''点検''' in v_def) = 0
     or position('and wo.reason = ''点検''' in v_def) = 0
     or position('点検の来社・作業待ちが同じ時刻に重複しています' in v_def) = 0 then
    raise exception 'waiting-service v1.3: old waiting duplicate-warning contract not found';
  end if;

  v_next := replace(
    v_def,
    '    and warning_text <> ''点検の来社・作業待ちが同じ時刻に重複しています''',
    '    and warning_text <> ''点検の来社・作業待ちが同じ時刻に重複しています''\n    and warning_text <> ''来社・作業待ちが同じ時刻に重複しています'''
  );
  v_next := replace(v_next, '     and p_reason = ''点検''\n', '');
  v_next := replace(v_next, '      and wo.reason = ''点検''\n', '');
  v_next := replace(
    v_next,
    '点検の来社・作業待ちが同じ時刻に重複しています',
    '来社・作業待ちが同じ時刻に重複しています'
  );
  execute v_next;
end
$migration$;
