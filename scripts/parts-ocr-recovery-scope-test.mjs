import assert from 'node:assert/strict';
import {FORMAL_COUNTS,auditFormalScope} from './parts-ocr-recovery-scope.mjs';
const gt={images:{}},manifest={entries:[]};
for(const [subset,counts] of Object.entries(FORMAL_COUNTS)) for(const [id,n] of Object.entries(counts)) {
  gt.images[id]={subset,rows:Array.from({length:n},()=>({}))};
  manifest.entries.push({image_id:id,sha256:'source',formalIdentity:{status:'VERIFIED',sourceSha256:'source',reviewCopySha256:'review',evidence:'independent content audit'}});
}
assert.equal(auditFormalScope(gt,manifest).formalAdoptionAllowed,true);
gt.images.IMG_0677.rows.push({});
assert.equal(auditFormalScope(gt,manifest).formalAdoptionAllowed,false);
gt.images.IMG_0677.rows.pop();
manifest.entries[0].formalIdentity.sourceSha256='other';
assert.equal(auditFormalScope(gt,manifest).formalAdoptionAllowed,false);
manifest.entries[0].formalIdentity.sourceSha256='source';
delete manifest.entries[0].formalIdentity.reviewCopySha256;
assert.equal(auditFormalScope(gt,manifest).formalAdoptionAllowed,false);
console.log('Formal scoring gate: conflicting count / altered source / absent identity proof rejected; verified set accepted (4 assertions).');
