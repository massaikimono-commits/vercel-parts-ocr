import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCertificatePdfSemanticFields,normalizePdfIdentity,reconcilePdfSemanticPatch,extractPdfTableLines} from '../app/lib/certificate-pdf-field-semantics.mjs';
const norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
let fields=0;
for(let n=1;n<=8;n++){
 const f=JSON.parse(fs.readFileSync(new URL(`../test/fixtures/certificate-pdf-ruled/layout-${n}.json`,import.meta.url)));
 for(const shift of [0,.009]){
  const tokens=f.tokens.map(t=>({...t,x:t.x*.96+shift,y:t.y*.96+shift,w:t.w*.96,h:t.h*.96}));
  const lines=f.tableLines.map(l=>({...l,at:l.at*.96+shift,start:l.start*.96+shift,end:l.end*.96+shift}));
  const out=parseCertificatePdfSemanticFields(tokens,lines);
  for(const [key,v] of Object.entries(f.expected)){
   let actual=norm(out[key]);if(['seatingCapacity','maxPayloadKg','grossVehicleWeightKg'].includes(key))actual=actual.replace(/\[\d+\]/g,'');
   assert.equal(actual,norm(v),`layout ${n} shift ${shift} ${key}`);fields++;
  }
 }
}
for(const phrase of ['使用者住所に同じ','使用者の住所に同じ','使 用 者 の 住 所 に 同 じ']){
 const p=normalizePdfIdentity({userNameRaw:'株式会社サンプル',userAddressRaw:'東京都例示区1-2',ownerNameRaw:'使用者に同じ',ownerAddressRaw:phrase});
 assert.equal(p.ownerName,p.userName);assert.equal(p.ownerAddress,p.userAddress);assert.equal(p.ownerAddressStatus,'SAME_AS_USER');
}
const mask=normalizePdfIdentity({ownerNameRaw:'所有者例',userNameRaw:'* * *',userAddressRaw:'***'});
assert.equal(mask.userName,'');assert.equal(mask.userNameStatus,'MASKED');assert.equal(mask.userAddress,'');
const unresolved=normalizePdfIdentity({ownerNameRaw:'使用者に同じ',userNameRaw:'***'});
assert.equal(unresolved.ownerName,'');assert.equal(unresolved.ownerNameStatus,'UNRESOLVED_SAME_AS_USER');
// Vary the numeric value and printed unit; alternate unit legend is closer in
// reading order, but farther from the value's baseline.
const T=(text,x,y,w=.05,h=.01)=>({text,x,y,w,h});
for(const [value,unit] of [['2.37','L'],['91','kW']]){
 const p=parseCertificatePdfSemanticFields([T('総排気量又は定格出力',.1,.2,.22),T('kW',.4,.205),T(value,.34,.22),T(unit,.4,.22)]);
 assert.equal(p.displacementOrRatedOutput,`${value} ${unit}`);
}
const corrected=reconcilePdfSemanticPatch({vehicleWeightKg:'777',userAddress:'使用者の住所',other:'keep'},{vehicleWeightKg:'888',userAddress:'',__pdfGeneralizationEvidence:{clearedFields:['userAddress']}});
assert.equal(corrected.vehicleWeightKg,'888');assert.equal(corrected.userAddress,'');assert.equal(corrected.other,'keep');
// PDF text clipping rectangles are not table rules. Only stroked paths count.
const OPS={constructPath:1,rectangle:2,endPath:3,stroke:4,save:5,restore:6,transform:7};
const list={fnArray:[1,3,1,4],argsArray:[[[2],[10,10,50,40]],[],[[2],[20,20,50,40]],[]]};
const lines=extractPdfTableLines(list,OPS,100,100);assert.equal(lines.length,4);assert.ok(lines.every(l=>l.at!==.1));
console.log(`PASS Certificate PDF semantic fields: 8 layouts, ${fields} field checks, geometry changes, same-as/masked, L/kW, reconciliation and stroked-rule classification`);
