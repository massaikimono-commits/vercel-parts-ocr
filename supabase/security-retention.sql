-- ICB recovery/login-security retention.
-- Applied to production on 2026-09-01.
-- Idempotent for the function. Supabase Cron replaces a job when the same name
-- is scheduled again.

create extension if not exists pg_cron;

create or replace function private.purge_expired_operational_security_data()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from private.recovery_row_snapshots
  where captured_at < now() - interval '180 days';

  delete from public.login_security_events
  where occurred_at < now() - interval '180 days';
end;
$$;

revoke all on function private.purge_expired_operational_security_data() from public;
revoke execute on function private.purge_expired_operational_security_data() from anon, authenticated;

select cron.schedule(
  'icb-security-retention-daily',
  '15 18 * * *',
  $$select private.purge_expired_operational_security_data();$$
);
