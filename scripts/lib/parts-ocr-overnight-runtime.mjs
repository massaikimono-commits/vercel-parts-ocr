/** Acquisition and architecture only. No scoring/GT imports or filename rules. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import tess from 'tesseract.js';
import {extractPageTokens} from '../../app/ocr/bakeoff/p5-token-evidence.mjs';
import {warpDocument,polygonArea} from '../../app/ocr/bakeoff/document-regions.mjs';
import {reconstructSpatialGraph} from '../../app/ocr/architecture-vnext/token-spatial-graph.mjs';
import {detectTableGeometry} from '../../app/ocr/architecture-vnext/row-first-geometry.mjs';
import {selectCardinalHypotheses} from '../../app/ocr/architecture-vnext/orientation-contract.mjs';
import {toSourceRegion} from '../../app/ocr/architecture-vnext/coordinate-contract.mjs';

export const EXPERIMENT_CONTRACT=Object.freeze({
  version:'parts-overnight-architecture.v1',fullPixelCap:2200,orientationPixelCap:1000,
  geometryPixelCap:1200,cardinalAngles:[0,90,180,270],maxFullOrientations:2,
  maxRectangleHypotheses:2,maxCellOcrCalls:96,timeoutMs:240000,
  variants:['T_PAGE_G','T_CARDINAL_G','V_PAGE_G','V_CARDINAL_G','V_RECTIFIED_G','R_V_PAGE','R_V_CARDINAL'],
  manualReviewRequired:true,autoConfirmAllowed:false,customAnswerDictionary:false,
  confidence:'Provider observation only; unknown remains null; structural scores are not calibrated probabilities',
});
const now=()=>performance.now(),duration=start=>Math.round(now()-start);
function rotated(source,angle,cap){
  const swapped=angle===90||angle===270,w=swapped?source.height:source.width,h=swapped?source.width:source.height;
  const scale=Math.min(1,cap/Math.max(w,h)),canvas=createCanvas(Math.round(w*scale),Math.round(h*scale)),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(scale,scale);
  if(angle===90){ctx.translate(w,0);ctx.rotate(Math.PI/2);}else if(angle===180){ctx.translate(w,h);ctx.rotate(Math.PI);}else if(angle===270){ctx.translate(0,h);ctx.rotate(-Math.PI/2);}
  ctx.drawImage(source,0,0);return {canvas,angle,scale};
}
function portableFields(row,coordinate={}){
  return {rowId:row.rowId,region:row.region,sourceRegion:toSourceRegion(row.region,coordinate),fields:Object.fromEntries(['name','qty','retail','cost'].map(f=>[f,{...(row[f]??{normalized:'',status:'missing',confidence:null}),sourceRegion:toSourceRegion(row[f]?.region,coordinate)}])),amount:row.amount,coordinate};
}
function graphResult(acquisition,coordinate={}){
  const graph=reconstructSpatialGraph(acquisition.tokens,{width:acquisition.width,height:acquisition.height});
  return {rows:graph.rows.map(row=>portableFields(row,coordinate)),hypotheses:graph.hypotheses,diagnostics:graph.diagnostics,manualReviewRequired:true,autoConfirmedRows:0};
}
const normalizedNumber=text=>{const value=String(text).normalize('NFKC').replace(/[,¥￥\s]/g,'');return /^\d+(?:\.\d+)?$/.test(value)?value:'';};

export async function runArchitectureMatrix(file,{outputDir,langDir,visionBinary,variants=EXPERIMENT_CONTRACT.variants,engines=['T','V']}={}){
  fs.mkdirSync(outputDir,{recursive:true});const started=now(),image=await loadImage(file),source=createCanvas(image.width,image.height);source.getContext('2d').drawImage(image,0,0);
  const result={schema:'icb.parts-overnight-runtime.v1',runtimeGtUsed:false,contract:EXPERIMENT_CONTRACT,sourceSize:{width:source.width,height:source.height},variants:[],acquisitions:[],timeout:false,error:null};
  let worker=null,nodePeak=0;
  const peak=()=>{nodePeak=Math.max(nodePeak,process.resourceUsage().maxRSS*1024);return nodePeak;};
  function native(args){const start=now();const raw=execFileSync(visionBinary,args,{encoding:'utf8',timeout:EXPERIMENT_CONTRACT.timeoutMs,maxBuffer:32*1024*1024,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8'}});const value=JSON.parse(raw);return {value,wallMs:duration(start)};}
  async function acquire(engine,oriented,id){
    const start=now(),{canvas,angle,scale}=oriented,filePath=path.join(outputDir,id+'.png');fs.writeFileSync(filePath,canvas.toBuffer('image/png'));
    let data,wallMs;
    if(engine==='V'){const measured=native([filePath]);data=measured.value;wallMs=measured.wallMs;if(data.error)throw Error('VISION_ACQUISITION_ERROR');}
    else {
      if(!worker)worker=await tess.createWorker('jpn+eng',1,{langPath:langDir,gzip:true,cacheMethod:'none'});
      await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_char_whitelist:'',tessedit_pageseg_mode:'3'});
      const acquired=await worker.recognize(canvas.toBuffer('image/png'),{},{text:true,tsv:true,blocks:true}),evidence=extractPageTokens(acquired.data);
      data={engine:'TESSERACT',width:canvas.width,height:canvas.height,tokens:evidence.tokens,tokenRepresentation:evidence.representation,peakMemoryBytes:peak(),runtimeGtUsed:false};wallMs=duration(start);
    }
    const entry={...data,id,angle,scale,width:canvas.width,height:canvas.height,wallMs,processNodePeakBytes:peak()};
    fs.writeFileSync(path.join(outputDir,id+'.json'),JSON.stringify(entry)+'\n');result.acquisitions.push({id,engine,angle,width:canvas.width,height:canvas.height,wallMs,tokens:entry.tokens.length,peakMemoryBytes:entry.peakMemoryBytes??null});
    return entry;
  }
  const full0=rotated(source,0,EXPERIMENT_CONTRACT.fullPixelCap),pages=new Map(),orientation=new Map();
  async function page(engine){if(!pages.has(engine))pages.set(engine,await acquire(engine,full0,engine+'-page'));return pages.get(engine);}
  async function cardinal(engine){
    if(orientation.has(engine))return orientation.get(engine);
    const start=now(),probes=[];
    for(const angle of EXPERIMENT_CONTRACT.cardinalAngles)probes.push(await acquire(engine,rotated(source,angle,EXPERIMENT_CONTRACT.orientationPixelCap),engine+'-orientation-'+angle));
    const selection=selectCardinalHypotheses(probes),full=[];
    for(const selected of selection.selected.slice(0,EXPERIMENT_CONTRACT.maxFullOrientations))full.push(await acquire(engine,rotated(source,selected.angle,EXPERIMENT_CONTRACT.fullPixelCap),engine+'-full-'+selected.angle));
    const entry={selection,full,wallMs:duration(start)};orientation.set(engine,entry);return entry;
  }
  async function rowFirst(acquisition,oriented,id){
    const start=now(),geometryView=rotated(source,oriented.angle,EXPERIMENT_CONTRACT.geometryPixelCap),canvas=geometryView.canvas,ctx=canvas.getContext('2d'),geometry=detectTableGeometry(ctx.getImageData(0,0,canvas.width,canvas.height));
    const headerGraph=reconstructSpatialGraph(acquisition.tokens,{width:acquisition.width,height:acquisition.height}),ratio=geometryView.scale/oriented.scale;
    const cells=[],rows=[],columnMaps=[];let physicalCellIndex=0,budgetExhausted=false;
    for(const table of geometry.tableRegions){
      const box=table.box,hypotheses=headerGraph.hypotheses.filter(h=>h.headerRegion.x1*ratio>=box.x-2&&h.headerRegion.x2*ratio<=box.x+box.width+2&&h.headerRegion.y1*ratio>=box.y-2&&h.headerRegion.y2*ratio<=box.y+box.height+2&&!h.ambiguous);
      if(hypotheses.length!==1){geometry.diagnostics.headerAssociation='UNRESOLVED_TABLE_HEADER';continue;}
      const header=hypotheses[0],cols=geometry.columnBands.filter(c=>c.tableId===table.id),mapping={};let conflict=false;
      for(const column of header.columns){if(!['name','qty','retail','cost','amount'].includes(column.field))continue;const center=(column.anchor.x1+column.anchor.x2)/2*ratio,owners=cols.filter(c=>center>=c.box.x&&center<=c.box.x+c.box.width);if(owners.length!==1||mapping[owners[0].index]){conflict=true;break;}mapping[owners[0].index]=column.field;}
      if(conflict||!Object.values(mapping).includes('name')||!Object.values(mapping).includes('qty')||!Object.values(mapping).includes('retail'))continue;
      columnMaps.push({tableId:table.id,mapping,headerRegion:header.headerRegion,absentCostProven:header.absentCostProven});
      for(const band of geometry.rowBands.filter(r=>r.tableId===table.id&&r.box.y>=header.headerRegion.y2*ratio)){
        const row={rowId:`${table.id}:band:${band.index}`,region:band.box,sourceRegion:toSourceRegion(band.box,{angle:oriented.angle,scale:geometryView.scale,sourceWidth:source.width,sourceHeight:source.height}),fields:{},geometrySlotRetained:true};
        for(const key of ['name','qty','retail','cost'])row.fields[key]={raw:'',normalized:'',status:'missing',columnAbsent:key==='cost'&&header.absentCostProven,confidence:null,source:[]};
        for(const proposal of geometry.cellProposals.filter(p=>p.tableId===table.id&&p.rowIndex===band.index&&['name','qty','retail','cost'].includes(mapping[p.columnIndex]))){
          const key=mapping[proposal.columnIndex],box=proposal.box,inset=2,x=Math.max(0,Math.floor(box.x+inset)),y=Math.max(0,Math.floor(box.y+inset)),w=Math.min(canvas.width-x,Math.ceil(box.width-2*inset)),h=Math.min(canvas.height-y,Math.ceil(box.height-2*inset));
          if(w<=0||h<=0)continue;
          const cellId=id+'-cell-'+physicalCellIndex++,region={x1:x,y1:y,x2:x+w,y2:y+h};
          row.fields[key]={...row.fields[key],status:proposal.blank===true?'blank':'unreadable',region,sourceRegion:toSourceRegion(region,{angle:oriented.angle,scale:geometryView.scale,sourceWidth:source.width,sourceHeight:source.height}),visualBlank:proposal.blank,source:[cellId]};
          if(proposal.visibleInk===false)continue;
          if(cells.length>=EXPERIMENT_CONTRACT.maxCellOcrCalls){budgetExhausted=true;row.fields[key].status='budget-exhausted';continue;}
          const crop=createCanvas(w,h);crop.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
          const cellPath=path.join(outputDir,cellId+'.png');fs.writeFileSync(cellPath,crop.toBuffer('image/png'));cells.push({id:cellId,path:cellPath,row,field:key});
        }
        rows.push(row);
      }
    }
    const jobs=cells.map(c=>({id:c.id,path:c.path}));let nativePeak=null;
    for(let offset=0;offset<jobs.length;offset+=12){const manifestPath=path.join(outputDir,id+'-cells-'+offset+'.json');fs.writeFileSync(manifestPath,JSON.stringify(jobs.slice(offset,offset+12)));const output=native(['--batch',manifestPath]).value;fs.writeFileSync(path.join(outputDir,id+'-cells-acquired-'+offset+'.json'),JSON.stringify(output)+'\n');for(const item of output){nativePeak=Math.max(nativePeak??0,item.peakMemoryBytes??0);const cell=cells.find(c=>c.id===item.id);if(!cell||item.error)continue;const raw=item.lines?.map(l=>l.text).join(' ').trim()??'',confidence=item.lines?.length?Math.min(...item.lines.map(l=>l.confidence)):null,normalized=cell.field==='name'?raw.normalize('NFKC'):normalizedNumber(raw);cell.row.fields[cell.field]={...cell.row.fields[cell.field],raw,normalized,confidence,status:normalized?'observed':raw?'invalid':'unreadable'};}}
    return {rows,geometry,columnMaps,geometrySlots:rows.length,cellCalls:jobs.length,cellBudgetExceeded:budgetExhausted,diagnostics:budgetExhausted?['CELL_BUDGET_EXHAUSTED']:[],processingMs:duration(start),nativePeakMemoryBytes:nativePeak,manualReviewRequired:true,autoConfirmedRows:0};
  }
  try {
    for(const variantId of variants){
      const start=now();let measured;
      try{
        if(/^[TV]_PAGE_G$/.test(variantId)){const engine=variantId[0],a=await page(engine);measured={...graphResult(a,{angle:0,scale:a.scale,sourceWidth:source.width,sourceHeight:source.height}),acquisition:a.id,acquisitionMs:a.wallMs};}
        else if(/^[TV]_CARDINAL_G$/.test(variantId)){
          const engine=variantId[0],o=await cardinal(engine),hypotheses=o.full.map(a=>({acquisition:a.id,angle:a.angle,...graphResult(a,{angle:a.angle,scale:a.scale,sourceWidth:source.width,sourceHeight:source.height})}));
          measured={rows:o.selection.ambiguous?[]:hypotheses[0]?.rows??[],orientation:o.selection,hypotheses,diagnostics:o.selection.reason?[o.selection.reason]:[],acquisitionMs:o.wallMs,manualReviewRequired:true,autoConfirmedRows:0};
        }else if(variantId==='V_RECTIFIED_G'){
          const p=await page('V'),sourcePath=path.join(outputDir,p.id+'.png'),detection=native(['--rectangles',sourcePath]).value,ctx=full0.canvas.getContext('2d'),raw=ctx.getImageData(0,0,full0.canvas.width,full0.canvas.height),hypotheses=[];
          for(const [index,region] of (detection.regions??[]).entries()){
            if(region.quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>raw.width||p.y>raw.height)||polygonArea(region.quad)<=0)continue;
            const warped=warpDocument(raw,region.quad,EXPERIMENT_CONTRACT.fullPixelCap),c=createCanvas(warped.width,warped.height),cc=c.getContext('2d'),pixels=cc.createImageData(c.width,c.height);pixels.data.set(warped.data);cc.putImageData(pixels,0,0);
            const a=await acquire('V',{canvas:c,angle:0,scale:1},'V-rectangle-'+index);hypotheses.push({region,...graphResult(a,{type:'PROJECTIVE_LOCAL',quad:region.quad,localWidth:c.width,localHeight:c.height,scale:full0.scale}),acquisition:a.id});
          }
          measured={rows:hypotheses.length===1?hypotheses[0].rows:[],hypotheses,rectangleDetection:detection,diagnostics:hypotheses.length===1?[]:[hypotheses.length?'MULTIPLE_RECTANGLE_HYPOTHESES':'RECTANGLE_GEOMETRY_UNAVAILABLE'],manualReviewRequired:true,autoConfirmedRows:0};
        }else if(variantId==='R_V_PAGE'){const a=await page('V');measured=await rowFirst(a,full0,'R-page');}
        else if(variantId==='R_V_CARDINAL'){const o=await cardinal('V'),a=o.full[0];measured=a&&!o.selection.ambiguous?await rowFirst(a,rotated(source,a.angle,EXPERIMENT_CONTRACT.fullPixelCap),'R-cardinal'):{rows:[],diagnostics:[o.selection.ambiguous?'ORIENTATION_EVIDENCE_TIE':'NO_SUPPORTED_ORIENTATION']};if(measured)measured.orientationAmbiguous=o.selection.ambiguous;}
        else throw Error('Unknown preregistered architecture');
        result.variants.push({variantId,...measured,processingMs:duration(start),processNodePeakBytes:peak(),timeout:false,error:null,manualReviewRequired:true,autoConfirmedRows:0});
      }catch(error){result.variants.push({variantId,rows:[],processingMs:duration(start),processNodePeakBytes:peak(),timeout:error.code==='ETIMEDOUT',error:error.code??'ARCHITECTURE_EXECUTION_ERROR',errorDetail:error.message,manualReviewRequired:true,autoConfirmedRows:0});}
      // Preserve completed independent architectures even if a later engine hangs.
      fs.writeFileSync(path.join(outputDir,'checkpoint-'+variantId+'.json'),JSON.stringify(result.variants.at(-1))+'\n');
    }
  }finally{if(worker)await worker.terminate();}
  result.totalMs=duration(started);result.processPeakMemoryBytes=peak();return result;
}
