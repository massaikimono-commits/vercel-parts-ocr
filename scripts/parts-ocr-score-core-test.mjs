import assert from 'node:assert/strict';import {scoreRows,alignRows} from './lib/parts-ocr-score-core.mjs';
const expected=[{partName:'FILTER',qty:'1',retail:'1200',cost:''}];
const row=(name,qty,retail,cost)=>({fields:Object.fromEntries(Object.entries({name,qty,retail,cost}).map(([k,v])=>[k,{normalized:v}]))});
const missing=scoreRows(expected,[]);assert.equal(missing.fields.cost.correct,0);assert.equal(missing.blank.correct,0);assert.equal(missing.missingRows,1);
const perfect=scoreRows(expected,[row('FILTER','1','1200','')]);assert.equal(perfect.completeRows,1);assert.equal(perfect.blank.correct,1);
assert.equal(scoreRows(expected,[row('FILTER','1','1200','1200')]).blank.falseNonBlank,1);
assert.equal(alignRows(expected,[row('WRONG','1','999','')]).length,0);
assert.equal(scoreRows(expected,[row('FILTER','1','1200',''),row('FILTER','1','1200','')]).falseRows,1);
console.log('Scoring alignment / missing-row blank protection: 8 assertions PASS');
