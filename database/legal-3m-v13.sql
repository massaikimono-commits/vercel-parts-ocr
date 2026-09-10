-- ICB-SPEC v1.3 legal_3m minimal database migration draft.
-- DO NOT APPLY until management gives DB GO.
-- legal_3m remains reason='点検'; no new reason, column, backfill, or RLS policy.

alter table public.work_orders
  drop constraint if exists work_orders_inspection_schedule_type_check;

alter table public.work_orders
  add constraint work_orders_inspection_schedule_type_check
  check (
    inspection_schedule_type is null
    or inspection_schedule_type = any (
      array['schedule'::text, 'legal_3m'::text, 'legal_6m'::text, 'legal_12m'::text]
    )
  );

-- daily_schedule_form_payload delegates its work mark to this function.
-- ICB-SPEC v1.3 requires the legal_3m daily-report code to be "3".
create or replace function public.daily_report_work_mark(
  p_reason text,
  p_inspection_schedule_type text,
  p_override text default null::text
)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    nullif(btrim(p_override),''),
    case
      when p_reason='車検' then 'S'
      when p_reason='点検' and p_inspection_schedule_type='schedule' then 'スケ'
      when p_reason='点検' and p_inspection_schedule_type='legal_3m' then '3'
      when p_reason='点検' and p_inspection_schedule_type='legal_6m' then '法6'
      when p_reason='点検' and p_inspection_schedule_type='legal_12m' then '法12'
      when p_reason='点検' then '点'
      when p_reason='一般整備' then 'Q'
      when p_reason='板金塗装' then 'b/p'
      else null
    end
  );
$function$;

-- Keep the compatibility/shared choice catalog aligned with the allowed subtype set.
create or replace function public.quick_choice_catalog()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
select jsonb_build_object(
  'workReasons',jsonb_build_array(
    jsonb_build_object('key','車検','label','車検'),
    jsonb_build_object('key','点検','label','点検'),
    jsonb_build_object('key','一般整備','label','一般整備'),
    jsonb_build_object('key','板金塗装','label','板金塗装')
  ),
  'inspectionTypes',jsonb_build_array(
    jsonb_build_object('key','schedule','label','スケ'),
    jsonb_build_object('key','legal_3m','label','法3'),
    jsonb_build_object('key','legal_6m','label','法6'),
    jsonb_build_object('key','legal_12m','label','法12')
  ),
  'entryTypes',jsonb_build_array(
    jsonb_build_object('key','customer_visit','label','来社'),
    jsonb_build_object('key','pickup','label','引取'),
    jsonb_build_object('key','onsite_repair','label','出張'),
    jsonb_build_object('key','delivery','label','納車')
  ),
  'loanerNeed',jsonb_build_array(
    jsonb_build_object('key','not_needed','label','不要'),
    jsonb_build_object('key','needed','label','必要')
  ),
  'loanerSource',jsonb_build_array(
    jsonb_build_object('key','company_vehicle','label','弊社社用車'),
    jsonb_build_object('key','rental_company','label','レンタカー会社')
  ),
  'cancellationReasons',jsonb_build_array(
    jsonb_build_object('key','reschedule','label','日程変更'),
    jsonb_build_object('key','health','label','体調不良'),
    jsonb_build_object('key','customer_convenience','label','都合変更'),
    jsonb_build_object('key','other','label','その他')
  ),
  'waitlistTimePreference',jsonb_build_array(
    jsonb_build_object('key','morning','label','午前なら可'),
    jsonb_build_object('key','afternoon','label','午後なら可'),
    jsonb_build_object('key','any','label','いつでも可')
  ),
  'staff',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,
      'label',coalesce(nullif(btrim(s.short_name),''),s.display_name),
      'displayName',s.display_name
    ) order by s.display_order,s.display_name)
    from public.staff_members s
    where s.is_active and s.quick_select
  ),'[]'::jsonb),
  'cannedNotes',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',n.id,
      'category',n.category,
      'label',n.label,
      'text',n.note_text
    ) order by n.category,n.display_order,n.label)
    from public.canned_notes n
    where n.is_active
  ),'[]'::jsonb)
);
$function$;
