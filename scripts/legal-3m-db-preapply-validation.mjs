import fs from 'node:fs';
const path='supabase/migrations/20260918070200_add_legal_3m_inspection.sql';
const sql=fs.readFileSync(path,'utf8');
const failures=[];
const check=(name,ok)=>{if(!ok) failures.push(name)};
check('migration targets existing constraint',sql.includes('work_orders_inspection_schedule_type_check'));
check('legal_3m allowed',sql.includes("'legal_3m'::text"));
check('daily report exact mark 3',sql.includes("p_inspection_schedule_type='legal_3m' then '3'"));
check('catalog exact compact label 法3',sql.includes("'key','legal_3m','label','法3'"));
check('schedule retained',sql.includes("'schedule'::text"));
check('legal_6m retained',sql.includes("'legal_6m'::text"));
check('legal_12m retained',sql.includes("'legal_12m'::text"));
check('no new column',!/add\s+column/i.test(sql));
check('no destructive data statement',!/(delete\s+from|truncate\s+|drop\s+table)/i.test(sql));
if(failures.length){console.error('legal_3m DB pre-apply validation FAIL'); failures.forEach(x=>console.error('- '+x)); process.exit(1)}
console.log('legal_3m DB pre-apply validation PASS');
