// Evaluation only. Never imported by OCR runtime. Run after immutable acquisition.
import fs from 'node:fs';
import {scoreRows,ALIGNMENT_VERSION} from './lib/parts-ocr-score-core.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const out='evidence/parts-overnight-20261003';
const gt=read('/Users/massa_ikimono/Developer/development-orchestrator/.orchestrator/overnight-inputs/scoring-only.json');
const synthetic=read('.eval-private/overnight/synthetic-dev/scoring-only.json');
const records=[], aggregates=new Map();
for(const [kind,dir] of [['REAL_DIAGNOSTIC','.eval-private/overnight/real-frozen-results'],['SYNTHETIC_DEVELOPMENT','.eval-private/overnight/synthetic-frozen-results']]){
 const index=read(`${dir}/index.json`);
 if(index.runtimeGtUsed!==false)throw Error('GT boundary');
 for(const entry of index.entries){
  const result=read(`${dir}/${entry.imageId}.json`);
  if(result.runtimeGtUsed!==false||result.sourceHash!==entry.sourceHash)throw Error('provenance');
  const expected=kind==='REAL_DIAGNOSTIC'?gt.images[entry.imageId]:synthetic.entries.find(x=>x.image_id===entry.imageId);
  const subset=kind==='SYNTHETIC_DEVELOPMENT'?kind:expected.subset==='YELLOW'?'YELLOW_DIAGNOSTIC_60':'WHITE_SESSION_15';
  for(const v of result.variants){
   const score=scoreRows(expected.rows,v.rows);
   const diagnostics=(v.diagnostics??[]).filter(x=>typeof x==='string');
   const dominant=v.timeout?'TIMEOUT':v.error?'ARCHITECTURE_LIMIT':diagnostics.some(x=>/ORIENTATION/.test(x))?'PERSPECTIVE':diagnostics.some(x=>/RECTANGLE/.test(x))?'PAGE_DETECTION':diagnostics.some(x=>/header/.test(x))?'COLUMN_DETECTION':v.rows.length===0?'ROW_DETECTION':'FIELD_ASSOCIATION';
   const fields={};for(const row of v.rows)for(const [f,x]of Object.entries(row.fields??{})){const k=`${f}:${x.status}`;fields[k]=(fields[k]??0)+1;}
   records.push({kind,subset,imageId:entry.imageId,variant:v.variantId,sourceHash:entry.sourceHash,score,dominantFailure:dominant,diagnostics,fieldStatusCounts:fields,timeout:!!v.timeout,error:v.error??null,incrementalMs:v.processingMs,rows:score.rows.map(r=>({...r,dominantFailure:r.complete?null:r.predictionIndex===null?dominant:'FIELD_ASSOCIATION',fieldFailures:Object.fromEntries(Object.entries(r.exact).map(([f,ok])=>[f,ok?null:r.predictionIndex===null?dominant:'FIELD_ASSOCIATION']))}))});
   const key=`${subset}:${v.variantId}`;
   if(!aggregates.has(key))aggregates.set(key,{subset,variant:v.variantId,images:0,expectedRows:0,detectedRows:0,matchedRows:0,completeRows:0,falseRows:0,missingRows:0,fields:Object.fromEntries(['name','qty','retail','cost'].map(f=>[f,{correct:0,total:0}])),blank:{correct:0,total:0,falseNonBlank:0},timeouts:0,errors:0,incrementalMs:0,failures:{}});
   const a=aggregates.get(key);a.images++;for(const k of ['expectedRows','detectedRows','matchedRows','completeRows','falseRows','missingRows'])a[k]+=score[k];for(const f of Object.keys(a.fields))for(const k of ['correct','total'])a.fields[f][k]+=score.fields[f][k];for(const k of Object.keys(a.blank))a.blank[k]+=score.blank[k];a.timeouts+=!!v.timeout;a.errors+=!!v.error;a.incrementalMs+=v.processingMs??0;a.failures[dominant]=(a.failures[dominant]??0)+1;
  }
 }
}
const summary={schema:'icb.parts-overnight-scoring.v1',scoringOnly:true,runtimeGtUsed:false,alignmentVersion:ALIGNMENT_VERSION,formalAdoptionAllowed:false,decision:'NO_ADOPTION_ARCHITECTURE_CHANGE_REQUIRED',latencyCaveat:'Incremental shared-cache timings; not independent cold benchmarks. Node peak is whole-matrix cumulative; native/GPU/mobile peaks are not equivalent.',aggregates:[...aggregates.values()],baseline:read('evidence/real-photo-recovery-20261003/architecture-comparison.json'),generalization:{additionalRealPhotos:0,unknownReal:'NOT_VERIFIED',syntheticDevelopmentOnly:true},taxonomyCaveat:'Dominant categories are observable stage attribution, not proven pixel-level root causes; alignment false/missing rows are not physical segmentation counts.',taxonomyCategories:['PAGE_DETECTION','PERSPECTIVE','ROW_DETECTION','COLUMN_DETECTION','TEXT_RECOGNITION','FIELD_ASSOCIATION','NUMERIC_PARSE','BLANK_SEMANTICS','FALSE_POSITIVE','FALSE_NEGATIVE','TIMEOUT','IMAGE_QUALITY','ARCHITECTURE_LIMIT']};
fs.writeFileSync(`${out}/scoring-summary.json`,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(`${out}/failure-taxonomy.json`,JSON.stringify({scoringOnly:true,records},null,2)+'\n');
console.log(JSON.stringify(summary.aggregates));
