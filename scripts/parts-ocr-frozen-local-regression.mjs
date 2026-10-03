/** Frozen source AST extraction; GT never read. Node/Skia adaptation, not browser parity. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolveObjectURL} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import tess from 'tesseract.js'; // Load Node backend before installing document shim.
import {build} from 'esbuild';
import {createCanvas,Image} from '@napi-rs/canvas';
const ROOT=path.resolve(import.meta.dirname,'..'),REF='6a31ec4b9028410e90a8dbd9c8b40d53de7742d2';
const hash=x=>createHash('sha256').update(x).digest('hex');
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n',{flag:'wx'});
function shims(){
 const src=Object.getOwnPropertyDescriptor(Image.prototype,'src');
 class BrowserImage extends Image {get naturalWidth(){return this.width;}get naturalHeight(){return this.height;}set src(v){const b=resolveObjectURL(v);if(!b)throw Error('Only local Blob input');b.arrayBuffer().then(x=>src.set.call(this,Buffer.from(x))).catch(e=>this.onerror?.(e));}}
 globalThis.Image=BrowserImage;
 globalThis.document={createElement:n=>{if(n!=='canvas')throw Error('Only canvas permitted');const c=createCanvas(1,1);c.toBlob=(cb,type,q)=>cb(new Blob([c.toBuffer(type==='image/png'?'image/png':'image/jpeg',Math.round((q??.98)*100))],{type:type??'image/png'}));return c;}};
}
function extract(source,kind){
 const ast=ts.createSourceFile(kind+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const helpers=ast.statements.filter(n=>!ts.isImportDeclaration(n)&&!(ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword))).map(n=>n.getText(ast)).join('\n');
 const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword));
 const run=component.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runOCR');
 if(!run)throw Error('Frozen runOCR missing');
 const originalRun=run.getText(ast);const extracted=ts.createSourceFile('check.tsx',originalRun,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);if(extracted.statements[0].getText(extracted)!==originalRun)throw Error('AST runOCR equivalence failure');
 return helpers+'\nexport async function execute(file:File){let captured:any[]=[];const preview="";const noop=(...args:any[])=>{};const setBusy=noop,setProgress=noop,setMessage=noop,setDebugText=noop,setRawText=noop,setDebug=noop,setPreview=noop;const setParts=(v:any)=>{captured=v};\n'+run.getText(ast)+'\nawait runOCR(file);return captured;}';
}
async function compile(out,langDir){
 const sourcePaths=['app/ocr/page.tsx','app/ocr/general/page.tsx','app/ocr/transfer.ts','app/ocr/general/slip-profiles.ts'];
 const extractedRunHashes=[];
 const sources=Object.fromEntries(sourcePaths.map(p=>[p,execFileSync('git',['show',REF+':'+p],{cwd:ROOT,encoding:'utf8'})]));
 for(const p of sourcePaths.slice(2))fs.writeFileSync(path.join(out,path.basename(p)),sources[p],{flag:'wx'});
 const wrapper=path.join(out,'tesseract.cjs');fs.writeFileSync(wrapper,`const t=require(${JSON.stringify(path.join(ROOT,'node_modules/tesseract.js'))});exports.PSM=t.PSM;exports.createWorker=async(l,o,opts)=>{const doc=globalThis.document;delete globalThis.document;let w;try{w=await t.createWorker(l,o,{...opts,langPath:${JSON.stringify(langDir)},gzip:true,cacheMethod:'none'});}finally{globalThis.document=doc;}const r=w.recognize;w.recognize=async(x,...a)=>r(x instanceof Blob?Buffer.from(await x.arrayBuffer()):x,...a);return w;};`,{flag:'wx'});
 for(const [kind,p]of [['dedicated',sourcePaths[0]],['general',sourcePaths[1]]]){
 const imports='import {prepareOCRInputFile} from "./transfer";'+(kind==='general'?'import {applyProfileCostRule,detectSlipColumnProfile,type SlipColumnProfile} from "./slip-profiles";':'');
 const entry=path.join(out,kind+'.tsx'),transformed=imports+extract(sources[p],kind);fs.writeFileSync(entry,transformed,{flag:'wx'});const sourceAST=ts.createSourceFile(p,sources[p],ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),comp=sourceAST.statements.find(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)),run=comp.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runOCR').getText(sourceAST);if(!transformed.includes(run))throw Error('Exact Frozen runOCR omitted');extractedRunHashes.push({kind,runOCRSha256:hash(run),exactSourceSubstringVerified:true});
 const result=await build({entryPoints:[entry],outfile:path.join(out,kind+'.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,plugins:[{name:'local-tess',setup(b){b.onResolve({filter:/^tesseract\.js$/},()=>({path:wrapper,external:true}));}}]});
 if(Object.keys(result.metafile.inputs).some(p=>/formal-gt|evaluation\/parts|ground.?truth/i.test(p)))throw Error('GT dependency');
 }
 write(path.join(out,'frozen-provenance.json'),{extractedRunHashes,nodeVersion:process.version,models:['jpn','eng'].map(l=>({language:l,sha256:hash(fs.readFileSync(path.join(langDir,l+'.traineddata.gz')))})),ref:REF,runtimeGtUsed:false,sourceFiles:sourcePaths.map(p=>({path:p,sha256:hash(sources[p])})),transform:'TypeScript AST: remove imports/default React component; preserve top-level helpers and exact runOCR function; inject state-setter capture; bundle original transfer/profile modules; local Tesseract language path; Blob/canvas Skia shims',limitations:['Node Skia canvas differs from browser canvas','Inherited fixed geometry and SUPPLIER_PARTS MC-E133 dictionary preserved for baseline only','Catch handlers swallow execution errors; captured console errors classified by wrapper'],inheritedAnswerDictionary:true});
}
async function child(c){
 shims();const errors=[];console.error=(...x)=>errors.push(x.map(v=>v?.stack??String(v)).join(' '));
 const t=performance.now(),m=await import(path.join(c.outputDir,c.route+'.mjs'));
 const rows=await m.execute(new File([fs.readFileSync(c.file)],path.basename(c.file),{type:'image/png'}));
 write(c.output,{schema:'icb.parts-offline-measurement.v1',imageId:c.imageId,mode:'FROZEN_'+c.route.toUpperCase(),sourceHash:hash(fs.readFileSync(c.file)),baselineRef:REF,runtimeGtUsed:false,executionEnvironment:'NODE_SKIA_AST_EXTRACTED_FROZEN_SOURCE',inheritedAnswerDictionary:c.route==='dedicated',totalMs:Math.round(performance.now()-t),timeout:false,error:errors.length?'FROZEN_RUNTIME_CAUGHT_ERROR':null,errors,variants:[{variantId:'FROZEN_ACTUAL_'+c.route.toUpperCase(),rows:rows.map((r,i)=>({rowId:'R'+i,fields:{name:{normalized:r.name},qty:{normalized:r.qty},retail:{normalized:r.retail},cost:{normalized:r.cost}}}))}]});
}
async function main(){
 const a=process.argv.slice(2);if(a[0]==='--child'){await child(JSON.parse(fs.readFileSync(0,'utf8')));return;}
 const flags=Object.fromEntries(a.reduce((r,v,i)=>i%2?r:[...r,[v,a[i+1]]],[]));
 if(!flags['--manifest']||!flags['--output']||!flags['--lang-dir'])throw Error('Required --manifest --output --lang-dir [--only IMG_nnnn]');
 const out=path.resolve(flags['--output']);if(fs.existsSync(out))throw Error('Output must be fresh');fs.mkdirSync(out,{recursive:true});await compile(out,path.resolve(flags['--lang-dir']));
 const manifest=JSON.parse(fs.readFileSync(flags['--manifest'],'utf8')),index=[];
 for(const e of manifest.entries){if(flags['--subset']&&e.subset!==flags['--subset'])continue;if(flags['--only']&&flags['--only']!==e.image_id)continue;
 // Predeclared route by supplied document family; never GT fields/counts. Both routes can be explicitly requested.
 const route=flags['--route'];if(!['general','dedicated'].includes(route))throw Error('Unknown route');
 const output=path.join(out,e.image_id+'.json'),c={file:e.derived_path,imageId:e.image_id,route,output,outputDir:out};
 const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child'],{cwd:ROOT,input:JSON.stringify(c),encoding:'utf8',timeout:180000,maxBuffer:1000000});
 if(r.status!==0)write(output,{schema:'icb.parts-offline-measurement.v1',imageId:e.image_id,runtimeGtUsed:false,mode:'FROZEN_'+route.toUpperCase(),timeout:r.error?.code==='ETIMEDOUT',error:'LOCAL_EXECUTION_FAILED',exit:r.status,signal:r.signal,stderr:r.stderr?.slice(-3000)});
 const d=JSON.parse(fs.readFileSync(output));index.push({imageId:e.image_id,mode:d.mode,totalMs:d.totalMs,timeout:d.timeout,error:d.error,rows:d.variants?.[0]?.rows.length});console.log(JSON.stringify(index.at(-1)));
 }write(path.join(out,'index.json'),{baselineRef:REF,runtimeGtUsed:false,entries:index});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
