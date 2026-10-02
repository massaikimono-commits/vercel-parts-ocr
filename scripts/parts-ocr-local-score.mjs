/** Evaluate complete fixed sets; output metrics only, no invoice OCR text. */
import fs from 'node:fs';import path from 'node:path';
import {scoreRows,ALIGNMENT_VERSION} from './lib/parts-ocr-score-core.mjs';
const flags=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,arr)=>i%2?[...a]:[...a,[x,arr[i+1]]],[]));
if(!flags['--gt']||!flags['--input']||!flags['--output'])throw Error('Required: --gt scoring-only.json --input private-result-dir --output metrics.json');
const gt=JSON.parse(fs.readFileSync(flags['--gt'],'utf8'));if(gt.scoringOnly!==true)throw Error('GT must be scoring-only');
const expectedIds=Object.keys(gt.images),entries=[];
for(const id of expectedIds){
 const file=path.join(flags['--input'],id+'.json');if(!fs.existsSync(file))throw Error('Incomplete fixed set: '+id);
 const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d.runtimeGtUsed!==false)throw Error('Unproven runtime GT isolation');
 const candidates=d.p0?[['P0_BAKEOFF_CONTROL',d.p0.rowPredictions],['P1_BAKEOFF_RULES',d.p1.rowPredictions]]:d.error?[['EXECUTION_FAILURE',[]]]:[['P5_STRICT',d.strict?.rows??[]],...(d.variants??[]).map(v=>[v.variantId,v.rows])];
 for(const[candidate,rows]of candidates){
 const normalized=rows.map(row=>({...row,fields:Object.fromEntries(['name','qty','retail','cost'].map(f=>[f,typeof row.fields?.[f]==='object'?row.fields[f]:{normalized:row.fields?.[f]??''}]))}));
 entries.push({imageId:id,subset:gt.images[id].subset,identityStatus:gt.images[id].identityStatus,candidate,mode:d.mode,timeout:d.timeout??false,error:d.error??null,processingMs:d.totalMs??null,tokenCount:d.tokenCount??null,...scoreRows(gt.images[id].rows,normalized)});
 }
}
const aggregates=[];
for(const candidate of [...new Set(entries.map(e=>e.candidate))])for(const subset of ['YELLOW','WHITE_SESSION']){
 const rows=entries.filter(e=>e.candidate===candidate&&e.subset===subset);if(!rows.length)continue;
 const sum=key=>rows.reduce((s,e)=>s+e[key],0);
 aggregates.push({candidate,subset,images:rows.length,expectedRows:sum('expectedRows'),detectedRows:sum('detectedRows'),matchedRows:sum('matchedRows'),missingRows:sum('missingRows'),falseRows:sum('falseRows'),completeRows:sum('completeRows'),fields:Object.fromEntries(['name','qty','retail','cost'].map(f=>[f,{correct:rows.reduce((s,e)=>s+e.fields[f].correct,0),total:sum('expectedRows')}])),blank:{correct:rows.reduce((s,e)=>s+e.blank.correct,0),total:rows.reduce((s,e)=>s+e.blank.total,0),falseNonBlank:rows.reduce((s,e)=>s+e.blank.falseNonBlank,0)},timeouts:rows.filter(e=>e.timeout).length,errors:rows.filter(e=>e.error).length,totalMs:rows.reduce((s,e)=>s+(e.processingMs??0),0)});
}
fs.writeFileSync(flags['--output'],JSON.stringify({schema:'icb.parts-local-metrics.v1',scoringOnly:true,alignmentVersion:ALIGNMENT_VERSION,scope:gt.scope,formalAdoptionAllowed:false,aggregates,entries},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(aggregates,null,2));
