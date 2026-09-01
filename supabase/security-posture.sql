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

-- 4. Anonymous SECURITY DEFINER functions outside the approved token allowlist.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.prosecdef
  and has_function_privilege('anon',p.oid,'execute')
  and p.proname not in (
    'customer_booking_by_token',
    'cancel_customer_booking_by_token',
    'reschedule_customer_booking_by_token'
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
