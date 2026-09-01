-- ICB login anomaly detection.
-- Applied to production on 2026-09-01.
-- Adds coarse device/browser classification so a newly observed device class can
-- be warned without treating ordinary IP-address changes as suspicious.

create or replace function private.login_device_class(p_user_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_user_agent,'') ~* 'iPhone' and coalesce(p_user_agent,'') ~* 'CriOS' then 'iphone_chrome'
    when coalesce(p_user_agent,'') ~* 'iPhone' and coalesce(p_user_agent,'') ~* 'FxiOS' then 'iphone_firefox'
    when coalesce(p_user_agent,'') ~* 'iPhone' then 'iphone_safari'
    when coalesce(p_user_agent,'') ~* 'iPad' then 'ipad'
    when coalesce(p_user_agent,'') ~* 'Android' and coalesce(p_user_agent,'') ~* 'Chrome' then 'android_chrome'
    when coalesce(p_user_agent,'') ~* 'Android' then 'android_other'
    when coalesce(p_user_agent,'') ~* 'Windows' and coalesce(p_user_agent,'') ~* 'Edg/' then 'windows_edge'
    when coalesce(p_user_agent,'') ~* 'Windows' and coalesce(p_user_agent,'') ~* 'Chrome' then 'windows_chrome'
    when coalesce(p_user_agent,'') ~* 'Windows' and coalesce(p_user_agent,'') ~* 'Firefox' then 'windows_firefox'
    when coalesce(p_user_agent,'') ~* 'Windows' then 'windows_other'
    when coalesce(p_user_agent,'') ~* '(Macintosh|Mac OS X)' and coalesce(p_user_agent,'') ~* 'Chrome' then 'mac_chrome'
    when coalesce(p_user_agent,'') ~* '(Macintosh|Mac OS X)' then 'mac_safari'
    when coalesce(p_user_agent,'') = '' or coalesce(p_user_agent,'') = 'unknown' then 'unknown'
    else 'other'
  end;
$$;

revoke all on function private.login_device_class(text) from public;
revoke execute on function private.login_device_class(text) from anon, authenticated;

create or replace function public.my_login_security_alerts(p_limit integer default 10)
returns table(severity text, alert_code text, occurred_at timestamptz, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_limit integer;
  v_fail_15 integer;
  v_fail_30 integer;
  v_last_failure timestamptz;
  v_success_after_fail timestamptz;
  v_latest_success_at timestamptz;
  v_latest_user_agent text;
  v_latest_device text;
  v_has_prior_success boolean;
  v_seen_device boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null or not public.is_active_app_user() then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 10), 1), 20);

  select
    count(*) filter (where e.occurred_at > now() - interval '15 minutes'),
    count(*) filter (where e.occurred_at > now() - interval '30 minutes'),
    max(e.occurred_at)
  into v_fail_15, v_fail_30, v_last_failure
  from public.login_security_events e
  where e.subject_user_id = v_user_id
    and e.event_type = 'login_failure'
    and e.occurred_at > now() - interval '30 minutes';

  select max(s.occurred_at)
  into v_success_after_fail
  from public.login_security_events s
  where s.subject_user_id = v_user_id
    and s.event_type = 'login_success'
    and s.occurred_at > now() - interval '7 days'
    and (
      select count(*)
      from public.login_security_events f
      where f.subject_user_id = v_user_id
        and f.event_type = 'login_failure'
        and f.occurred_at >= s.occurred_at - interval '30 minutes'
        and f.occurred_at < s.occurred_at
    ) >= 3;

  select s.occurred_at, s.user_agent
  into v_latest_success_at, v_latest_user_agent
  from public.login_security_events s
  where s.subject_user_id = v_user_id
    and s.event_type = 'login_success'
  order by s.occurred_at desc
  limit 1;

  if v_latest_success_at is not null then
    v_latest_device := private.login_device_class(v_latest_user_agent);

    select exists (
      select 1
      from public.login_security_events s
      where s.subject_user_id = v_user_id
        and s.event_type = 'login_success'
        and s.occurred_at < v_latest_success_at
    )
    into v_has_prior_success;

    select exists (
      select 1
      from public.login_security_events s
      where s.subject_user_id = v_user_id
        and s.event_type = 'login_success'
        and s.occurred_at < v_latest_success_at
        and s.occurred_at >= v_latest_success_at - interval '90 days'
        and private.login_device_class(s.user_agent) = v_latest_device
    )
    into v_seen_device;
  else
    v_has_prior_success := false;
    v_seen_device := false;
  end if;

  return query
  select q.severity, q.alert_code, q.occurred_at, q.message
  from (
    select
      'high'::text as severity,
      'success_after_failures'::text as alert_code,
      v_success_after_fail as occurred_at,
      '複数回のログイン失敗後にログイン成功がありました。身に覚えがあるか確認してください。'::text as message
    where v_success_after_fail is not null

    union all

    select
      'high'::text,
      'many_failures'::text,
      v_last_failure,
      '30分以内に5回以上ログインに失敗しています。第三者による試行の可能性があります。'::text
    where coalesce(v_fail_30, 0) >= 5

    union all

    select
      'warning'::text,
      'repeated_failures'::text,
      v_last_failure,
      '15分以内に3回以上ログインに失敗しています。身に覚えがあるか確認してください。'::text
    where coalesce(v_fail_15, 0) >= 3
      and coalesce(v_fail_30, 0) < 5

    union all

    select
      'warning'::text,
      'new_device'::text,
      v_latest_success_at,
      'これまでと異なる端末・ブラウザからログインがありました。身に覚えがあるか確認してください。'::text
    where v_latest_success_at is not null
      and v_latest_success_at > now() - interval '7 days'
      and coalesce(v_has_prior_success, false)
      and not coalesce(v_seen_device, false)
      and coalesce(v_latest_device, 'unknown') not in ('unknown', 'other')
  ) q
  order by
    case q.severity when 'high' then 0 else 1 end,
    q.occurred_at desc nulls last
  limit v_limit;
end;
$$;

revoke all on function public.my_login_security_alerts(integer) from public;
grant execute on function public.my_login_security_alerts(integer) to authenticated;
