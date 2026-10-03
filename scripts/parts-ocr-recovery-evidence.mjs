/** Offline scoring and evidence only. This file is not an OCR runtime input. */
import fs from 'node:fs';
import path from 'node:path';
import {scoreRows,normalizeField,ALIGNMENT_VERSION} from './lib/parts-ocr-score-core.mjs';
import {auditFormalScope} from './parts-ocr-recovery-scope.mjs';
const flags=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,arr)=>i%2?a:[...a,[v,arr[i+1]]],[]));
if(!flags['--gt']||!flags['--manifest']||!flags['--input']||!flags['--output'])throw Error('Required --gt --manifest --input recovery-dir --output evidence-dir');
const gt=JSON.parse(fs.readFileSync(flags['--gt'])),manifest=JSON.parse(fs.readFileSync(flags['--manifest']));
if(gt.scoringOnly!==true||gt.runtimeUse!==false)throw Error('Scoring-only GT required');
const entries=[];
const taxonomy=['PAGE_DETECTION','PERSPECTIVE','ROW_DETECTION','COLUMN_DETECTION','TEXT_RECOGNITION','FIELD_ASSOCIATION','NUMERIC_PARSE','BLANK_SEMANTICS','FALSE_POSITIVE','FALSE_NEGATIVE','TIMEOUT','IMAGE_QUALITY','ARCHITECTURE_LIMIT'];
const models=['frozen-dedicated','frozen-general','p0-p1','p5-psm3','p5-psm6','p6-psm3'];
for(const mode of models){
 const input=path.join(flags['--input'],mode);if(!fs.existsSync(path.join(input,'index.json')))throw Error('Incomplete required fixed run: '+mode);
 for(const id of Object.keys(gt.images)) {
  const d=JSON.parse(fs.readFileSync(path.join(input,id+'.json'))),source=manifest.entries.find(e=>e.image_id===id);
  if(d.runtimeGtUsed!==false||d.sourceHash!==source?.derived_sha256)throw Error('Unverified runtime isolation/input hash: '+mode+'/'+id);
  const candidates=d.p0?[['P0_BAKEOFF_CONTROL',d.p0.rowPredictions],['P1_BAKEOFF_RULES',d.p1.rowPredictions]]:[...(d.strict?[['P5_STRICT',d.strict.rows]]:[]),...(d.variants??[]).map(v=>[v.variantId,v.rows])];
  const tokens=d.tokens??d.pages?.flatMap(p=>p.tokens)??[];
  for(const [candidate,rows] of candidates) {
   const actual=rows.map(row=>({...row,fields:Object.fromEntries(['name','qty','retail','cost'].map(f=>[f,typeof row.fields?.[f]==='object'?row.fields[f]:{normalized:row.fields?.[f]??''}]))}));
   const scored=scoreRows(gt.images[id].rows,actual),used=new Set(scored.rows.flatMap(r=>r.predictionIndex===null?[]:[r.predictionIndex]));
   const failures=[];
   for(const row of scored.rows) for(const [field,correct] of Object.entries(row.exact)) {
    const expected=normalizeField(field,gt.images[id].rows[row.expectedIndex][{name:'partName',qty:'qty',retail:'retail',cost:'cost'}[field]]);
    let dominant=null,confidence='OBSERVED',reason=null;
    if(correct)continue;
    if(d.timeout){dominant='TIMEOUT';reason='Runtime deadline exceeded';}
    else if(d.error){dominant='ARCHITECTURE_LIMIT';reason='Runtime execution error';}
    else if(row.predictionIndex===null){dominant='FALSE_NEGATIVE';reason='No row identity evidence met predeclared scoring alignment';}
    else if(!expected){dominant='BLANK_SEMANTICS';reason='Matched row contains text in a scoring-only blank field';}
    else if(tokens.some(t=>normalizeField(field,t.text)===expected)){dominant='FIELD_ASSOCIATION';confidence='SUPPORTED_NOT_CAUSAL';reason='Expected scalar exists in OCR token stream but not associated with scored field; repeated scalar ambiguity remains';}
    else {dominant='ARCHITECTURE_LIMIT';confidence='UNRESOLVED';reason='Mismatch observed; cannot separate recognition, segmentation and association without independent geometry GT';}
    failures.push({expectedIndex:row.expectedIndex,predictionIndex:row.predictionIndex,field,dominant,confidence,reason});
   }
   for(let i=0;i<actual.length;i++)if(!used.has(i))failures.push({expectedIndex:null,predictionIndex:i,field:null,dominant:'FALSE_POSITIVE',confidence:'OBSERVED',reason:'Predicted row has no scoring alignment; may be incorrect row or severely corrupted true row'});
   const observation=[];
   if(d.tokenCount===0)observation.push({category:'TEXT_RECOGNITION',confidence:'SUPPORTED_NOT_CAUSAL',reason:'Zero text tokens returned; image quality / orientation / preprocessing remains possible cause'});
   if(d.strict?.stageDiagnostics?.mappedHeaderFieldCount<4)observation.push({category:'COLUMN_DETECTION',confidence:'OBSERVED',reason:'Strict header reconstruction maps fewer than four fields',mappedHeaderFieldCount:d.strict.stageDiagnostics.mappedHeaderFieldCount});
   if(d.strict?.stageDiagnostics)observation.push({category:'ROW_DETECTION',confidence:'OBSERVED',reason:'Token row clustering count is observed and does not prove physical row segmentation',clusteredRowCount:d.strict.stageDiagnostics.clusteredRowCount,reconstructedRowCount:d.strict.stageDiagnostics.reconstructedRowCount});
   const measurement=d.p0?(candidate==='P0_BAKEOFF_CONTROL'?d.p0:d.p1):null;
   entries.push({imageId:id,subset:gt.images[id].subset==='YELLOW'?'YELLOW_DIAGNOSTIC_60':'WHITE_SESSION_15',mode,candidate,formal:false,timeout:d.timeout??false,error:d.error??null,processingMs:measurement?measurement.processingTimeMs+measurement.modelLoadTimeMs:d.totalMs??null,sharedRunTotalMs:d.totalMs??null,sourceHash:d.sourceHash,...scored,failures,observations:observation});
  }
 }
}
const aggregates=[];
for(const mode of models)for(const candidate of [...new Set(entries.filter(e=>e.mode===mode).map(e=>e.candidate))])for(const subset of ['YELLOW_DIAGNOSTIC_60','WHITE_SESSION_15']) {
 const records=entries.filter(e=>e.mode===mode&&e.candidate===candidate&&e.subset===subset);if(!records.length)continue;
 const sum=k=>records.reduce((s,r)=>s+(r[k]??0),0);
 aggregates.push({mode,candidate,subset,images:records.length,expectedRows:sum('expectedRows'),detectedRows:sum('detectedRows'),matchedRows:sum('matchedRows'),correctRows:sum('completeRows'),falseRows:sum('falseRows'),missedRows:sum('missingRows'),fields:Object.fromEntries(['name','qty','retail','cost'].map(f=>[f,{correct:records.reduce((s,r)=>s+r.fields[f].correct,0),total:sum('expectedRows')}])),blank:{correct:records.reduce((s,r)=>s+r.blank.correct,0),total:records.reduce((s,r)=>s+r.blank.total,0),falseNonBlank:records.reduce((s,r)=>s+r.blank.falseNonBlank,0)},timeouts:records.filter(r=>r.timeout).length,errors:records.filter(r=>r.error).length,totalMs:sum('processingMs')});
}
fs.mkdirSync(flags['--output'],{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(flags['--output'],name),JSON.stringify(value,null,2)+'\n');
write('formal-scope-gate.json',auditFormalScope(gt,manifest));
const baselineCorrect=aggregates.filter(a=>a.mode.startsWith('frozen')).reduce((max,a)=>Math.max(max,a.correctRows),0);
const candidateCorrect=aggregates.filter(a=>!a.mode.startsWith('frozen')).reduce((max,a)=>Math.max(max,a.correctRows),0);
const decision=candidateCorrect>baselineCorrect?'REVIEW_CANDIDATES_FORMAL_GATE_HOLD':'NO_COMPLETE_ROW_IMPROVEMENT_ARCHITECTURE_CHANGE_REQUIRED';
write('architecture-comparison.json',{schema:'icb.parts-recovery-comparison.v1',scoringOnly:true,formalAdoptionAllowed:false,alignmentVersion:ALIGNMENT_VERSION,decision,runtimeGtUsed:false,timeMeasurement:'Model load plus per-candidate execution; shared-load observational timings, not controlled benchmarks; mapping variants reuse recognition so do not sum their times',aggregates});
write('failure-taxonomy.json',{schema:'icb.parts-recovery-taxonomy.v1',scoringOnly:true,taxonomy,causalLimits:'Absent independent region/row/column geometry GT, false/missed alignment counts are operational scoring observations, not physical segmentation measurements. Unobserved causes remain unresolved.',entries});
console.log(JSON.stringify({modes:[...new Set(entries.map(e=>e.mode))],records:entries.length,formalAdoptionAllowed:false}));
