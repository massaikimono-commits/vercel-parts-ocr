-- Applied to the existing Supabase project on 2026-09-03.
-- Keep create_schedule_registration_v2 chronology aligned with flexible delivery labels:
-- exact delivery compares actual timestamps; non-exact "中" compares the JST date only.
-- No tables or columns are added.

do $do$
declare
  v_oid oid;
  v_def text;
  v_old text := 'if p_delivery_starts_at < p_ends_at then';
  v_new text := 'if (
      coalesce(nullif(btrim(p_delivery_print_time_mode),''''),''exact'') = ''exact''
      and p_delivery_starts_at < p_ends_at
    ) or (
      coalesce(nullif(btrim(p_delivery_print_time_mode),''''),''exact'') <> ''exact''
      and (p_delivery_starts_at at time zone ''Asia/Tokyo'')::date
          < (p_starts_at at time zone ''Asia/Tokyo'')::date
    ) then';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='create_schedule_registration_v2'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'create_schedule_registration_v2 not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position(v_new in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'expected delivery chronology guard not found';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$do$;
