-- ICB database security posture checks.
-- Read-only audit queries. Expected result sets are empty unless noted.

-- 1. Public application tables without RLS.
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind='r'
  and not c.relrowsecurity
order by c.relname;

-- 2. Public tables where anon still has DML privileges.
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind='r'
  and (
    has_table_privilege('anon',c.oid,'select')
    or has_table_privilege('anon',c.oid,'insert')
    or has_table_privilege('anon',c.oid,'update')
    or has_table_privilege('anon',c.oid,'delete')
  )
order by c.relname;

-- 3. Public views that are not security-invoker or are anon-readable.
select c.relname as view_name, c.reloptions,
       has_table_privilege('anon',c.oid,'select') as anon_select
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind='v'
  and (
    coalesce(c.reloptions,array[]::text[]) @> array['security_invoker=true']::text[] = false
    or has_table_privilege('anon',c.oid,'select')
  )
order by c.relname;

-- 4. Anonymous SECURITY DEFINER functions outside the approved pre-auth allowlist.
-- Booking token functions are public by design. The two login-security functions
-- are also pre-auth by design: one checks progressive throttling and the other
-- records a failed attempt without revealing whether the login ID exists.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.prosecdef
  and has_function_privilege('anon',p.oid,'execute')
  and p.proname not in (
    'customer_booking_by_token',
    'cancel_customer_booking_by_token',
    'reschedule_customer_booking_by_token',
    'check_login_throttle',
    'record_login_failure'
  )
order by p.proname,args;

-- 5. SECURITY DEFINER functions without an empty search path or pg_temp fixed last.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proconfig
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.prosecdef
  and not (
    coalesce(array_to_string(p.proconfig,','),'') like '%search_path=""%'
    or coalesce(array_to_string(p.proconfig,','),'') like '%pg_temp%'
  )
order by p.proname,args;

-- 6. Public Storage buckets. Expected: no rows.
select id,name
from storage.buckets
where public=true
order by id;

-- 7. Data API pre-request guard. Expected setting:
-- pgrst.db_pre_request=public.enforce_active_app_user_request
select r.rolname, unnest(s.setconfig) as setting
from pg_db_role_setting s
join pg_roles r on r.oid=s.setrole
where r.rolname='authenticator'
  and array_to_string(s.setconfig,',') like '%pgrst.db_pre_request%';

-- 8. Missing recovery snapshot triggers on critical business tables.
-- Expected: no rows.
with expected(table_name) as (
  values
    ('customers'),
    ('vehicles'),
    ('vehicle_documents'),
    ('work_orders'),
    ('schedule_entries'),
    ('parts'),
    ('part_receipts'),
    ('inspection_records'),
    ('completed_forms'),
    ('customer_booking_requests'),
    ('loaner_reservations')
)
select e.table_name
from expected e
where not exists (
  select 1
  from information_schema.triggers t
  where t.trigger_schema='public'
    and t.event_object_table=e.table_name
    and t.trigger_name='recovery_snapshot_before_change'
)
order by e.table_name;

-- 9. Recovery snapshot table accidentally exposed to app roles.
-- Expected: all values false.
select
  has_table_privilege('anon','private.recovery_row_snapshots','select') as anon_select,
  has_table_privilege('authenticated','private.recovery_row_snapshots','select') as auth_select,
  has_table_privilege('authenticated','private.recovery_row_snapshots','insert') as auth_insert,
  has_table_privilege('authenticated','private.recovery_row_snapshots','update') as auth_update,
  has_table_privilege('authenticated','private.recovery_row_snapshots','delete') as auth_delete;

-- 10. Recovery trigger function callable directly by app roles.
-- Expected: both values false.
select
  has_function_privilege('anon','private.capture_recovery_row_snapshot()','execute') as anon_execute,
  has_function_privilege('authenticated','private.capture_recovery_row_snapshot()','execute') as auth_execute;

-- 11. Daily recovery/security retention job.
-- Expected: one active row named icb-security-retention-daily.
select jobname, schedule, command, active
from cron.job
where jobname='icb-security-retention-daily';

-- 12. Retention cleanup function exposed to app roles.
-- Expected: both values false.
select
  has_function_privilege('anon','private.purge_expired_operational_security_data()','execute') as anon_execute,
  has_function_privilege('authenticated','private.purge_expired_operational_security_data()','execute') as auth_execute;

-- 13. Login-device classifier exposed to app roles.
-- Expected: both values false.
select
  has_function_privilege('anon','private.login_device_class(text)','execute') as anon_execute,
  has_function_privilege('authenticated','private.login_device_class(text)','execute') as auth_execute;

-- 14. Login alert RPC privilege boundary.
-- Expected: anon=false, authenticated=true.
select
  has_function_privilege('anon','public.my_login_security_alerts(integer)','execute') as anon_execute,
  has_function_privilege('authenticated','public.my_login_security_alerts(integer)','execute') as auth_execute;
