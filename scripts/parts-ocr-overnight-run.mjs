/** Private image execution only: never reads scoring-only labels. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runArchitectureMatrix,EXPERIMENT_CONTRACT} from './lib/parts-ocr-overnight-runtime.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const root=path.resolve(import.meta.dirname,'..');
const flags=Object.fromEntries(process.argv.slice(2).reduce((rows,value,index,args)=>index%2?rows:[...rows,[value,args[index+1]]],[]));
async function main(){
 if(process.argv[2]==='--child'){
  const config=JSON.parse(fs.readFileSync(0,'utf8')),started=performance.now();
  const result=await runArchitectureMatrix(config.file,config);
  result.sourceHash=hash(fs.readFileSync(config.file));result.imageId=config.imageId;result.totalMs=Math.round(performance.now()-started);
  fs.writeFileSync(config.output,JSON.stringify(result)+'\n',{flag:'wx'});return;
 }
 if(!flags['--manifest']||!flags['--output']||!flags['--lang-dir']||!flags['--vision'])throw Error('Required --manifest --output --lang-dir --vision');
 const out=path.resolve(flags['--output']);if(fs.existsSync(out))throw Error('Output must be fresh');fs.mkdirSync(out,{recursive:true});
 const input=JSON.parse(fs.readFileSync(flags['--manifest']));
 // Narrow, acquisition-only manifest. GT-shaped input is rejected even when unused.
 if(input.scoringOnly||input.runtimeUse===false||input.images||input.entries?.some(e=>e.rows||e.expected||e.partName||e.qty||e.retail||e.cost))throw Error('Runtime manifest must not contain scoring labels');
 const variants=flags['--variants']?flags['--variants'].split(','):EXPERIMENT_CONTRACT.variants;
 if(variants.some(v=>!EXPERIMENT_CONTRACT.variants.includes(v)))throw Error('Unregistered variant');
 const freeze=flags['--freeze']?JSON.parse(fs.readFileSync(flags['--freeze'])):null;
 if(freeze)for(const file of freeze.files)if(hash(fs.readFileSync(path.join(root,file.path)))!==file.sha256)throw Error('Frozen runtime changed: '+file.path);
 const index=[];
 for(const entry of input.entries){
  if(flags['--only']&&flags['--only']!==entry.image_id)continue;
  const file=path.resolve(entry.derived_path),sourceHash=hash(fs.readFileSync(file));
  if(entry.derived_sha256&&entry.derived_sha256!==sourceHash)throw Error('Image byte hash mismatch');
  const output=path.join(out,entry.image_id+'.json'),config={imageId:entry.image_id,file,output,outputDir:path.join(out,entry.image_id+'-private'),langDir:path.resolve(flags['--lang-dir']),visionBinary:path.resolve(flags['--vision']),variants};
  const started=performance.now(),child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child'],{input:JSON.stringify(config),encoding:'utf8',cwd:root,timeout:600000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:process.env.HOME}});
  if(child.status!==0){fs.writeFileSync(output,JSON.stringify({imageId:entry.image_id,sourceHash,runtimeGtUsed:false,error:child.error?.code??'CHILD_EXECUTION_FAILED',timeout:child.error?.code==='ETIMEDOUT',totalMs:Math.round(performance.now()-started),stderr:child.stderr?.slice(-2000),variants:variants.map(variantId=>{const checkpoint=path.join(config.outputDir,'checkpoint-'+variantId+'.json');return fs.existsSync(checkpoint)?{...JSON.parse(fs.readFileSync(checkpoint)),recoveredFromCheckpoint:true}:{variantId,rows:[],error:'CHILD_EXECUTION_FAILED',timeout:child.error?.code==='ETIMEDOUT'};})})+'\n',{flag:'wx'});}
  const measured=JSON.parse(fs.readFileSync(output));index.push({imageId:entry.image_id,sourceHash,totalMs:measured.totalMs,processPeakMemoryBytes:measured.processPeakMemoryBytes??null,timeout:measured.timeout,error:measured.error,variants:measured.variants.map(v=>({variantId:v.variantId,rows:v.rows.length,error:v.error??null,timeout:v.timeout??false,processingMs:v.processingMs??null}))});
  console.log(JSON.stringify(index.at(-1)));
 }
 fs.writeFileSync(path.join(out,'index.json'),JSON.stringify({schema:'icb.parts-overnight-index.v1',runtimeGtUsed:false,freezeHash:freeze?hash(fs.readFileSync(flags['--freeze'])):null,contract:EXPERIMENT_CONTRACT,entries:index},null,2)+'\n',{flag:'wx'});
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
