-- Lease maintenance contract foundation.
-- 2026-09-02
--
-- Purpose:
-- - Preserve lease-maintenance contract history per vehicle.
-- - Store only operational contract terms separately from inspection-record fields.
-- - Keep source PDF linkage/evidence for review.
-- - Provide a fail-closed rental-company eligibility check.
-- - Do NOT change current loaner assignment behavior yet. UI/DB enforcement is connected
--   only after real contract PDFs are validated and contract data is populated.

create table if not exists public.lease_maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  source_document_id uuid references public.vehicle_documents(id) on delete set null,

  contract_number text,
  contract_start_date date,
  contract_end_date date,

  substitute_car_state text not null default 'needs_review'
    check (substitute_car_state in ('yes','no','not_stated','needs_review')),
  substitute_car_eligible_work_types text[] not null default '{}'::text[],
  substitute_car_start_day integer
    check (substitute_car_start_day is null or substitute_car_start_day >= 1),
  substitute_car_max_days integer
    check (substitute_car_max_days is null or substitute_car_max_days >= 1),
  substitute_car_notes text,

  inspection_timing_state text not null default 'needs_review'
    check (inspection_timing_state in ('yes','no','not_stated','needs_review')),
  inspection_intervals_months integer[] not null default '{}'::integer[],

  battery_contract_state text not null default 'needs_review'
    check (battery_contract_state in ('yes','no','not_stated','needs_review')),
  summer_tire_contract_state text not null default 'needs_review'
    check (summer_tire_contract_state in ('yes','no','not_stated','needs_review')),
  winter_tire_contract_state text not null default 'needs_review'
    check (winter_tire_contract_state in ('yes','no','not_stated','needs_review')),
  tire_storage_contract_state text not null default 'needs_review'
    check (tire_storage_contract_state in ('yes','no','not_stated','needs_review')),

  oil_interval_state text not null default 'needs_review'
    check (oil_interval_state in ('yes','no','not_stated','needs_review')),
  oil_interval_km integer
    check (oil_interval_km is null or oil_interval_km > 0),

  tire_maker_restriction_state text not null default 'needs_review'
    check (tire_maker_restriction_state in ('yes','no','not_stated','needs_review')),
  tire_maker_names text[] not null default '{}'::text[],

  evidence jsonb not null default '{}'::jsonb,
  raw_extracted jsonb not null default '{}'::jsonb,
  notes text,

  needs_review boolean not null default true,
  reviewed_by text,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    contract_start_date is null
    or contract_end_date is null
    or contract_end_date >= contract_start_date
  )
);

create unique index if not exists lease_maintenance_contracts_source_document_uidx
  on public.lease_maintenance_contracts(source_document_id)
  where source_document_id is not null;

create index if not exists lease_maintenance_contracts_vehicle_dates_idx
  on public.lease_maintenance_contracts(
    vehicle_id,
    contract_start_date desc nulls last,
    contract_end_date desc nulls last,
    created_at desc
  );

alter table public.lease_maintenance_contracts enable row level security;

drop policy if exists authenticated_full_access_lease_maintenance_contracts
  on public.lease_maintenance_contracts;

create policy authenticated_full_access_lease_maintenance_contracts
  on public.lease_maintenance_contracts
  for all
  to authenticated
  using ((select public.is_active_app_user()))
  with check ((select public.is_active_app_user()));

revoke all on table public.lease_maintenance_contracts from public;
revoke all on table public.lease_maintenance_contracts from anon;
grant select, insert, update, delete
  on table public.lease_maintenance_contracts
  to authenticated;

create or replace function public.touch_lease_maintenance_contract_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists lease_maintenance_contracts_touch_updated_at
  on public.lease_maintenance_contracts;

create trigger lease_maintenance_contracts_touch_updated_at
before update on public.lease_maintenance_contracts
for each row
execute function public.touch_lease_maintenance_contract_updated_at();

revoke all on function public.touch_lease_maintenance_contract_updated_at() from public;
revoke all on function public.touch_lease_maintenance_contract_updated_at() from anon;
grant execute on function public.touch_lease_maintenance_contract_updated_at() to authenticated;
grant execute on function public.touch_lease_maintenance_contract_updated_at() to service_role;

create or replace function public.lease_rental_eligibility(
  p_vehicle_id uuid,
  p_work_reason text,
  p_work_start_at timestamptz,
  p_rental_start_at timestamptz,
  p_rental_end_at timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_contract public.lease_maintenance_contracts%rowtype;
  v_work_day date;
  v_rental_start_day date;
  v_rental_end_day date;
  v_start_day integer;
  v_rental_day_index integer;
  v_rental_days integer;
begin
  if p_vehicle_id is null then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', '車両が特定できません',
      'contract_id', null
    );
  end if;

  v_work_day := coalesce(
    (p_work_start_at at time zone 'Asia/Tokyo')::date,
    current_date
  );
  v_rental_start_day := coalesce(
    (p_rental_start_at at time zone 'Asia/Tokyo')::date,
    v_work_day
  );
  v_rental_end_day := case
    when p_rental_end_at is null then null
    else (p_rental_end_at at time zone 'Asia/Tokyo')::date
  end;

  -- The newest imported contract wins for review purposes.
  -- If that newest contract is still unreviewed, rental-company use stays fail-closed
  -- rather than silently falling back to an older contract.
  select c.*
  into v_contract
  from public.lease_maintenance_contracts c
  where c.vehicle_id = p_vehicle_id
  order by
    coalesce(c.contract_start_date, c.created_at::date) desc,
    c.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', 'リース整備契約が未登録です',
      'contract_id', null
    );
  end if;

  if v_contract.needs_review then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', '最新のリース整備契約が未確認です',
      'contract_id', v_contract.id
    );
  end if;

  if v_contract.contract_start_date is null or v_contract.contract_end_date is null then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', '契約期間が確認できません',
      'contract_id', v_contract.id
    );
  end if;

  if v_work_day < v_contract.contract_start_date then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', '契約開始日前です',
      'contract_id', v_contract.id,
      'contract_start_date', v_contract.contract_start_date,
      'contract_end_date', v_contract.contract_end_date
    );
  end if;

  if v_work_day > v_contract.contract_end_date then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', '契約期限経過・要確認',
      'contract_id', v_contract.id,
      'contract_start_date', v_contract.contract_start_date,
      'contract_end_date', v_contract.contract_end_date
    );
  end if;

  if v_contract.substitute_car_state = 'no' then
    return jsonb_build_object(
      'allowed', false,
      'state', 'ineligible',
      'reason', '代車特約なしのためレンタカーは選択できません',
      'contract_id', v_contract.id
    );
  end if;

  if v_contract.substitute_car_state in ('not_stated','needs_review') then
    return jsonb_build_object(
      'allowed', false,
      'state', 'needs_review',
      'reason', '代車特約の記載を確認してください',
      'contract_id', v_contract.id
    );
  end if;

  if coalesce(cardinality(v_contract.substitute_car_eligible_work_types), 0) > 0
     and not (p_work_reason = any(v_contract.substitute_car_eligible_work_types)) then
    return jsonb_build_object(
      'allowed', false,
      'state', 'ineligible',
      'reason', 'この入庫理由は代車特約の対象外です',
      'contract_id', v_contract.id,
      'eligible_work_types', to_jsonb(v_contract.substitute_car_eligible_work_types)
    );
  end if;

  v_start_day := coalesce(v_contract.substitute_car_start_day, 1);
  v_rental_day_index := (v_rental_start_day - v_work_day) + 1;

  if v_rental_day_index < v_start_day then
    return jsonb_build_object(
      'allowed', false,
      'state', 'ineligible',
      'reason', format('レンタカーは入庫%s日目から利用可能です', v_start_day),
      'contract_id', v_contract.id,
      'available_from_day', v_start_day
    );
  end if;

  if v_contract.substitute_car_max_days is not null and v_rental_end_day is not null then
    v_rental_days := (v_rental_end_day - v_rental_start_day) + 1;
    if v_rental_days > v_contract.substitute_car_max_days then
      return jsonb_build_object(
        'allowed', false,
        'state', 'ineligible',
        'reason', format('レンタカー利用上限は%s日です', v_contract.substitute_car_max_days),
        'contract_id', v_contract.id,
        'max_days', v_contract.substitute_car_max_days
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'state', 'eligible',
    'reason', 'リース整備契約のレンタカー条件を満たしています',
    'contract_id', v_contract.id,
    'contract_start_date', v_contract.contract_start_date,
    'contract_end_date', v_contract.contract_end_date,
    'eligible_work_types', to_jsonb(v_contract.substitute_car_eligible_work_types),
    'available_from_day', v_start_day,
    'max_days', v_contract.substitute_car_max_days
  );
end;
$function$;

revoke all on function public.lease_rental_eligibility(uuid,text,timestamptz,timestamptz,timestamptz)
  from public;
revoke all on function public.lease_rental_eligibility(uuid,text,timestamptz,timestamptz,timestamptz)
  from anon;
grant execute on function public.lease_rental_eligibility(uuid,text,timestamptz,timestamptz,timestamptz)
  to authenticated;
grant execute on function public.lease_rental_eligibility(uuid,text,timestamptz,timestamptz,timestamptz)
  to service_role;
