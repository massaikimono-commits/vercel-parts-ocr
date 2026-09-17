import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260918070200_add_legal_3m_inspection.sql','utf8');
const failures = [];
const expect = (name, condition) => { if (!condition) failures.push(name); };

expect('constraint includes legal_3m', migration.includes("'legal_3m'::text"));
expect('daily report legal_3m maps to 3', /p_inspection_schedule_type='legal_3m' then '3'/.test(migration));
expect('quick choice exposes legal_3m / 法3', /'key','legal_3m','label','法3'/.test(migration));
expect('schedule preserved', /'schedule'::text/.test(migration));
expect('legal_6m preserved', /'legal_6m'::text/.test(migration));
expect('legal_12m preserved', /'legal_12m'::text/.test(migration));
expect('no new work_orders column', !/alter table public\.work_orders\s+add column/i.test(migration));

if (failures.length) {
  console.error('legal_3m parent-spec regression FAIL');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('legal_3m parent-spec regression PASS');
