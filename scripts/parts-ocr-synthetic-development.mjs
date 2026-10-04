/** Independent procedural documents. Labels are development-scoring only. */
import fs from 'node:fs';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';
const seed=0x4f435256;
function randomSource(start){let state=start>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};}
export function createDevelopmentSheets(outputDir){
 if(fs.existsSync(outputDir))throw Error('Preserve previous development data; output must be fresh');fs.mkdirSync(outputDir,{recursive:true});
 const random=randomSource(seed),entries=[];
 const specifications=[
  {id:'dev-standard',kind:'yellow',count:3,ruled:true},
  {id:'dev-unit-only',kind:'white',count:4,ruled:true},
  {id:'dev-swapped',kind:'yellow',count:5,ruled:true,permuted:true},
  {id:'dev-extra-column',kind:'yellow',count:2,ruled:true,extra:true},
  {id:'dev-unruled',kind:'white',count:6,ruled:false},
  {id:'dev-nonuniform',kind:'yellow',count:4,ruled:true,irregular:true},
  {id:'dev-low-contrast',kind:'white',count:3,ruled:true,contrast:true},
  {id:'dev-footer',kind:'yellow',count:3,ruled:true,footer:true},
 ];
 for(const spec of specifications){
  const width=1400,height=1050,c=createCanvas(width,height),ctx=c.getContext('2d');ctx.fillStyle=spec.kind==='yellow'?'#fff4b0':'#ffffff';ctx.fillRect(0,0,width,height);
  ctx.font='32px "Hiragino Sans", Arial';ctx.fillStyle=spec.contrast?'#999':'#151515';ctx.fillText('OCR DEVELOPMENT / INDEPENDENT PROCEDURAL DOCUMENT',45,60);
  let columns=spec.kind==='yellow'?[['name','品名',480],['qty','出庫数',170],['retail','標準価格',230],['cost','単価',210],['amount','金額',210]]:[['name','部品名称',560],['qty','数量',180],['retail','単価',270],['amount','金額',290]];
  if(spec.permuted)columns=[columns[2],columns[0],columns[4],columns[1],columns[3]];
  if(spec.extra)columns.splice(1,0,['code','品番',200]);
  const total=columns.reduce((sum,col)=>sum+col[2],0),factor=1300/total;let x=50;const positioned=columns.map(([field,label,colWidth])=>{const out={field,label,x,width:colWidth*factor};x+=out.width;return out;});
  const y0=130,headerHeight=95,heights=Array.from({length:spec.count},(_,i)=>spec.irregular?(i%2?125:82):110),boundaries=[y0,y0+headerHeight];for(const h of heights)boundaries.push(boundaries.at(-1)+h);
  if(spec.ruled){ctx.strokeStyle=spec.contrast?'#aaa':'#333';ctx.lineWidth=2;for(const y of boundaries){ctx.beginPath();ctx.moveTo(50,y);ctx.lineTo(1350,y);ctx.stroke();}for(const x of [50,...positioned.map(p=>p.x+p.width)]){ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,boundaries.at(-1));ctx.stroke();}}
  ctx.font='34px "Hiragino Sans", Arial';for(const col of positioned)ctx.fillText(col.label,col.x+12,y0+58);
  const rows=[];
  for(let i=0;i<spec.count;i++){
   const qty=String(1+Math.floor(random()*7)),retail=String(1000+Math.floor(random()*90)*10),cost=String(300+Math.floor(random()*60)*10),name='試験部品'+String.fromCharCode(65+i),row={partName:name,qty,retail,cost:spec.kind==='white'?'':cost};rows.push(row);
   const values={name,qty,retail,cost,amount:String(Number(qty)*Number(retail)),code:'CODE-'+String.fromCharCode(65+i)};
   for(const col of positioned)ctx.fillText(values[col.field],col.x+12,boundaries[i+1]+heights[i]*.6);
  }
  if(spec.footer){ctx.fillText('合計',70,boundaries.at(-1)+75);ctx.fillText('99999',1100,boundaries.at(-1)+75);}
  const file=path.join(outputDir,spec.id+'.png');fs.writeFileSync(file,c.toBuffer('image/png'));entries.push({image_id:spec.id,derived_path:file,sourceKind:'SYNTHETIC_DEVELOPMENT',specification:spec,rows});
 }
 const manifest={schema:'icb.parts-synthetic-development.v1',seed,scoringOnly:true,runtimeUse:false,entries};
 fs.writeFileSync(path.join(outputDir,'scoring-only.json'),JSON.stringify(manifest,null,2)+'\n');
 // Runtime manifest deliberately drops labels and document specification.
 fs.writeFileSync(path.join(outputDir,'runtime-inputs.json'),JSON.stringify({entries:entries.map(e=>({image_id:e.image_id,derived_path:e.derived_path}))},null,2)+'\n');
 return {images:entries.length,seed};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(createDevelopmentSheets(process.argv[2])));
