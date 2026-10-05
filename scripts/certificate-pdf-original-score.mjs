// Scoring only. This script is never imported by the app or PDF runtime.
// Usage: node scripts/certificate-pdf-original-score.mjs EXPECTED_JSON CAPTURE_JSON PUBLIC_MATRIX_JSON
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [expectedPath,capturePath,outputPath]=process.argv.slice(2);
assert(expectedPath&&capturePath&&outputPath,'Expected, capture and matrix paths required');
const expected=JSON.parse(fs.readFileSync(expectedPath));
const capture=JSON.parse(fs.readFileSync(capturePath));
assert.equal(expected.cases.length,capture.results.length,'Complete inventory required');
const page=fs.readFileSync(new URL('../app/vehicle-workflow-fast/page.tsx',import.meta.url),'utf8');
const fields=page.split('const FIELDS = [')[1].split('] as const;')[0];
const labels=Object.fromEntries([...fields.matchAll(/\["([^"]+)","([^"]+)"\]/g)].map(m=>[m[2],m[1]]));
Object.assign(labels,{'所有者氏名':'ownerName','所有者住所':'ownerAddress'});
const norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const cases=capture.results.map((r,i)=>{
 const actual=Object.fromEntries(r.copy.split('\n').slice(1).filter(l=>l.includes('：')).map(l=>{const at=l.indexOf('：'),label=l.slice(0,at);return[labels[label]||label,l.slice(at+1)]}));
 const cells=Object.entries(expected.cases[i]).map(([field,v])=>{
  const en=norm(v);let an=norm(actual[field]);
  if(['seatingCapacity','maxPayloadKg','grossVehicleWeightKg'].includes(field))an=an.replace(/\[\d+\]/g,'');
  return{field,pass:en===an,expectedSha256:hash(en),actualSha256:hash(an),sourcePath:`${r.sha256}:page1`,expectedPresent:Boolean(en),actualPresent:Boolean(an)};
 });
 return{caseId:r.caseId,sha256:r.sha256,scored:cells.length,passed:cells.filter(c=>c.pass).length,failed:cells.filter(c=>!c.pass).length,cells};
});
const result={source:'Actual CURRENT form copy; source-derived expected scoring only',normalization:'NFKC and whitespace; numeric primary separately from Raw bracket alternatives',cases,scored:cases.reduce((n,c)=>n+c.scored,0),passed:cases.reduce((n,c)=>n+c.passed,0),failed:cases.reduce((n,c)=>n+c.failed,0),casePass:cases.filter(c=>!c.failed).length,humanAcceptance:false};
fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({scored:result.scored,passed:result.passed,failed:result.failed,casePass:result.casePass}));
if(result.failed)process.exitCode=1;
