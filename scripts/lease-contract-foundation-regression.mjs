import fs from "node:fs";

const sql = fs.readFileSync("database/lease-maintenance-contract-foundation.sql", "utf8");

const checks = [
  ["contract table exists", /create table if not exists public\.lease_maintenance_contracts/i.test(sql)],
  ["vehicle history link exists", /vehicle_id uuid not null references public\.vehicles\(id\) on delete cascade/i.test(sql)],
  ["source document link exists", /source_document_id uuid references public\.vehicle_documents\(id\) on delete set null/i.test(sql)],
  ["contract period stored", /contract_start_date date/.test(sql) && /contract_end_date date/.test(sql)],
  ["substitute-car detail fields stored",
    /substitute_car_state text/.test(sql) &&
    /substitute_car_eligible_work_types text\[\]/.test(sql) &&
    /substitute_car_start_day integer/.test(sql) &&
    /substitute_car_max_days integer/.test(sql)
  ],
  ["inspection intervals stored", /inspection_intervals_months integer\[\]/.test(sql)],
  ["battery and tire terms stored",
    /battery_contract_state/.test(sql) &&
    /summer_tire_contract_state/.test(sql) &&
    /winter_tire_contract_state/.test(sql) &&
    /tire_storage_contract_state/.test(sql)
  ],
  ["oil special interval stored", /oil_interval_km integer/.test(sql)],
  ["tire maker restriction stored", /tire_maker_restriction_state/.test(sql) && /tire_maker_names text\[\]/.test(sql)],
  ["evidence preserved", /evidence jsonb not null/.test(sql) && /raw_extracted jsonb not null/.test(sql)],
  ["four-state semantics enforced", /'yes','no','not_stated','needs_review'/.test(sql)],
  ["RLS enabled", /alter table public\.lease_maintenance_contracts enable row level security/i.test(sql)],
  ["active app-user policy", /is_active_app_user\(\)/.test(sql)],
  ["anon table access revoked", /revoke all on table public\.lease_maintenance_contracts from anon/i.test(sql)],
  ["rental eligibility helper exists", /create or replace function public\.lease_rental_eligibility/i.test(sql)],
  ["missing contract is fail-closed", /リース整備契約が未登録です/.test(sql)],
  ["expired contract is fail-closed", /契約期限経過・要確認/.test(sql)],
  ["no substitute-car rider blocks rental", /代車特約なしのためレンタカーは選択できません/.test(sql)],
  ["work-type eligibility checked", /substitute_car_eligible_work_types/.test(sql) && /この入庫理由は代車特約の対象外です/.test(sql)],
  ["start-day condition checked", /レンタカーは入庫%s日目から利用可能です/.test(sql)],
  ["duration limit checked", /レンタカー利用上限は%s日です/.test(sql)],
  ["anon eligibility RPC revoked", /revoke all on function public\.lease_rental_eligibility[\s\S]*from anon/i.test(sql)],
  ["no current loaner assignment mutation",
    !/alter table public\.loaner_reservations/i.test(sql) &&
    !/create trigger[\s\S]*loaner_reservations/i.test(sql) &&
    !/create or replace function public\.assign_loaner_to_booking/i.test(sql)
  ],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`Lease contract foundation regression failed: ${failed} check(s)`);
  process.exit(1);
}

console.log(`All ${checks.length} lease contract foundation checks passed.`);
