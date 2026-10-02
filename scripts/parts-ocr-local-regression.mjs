/** Offline local-only architecture measurements. GT is never read by this runner. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveObjectURL } from 'node:buffer';
import { createCanvas, Image, loadImage } from '@napi-rs/canvas';
import { build } from 'esbuild';
import tess from 'tesseract.js';
import { detectDocumentRegions, warpDocument } from '../app/ocr/bakeoff/document-regions.mjs';
import { compareSemanticMappingCandidates } from '../app/ocr/bakeoff/p5-semantic-candidates.mjs';
import { extractPageTokens } from '../app/ocr/bakeoff/p5-token-evidence.mjs';
import { reconstructTokenGrid } from '../app/ocr/bakeoff/p5-token-grid-core.mjs';
const root=path.resolve(import.meta.dirname,'..');
const hash=data=>createHash('sha256').update(data).digest('hex');
const write=(p,data)=>fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n',{flag:'wx'});

function installCanvas(){
 const descriptor=Object.getOwnPropertyDescriptor(Image.prototype,'src');
 class BrowserImage extends Image{get naturalWidth(){return this.width;}get naturalHeight(){return this.height;}set src(value){const blob=resolveObjectURL(value);if(!blob)throw Error('Only local Blob images accepted');blob.arrayBuffer().then(b=>descriptor.set.call(this,Buffer.from(b))).catch(e=>this.onerror?.(e));}}
 globalThis.Image=BrowserImage;globalThis.document={createElement:name=>{if(name!=='canvas')throw Error('Only canvas permitted');return createCanvas(1,1);}};
}
async function canvasInput(file,maxSide=2200){
 const blob=new File([fs.readFileSync(file)],path.basename(file),{type:'image/png'});
 const img=await new Promise((resolve,reject)=>{const i=new globalThis.Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=URL.createObjectURL(blob);});
 const rotate=img.naturalHeight>img.naturalWidth*1.08,sw=rotate?img.naturalHeight:img.naturalWidth,sh=rotate?img.naturalWidth:img.naturalHeight;
 const scale=Math.min(1,maxSide/Math.max(sw,sh)),c=createCanvas(Math.round(sw*scale),Math.round(sh*scale)),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 if(rotate){ctx.translate(0,c.height);ctx.rotate(-Math.PI/2);ctx.drawImage(img,0,0,c.height,c.width);}else ctx.drawImage(img,0,0,c.width,c.height);
 return{canvas:c,rotate};
}
async function child(config){
 installCanvas();const{file,imageId,mode,langDir,output,baselineModule}=config,sourceHash=hash(fs.readFileSync(file)),started=performance.now();
 if(mode==='P0_P1'){
 const{runBrowserCandidates}=await import(baselineModule);
 const result=await runBrowserCandidates(new File([fs.readFileSync(file)],path.basename(file),{type:'image/png'}),imageId,'LOCAL-'+imageId,()=>{});
 write(output,{schema:'icb.parts-offline-measurement.v1',imageId,mode,sourceHash,runtimeGtUsed:false,executionEnvironment:'NODE_SKIA_PORT_OF_UNMODIFIED_BROWSER_SOURCE',totalMs:Math.round(performance.now()-started),...result});
 }else if(mode.startsWith('P6_')){
 const im=await loadImage(file),canvas=createCanvas(im.width,im.height),ctx=canvas.getContext('2d');ctx.drawImage(im,0,0);const raw=ctx.getImageData(0,0,canvas.width,canvas.height),localization=detectDocumentRegions(raw),pages=[];
 const worker=await tess.createWorker('jpn+eng',1,{langPath:langDir,gzip:true,cacheMethod:'none'});
 try{await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_char_whitelist:'',tessedit_pageseg_mode:mode==='P6_PSM3'?'3':'6'});
 for(let i=0;i<localization.regions.length;i++){const region=localization.regions[i],warped=warpDocument(raw,region.quad),c=createCanvas(warped.width,warped.height),cc=c.getContext('2d'),pixels=cc.createImageData(c.width,c.height);pixels.data.set(warped.data);cc.putImageData(pixels,0,0);fs.writeFileSync(output.replace('.json','-region-'+i+'.png'),c.toBuffer('image/png'),{flag:'wx'});const t=performance.now(),result=await worker.recognize(c.toBuffer('image/jpeg',96),{},{text:true,tsv:true,blocks:true}),acquired=extractPageTokens(result.data);pages.push({region,canvasWidth:c.width,canvasHeight:c.height,recognitionMs:Math.round(performance.now()-t),tokenRepresentation:acquired.representation,tokens:acquired.tokens,variants:compareSemanticMappingCandidates(acquired.tokens),strict:reconstructTokenGrid(acquired.tokens)});}
 const ids=['CURRENT','A_SPLIT_TOKEN_COMPOSITION','B_GENERALIZED_FUZZY','C_SOFT_HEADER_BAND','D_PARTIAL_HEADER_COLUMN_LATTICE'];const variants=ids.map(id=>({variantId:id,rows:pages.flatMap((p,index)=>p.variants.find(v=>v.variantId===id).rows.map(r=>({...r,rowId:'DOC'+index+'-'+r.rowId}))),manualReviewRequired:true,wrongAutoConfirm:0}));
 write(output,{schema:'icb.parts-offline-measurement.v1',imageId,mode,sourceHash,runtimeGtUsed:false,executionEnvironment:'NODE_SKIA_DOCUMENT_LOCAL_PAGE_TOKENS',localization,pages,tokenCount:pages.reduce((s,p)=>s+p.tokens.length,0),variants,strict:{rows:pages.flatMap(p=>p.strict.rows)},totalMs:Math.round(performance.now()-started),timeout:false,error:null});
 }finally{await worker.terminate();}
 }else{
 const source=await canvasInput(file),loadStart=performance.now();
 const worker=await tess.createWorker('jpn+eng',1,{langPath:langDir,gzip:true,cacheMethod:'none'}),loadMs=Math.round(performance.now()-loadStart);
 try{
 await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_char_whitelist:'',tessedit_pageseg_mode:mode==='P5_PSM3'?'3':'6'});
 const recognizeStart=performance.now(),result=await worker.recognize(source.canvas.toBuffer('image/jpeg',96),{},{text:true,tsv:true,blocks:true,hocr:false,box:false,unlv:false,osd:false,pdf:false,imageColor:false,imageGrey:false,imageBinary:false,debug:false});
 const recognitionMs=Math.round(performance.now()-recognizeStart),acquired=extractPageTokens(result.data),tokens=acquired.tokens,mappingStart=performance.now(),variants=compareSemanticMappingCandidates(tokens),strict=reconstructTokenGrid(tokens);
 write(output,{schema:'icb.parts-offline-measurement.v1',imageId,mode,sourceHash,runtimeGtUsed:false,executionEnvironment:'NODE_SKIA_PAGE_TOKENS',sourceCanvas:{width:source.canvas.width,height:source.canvas.height,rotate:source.rotate},modelLoadMs:loadMs,recognitionMs,mappingMs:Math.round(performance.now()-mappingStart),totalMs:Math.round(performance.now()-started),tokenCount:tokens.length,tokenRepresentation:acquired.representation,tsvTokenCount:acquired.tsvTokens.length,blockTokenCount:acquired.blockTokens.length,tokens,strict,variants,timeout:false,error:null});
 }finally{await worker.terminate();}
 }
}
async function compileBaseline(out,langDir){
 const wrapper=path.join(out,'offline-tesseract.cjs');
 fs.writeFileSync(wrapper,`const real=require(${JSON.stringify(path.join(root,'node_modules/tesseract.js'))});\nexports.PSM=real.PSM;exports.createWorker=async(langs,oem)=>{const worker=await real.createWorker(langs,oem,{langPath:${JSON.stringify(langDir)},gzip:true,cacheMethod:'none'});const recognize=worker.recognize;worker.recognize=async(image,...args)=>recognize(image instanceof Blob?Buffer.from(await image.arrayBuffer()):image,...args);return worker;};\n`,{flag:'wx'});
 const outfile=path.join(out,'baseline.mjs');
 const result=await build({entryPoints:[path.join(root,'app/ocr/bakeoff/browser-candidates.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,plugins:[{name:'offline-tesseract',setup(b){b.onResolve({filter:/^tesseract\.js$/},()=>({path:wrapper,external:true}));}}]});
 if(Object.keys(result.metafile.inputs).some(p=>/formal-gt|evaluation\/parts|ground.?truth/i.test(p)))throw Error('GT dependency in runtime bundle');
 write(path.join(out,'baseline-source-manifest.json'),{runtimeGtUsed:false,inputs:Object.keys(result.metafile.inputs).map(p=>({path:path.relative(root,path.resolve(p)),sha256:hash(fs.readFileSync(p))}))});
 return outfile;
}
async function main(){
 const args=process.argv.slice(2);if(args[0]==='--child'){await child(JSON.parse(fs.readFileSync(0,'utf8')));return;}
 const flags=Object.fromEntries(args.reduce((rows,value,index)=>index%2===0?[...rows,[value,args[index+1]]]:rows,[]));
 if(!flags['--manifest']||!flags['--output']||!flags['--lang-dir'])throw Error('Required: --manifest private.json --output private-dir --lang-dir local-tessdata [--mode P5_PSM6|P5_PSM3|P0_P1]');
 const manifest=JSON.parse(fs.readFileSync(flags['--manifest'],'utf8')),out=path.resolve(flags['--output']);if(fs.existsSync(out))throw Error('Output directory must be fresh; preserve prior evidence');fs.mkdirSync(out,{recursive:true});
 const langDir=path.resolve(flags['--lang-dir']);for(const language of ['jpn','eng'])if(!fs.existsSync(path.join(langDir,language+'.traineddata.gz')))throw Error('Missing offline language data');
 const mode=flags['--mode']??'P5_PSM6';if(!['P5_PSM6','P5_PSM3','P0_P1','P6_PSM3','P6_PSM6'].includes(mode))throw Error('Unknown mode');const baselineModule=mode==='P0_P1'?await compileBaseline(out,langDir):null,index=[];
 for(const entry of manifest.entries){
 if(!/^IMG_\d{4}$/.test(entry.image_id)||!fs.existsSync(entry.derived_path))throw Error('Invalid manifest');if(flags['--only']&&entry.image_id!==flags['--only'])continue;
 const output=path.join(out,entry.image_id+'.json'),config={file:entry.derived_path,imageId:entry.image_id,mode,langDir,output,baselineModule};
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child'],{input:JSON.stringify(config),encoding:'utf8',timeout:180000,maxBuffer:1000000,cwd:out,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8'}});
 if(result.status!==0)write(output,{schema:'icb.parts-offline-measurement.v1',imageId:entry.image_id,mode,runtimeGtUsed:false,timeout:result.error?.code==='ETIMEDOUT',error:'LOCAL_EXECUTION_FAILED',exit:result.status,signal:result.signal});
 const measured=JSON.parse(fs.readFileSync(output,'utf8'));index.push({imageId:entry.image_id,mode,timeout:measured.timeout??false,error:measured.error??null,totalMs:measured.totalMs??null,tokenCount:measured.tokenCount??null,variantRows:measured.variants?.map(v=>({variant:v.variantId,count:v.rows.length}))??null});console.log(JSON.stringify(index.at(-1)));
 }
 write(path.join(out,'index.json'),{schema:'icb.parts-offline-index.v1',mode,runtimeGtUsed:false,entries:index});
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
