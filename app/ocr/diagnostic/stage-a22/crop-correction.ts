/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type { CropBox } from "../../dynamic-rows";
import type { FieldKey } from "../stage-a20/recognition";
import type { CandidateRow, ColumnBoxes, CellCrop } from "../stage-a20/a19-table-crops";

export type PaperQuad={tl:{x:number;y:number};tr:{x:number;y:number};br:{x:number;y:number};bl:{x:number;y:number};confidence:number};
export type RectifiedPaper={canvas:HTMLCanvasElement;paper:CropBox;quad:PaperQuad;skewDeg:number;perspectiveDelta:number;projectiveApplied:boolean};
export type RuleSet={horizontal:number[];vertical:number[];horizontalThickness:number;verticalThickness:number};
export type CorrectedRow=CandidateRow&{boundedByRules:boolean;sourceRow:CandidateRow};

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const luminance=(d:Uint8ClampedArray,i:number)=>d[i]*.20+d[i+1]*.72+d[i+2]*.08;

function isPaperPixel(d:Uint8ClampedArray,i:number){const r=d[i],g=d[i+1],b=d[i+2],v=(r+g+b)/3;return v>155||(r>105&&g>100&&r+g>b*1.72);}
function fit1d(samples:Array<{t:number;v:number}>){let st=0,sv=0,stt=0,stv=0;for(const p of samples){st+=p.t;sv+=p.v;stt+=p.t*p.t;stv+=p.t*p.v;}const n=samples.length,den=n*stt-st*st;if(n<2||Math.abs(den)<1e-6)return null;const a=(n*stv-st*sv)/den,b=(sv-a*st)/n;return{a,b};}
function linePaperBoundsX(data:Uint8ClampedArray,w:number,h:number,y:number,step=2){let left=-1,right=-1;const yy=clamp(Math.round(y),0,h-1);for(let x=0;x<w;x+=step){if(isPaperPixel(data,(yy*w+x)*4)){left=x;break;}}for(let x=w-1;x>=0;x-=step){if(isPaperPixel(data,(yy*w+x)*4)){right=x;break;}}return left>=0&&right>left?{left,right}:null;}
function linePaperBoundsY(data:Uint8ClampedArray,w:number,h:number,x:number,step=2){let top=-1,bottom=-1;const xx=clamp(Math.round(x),0,w-1);for(let y=0;y<h;y+=step){if(isPaperPixel(data,(y*w+xx)*4)){top=y;break;}}for(let y=h-1;y>=0;y-=step){if(isPaperPixel(data,(y*w+xx)*4)){bottom=y;break;}}return top>=0&&bottom>top?{top,bottom}:null;}
function intersectXofYwithYofX(xLine:{a:number;b:number},yLine:{a:number;b:number}){const den=1-xLine.a*yLine.a;if(Math.abs(den)<1e-6)return null;const x=(xLine.a*yLine.b+xLine.b)/den;return{x,y:yLine.a*x+yLine.b};}
function quadArea(q:PaperQuad){const p=[q.tl,q.tr,q.br,q.bl];let s=0;for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4];s+=a.x*b.y-b.x*a.y;}return Math.abs(s)/2;}

export function estimatePaperQuad(canvas:HTMLCanvasElement,fallback:CropBox):PaperQuad{
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const fb={tl:{x:fallback.x,y:fallback.y},tr:{x:fallback.x+fallback.w,y:fallback.y},br:{x:fallback.x+fallback.w,y:fallback.y+fallback.h},bl:{x:fallback.x,y:fallback.y+fallback.h},confidence:0};
  if(!ctx)return fb;
  const {width:w,height:h}=canvas,data=ctx.getImageData(0,0,w,h).data,step=Math.max(1,Math.round(Math.max(w,h)/1400));
  const rows:Array<{y:number;left:number;right:number}>=[];
  for(let k=0;k<17;k++){const y=fallback.y+fallback.h*(.02+.96*k/16),b=linePaperBoundsX(data,w,h,y,step);if(b&&b.right-b.left>fallback.w*.45)rows.push({y,left:b.left,right:b.right});}
  const cols:Array<{x:number;top:number;bottom:number}>=[];
  for(let k=0;k<17;k++){const x=fallback.x+fallback.w*(.02+.96*k/16),b=linePaperBoundsY(data,w,h,x,step);if(b&&b.bottom-b.top>fallback.h*.45)cols.push({x,top:b.top,bottom:b.bottom});}
  if(rows.length<7||cols.length<7)return fb;
  const left=fit1d(rows.map(p=>({t:p.y,v:p.left}))),right=fit1d(rows.map(p=>({t:p.y,v:p.right}))),top=fit1d(cols.map(p=>({t:p.x,v:p.top}))),bottom=fit1d(cols.map(p=>({t:p.x,v:p.bottom})));
  if(!left||!right||!top||!bottom)return fb;
  const tl=intersectXofYwithYofX(left,top),tr=intersectXofYwithYofX(right,top),br=intersectXofYwithYofX(right,bottom),bl=intersectXofYwithYofX(left,bottom);
  if(!tl||!tr||!br||!bl)return fb;
  const q:PaperQuad={tl,tr,br,bl,confidence:Math.min(rows.length,cols.length)/17};
  const finite=[tl,tr,br,bl].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  const area=quadArea(q),fbArea=Math.max(1,fallback.w*fallback.h);
  const margin=Math.max(w,h)*.08,inside=[tl,tr,br,bl].every(p=>p.x>=-margin&&p.x<=w+margin&&p.y>=-margin&&p.y<=h+margin);
  if(!finite||!inside||area<fbArea*.45||area>fbArea*1.8)return fb;
  return q;
}

function solveLinear(A:number[][],b:number[]){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[pivot][c]))pivot=r;if(Math.abs(M[pivot][c])<1e-9)return null;[M[c],M[pivot]]=[M[pivot],M[c]];const d=M[c][c];for(let k=c;k<=n;k++)M[c][k]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(!f)continue;for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}return M.map(r=>r[n]);}
function homographyRectToQuad(W:number,H:number,q:PaperQuad){const src=[[0,0],[W,0],[W,H],[0,H]],dst=[q.tl,q.tr,q.br,q.bl],A:number[][]=[],b:number[]=[];for(let i=0;i<4;i++){const[x,y]=src[i],u=dst[i].x,v=dst[i].y;A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}const h=solveLinear(A,b);return h?[...h,1]:null;}
function bilinearSample(src:Uint8ClampedArray,w:number,h:number,x:number,y:number,out:Uint8ClampedArray,o:number){if(x<0||y<0||x>w-1||y>h-1){out[o]=out[o+1]=out[o+2]=255;out[o+3]=255;return;}const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;for(let c=0;c<3;c++){const a=src[(y0*w+x0)*4+c]*(1-fx)+src[(y0*w+x1)*4+c]*fx,b=src[(y1*w+x0)*4+c]*(1-fx)+src[(y1*w+x1)*4+c]*fx;out[o+c]=Math.round(a*(1-fy)+b*fy);}out[o+3]=255;}

export function rectifyPaper(canvas:HTMLCanvasElement,fallback:CropBox):RectifiedPaper{
  const q=estimatePaperQuad(canvas,fallback),topW=Math.hypot(q.tr.x-q.tl.x,q.tr.y-q.tl.y),bottomW=Math.hypot(q.br.x-q.bl.x,q.br.y-q.bl.y),leftH=Math.hypot(q.bl.x-q.tl.x,q.bl.y-q.tl.y),rightH=Math.hypot(q.br.x-q.tr.x,q.br.y-q.tr.y),W=Math.max(32,Math.round((topW+bottomW)/2)),H=Math.max(32,Math.round((leftH+rightH)/2));
  const out=document.createElement("canvas");out.width=W;out.height=H;const ctx=out.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("rectify canvas unavailable");ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
  const Hm=homographyRectToQuad(W,H,q),srcCtx=canvas.getContext("2d",{willReadFrequently:true});let projectiveApplied=false;
  if(Hm&&srcCtx){const src=srcCtx.getImageData(0,0,canvas.width,canvas.height).data,dst=ctx.createImageData(W,H),d=dst.data;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const den=Hm[6]*x+Hm[7]*y+1;if(Math.abs(den)<1e-9)continue;const sx=(Hm[0]*x+Hm[1]*y+Hm[2])/den,sy=(Hm[3]*x+Hm[4]*y+Hm[5])/den;bilinearSample(src,canvas.width,canvas.height,sx,sy,d,(y*W+x)*4);}ctx.putImageData(dst,0,0);projectiveApplied=true;}else{ctx.drawImage(canvas,fallback.x,fallback.y,fallback.w,fallback.h,0,0,W,H);}
  const skewDeg=Math.atan2(q.tr.y-q.tl.y,q.tr.x-q.tl.x)*180/Math.PI,perspectiveDelta=Math.max(Math.abs(topW-bottomW)/Math.max(1,(topW+bottomW)/2),Math.abs(leftH-rightH)/Math.max(1,(leftH+rightH)/2));
  return{canvas:out,paper:{x:0,y:0,w:W,h:H},quad:q,skewDeg,perspectiveDelta,projectiveApplied};
}

function bandsFromScores(values:Array<{p:number;s:number}>,threshold:number){const v=values.filter(x=>x.s>=threshold).sort((a,b)=>a.p-b.p),bands:Array<{center:number;width:number;score:number}>=[];if(!v.length)return bands;let cur=[v[0]];for(let i=1;i<v.length;i++){if(v[i].p-v[i-1].p<=2)cur.push(v[i]);else{const sum=cur.reduce((s,x)=>s+x.s,0)||1;bands.push({center:cur.reduce((s,x)=>s+x.p*x.s,0)/sum,width:cur[cur.length-1].p-cur[0].p+1,score:Math.max(...cur.map(x=>x.s))});cur=[v[i]];}}const sum=cur.reduce((s,x)=>s+x.s,0)||1;bands.push({center:cur.reduce((s,x)=>s+x.p*x.s,0)/sum,width:cur[cur.length-1].p-cur[0].p+1,score:Math.max(...cur.map(x=>x.s))});return bands;}
function dedupeBandCenters(bands:Array<{center:number;width:number;score:number}>,minGap:number){const ranked=[...bands].sort((a,b)=>b.score-a.score),picked:typeof bands=[];for(const b of ranked)if(picked.every(p=>Math.abs(p.center-b.center)>=minGap))picked.push(b);return picked.sort((a,b)=>a.center-b.center);}

export function measureTableRules(canvas:HTMLCanvasElement,paper:CropBox):RuleSet{
  const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)return{horizontal:[],vertical:[],horizontalThickness:1,verticalThickness:1};const d=ctx.getImageData(0,0,canvas.width,canvas.height).data,xStep=Math.max(1,Math.round(paper.w/650)),yStep=Math.max(1,Math.round(paper.h/520));
  const hs:Array<{p:number;s:number}>=[];for(let y=Math.round(paper.h*.34);y<Math.round(paper.h*.94);y++){let dark=0,n=0;for(let x=Math.round(paper.w*.01);x<Math.round(paper.w*.72);x+=xStep){if(luminance(d,(y*canvas.width+x)*4)<145)dark++;n++;}hs.push({p:y,s:n?dark/n:0});}
  const vs:Array<{p:number;s:number}>=[];for(let x=Math.round(paper.w*.01);x<Math.round(paper.w*.72);x++){let dark=0,n=0;for(let y=Math.round(paper.h*.35);y<Math.round(paper.h*.93);y+=yStep){if(luminance(d,(y*canvas.width+x)*4)<145)dark++;n++;}vs.push({p:x,s:n?dark/n:0});}
  const hb=dedupeBandCenters(bandsFromScores(hs,.20),Math.max(2,paper.h*.006)),vb=dedupeBandCenters(bandsFromScores(vs,.28),Math.max(2,paper.w*.008));
  const median=(a:number[])=>a.length?[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]:1;
  return{horizontal:hb.map(b=>Math.round(b.center)),vertical:vb.map(b=>Math.round(b.center)),horizontalThickness:Math.max(1,Math.round(median(hb.map(b=>b.width)))),verticalThickness:Math.max(1,Math.round(median(vb.map(b=>b.width))))};
}

function nearestBelow(vals:number[],x:number,maxDist:number){return vals.filter(v=>v<x&&x-v<=maxDist).sort((a,b)=>(x-a)-(x-b))[0]??null;}
function nearestAbove(vals:number[],x:number,maxDist:number){return vals.filter(v=>v>x&&v-x<=maxDist).sort((a,b)=>(a-x)-(b-x))[0]??null;}

export function refineRowsByRules(rows:CandidateRow[],rules:RuleSet,paper:CropBox):CorrectedRow[]{return rows.map(row=>{const c=row.center,max=paper.h*.075,lo=nearestBelow(rules.horizontal,c,max),hi=nearestAbove(rules.horizontal,c,max);if(lo!==null&&hi!==null&&hi-lo>paper.h*.018&&hi-lo<paper.h*.12){const margin=Math.max(rules.horizontalThickness+1,paper.h*.0025);return{top:lo+margin,bottom:hi-margin,center:row.center,source:"a22-rule-bounded",boundedByRules:true,sourceRow:row};}const expand=Math.max((row.bottom-row.top)*.18,paper.h*.006);return{top:clamp(row.top-expand,paper.y,paper.y+paper.h),bottom:clamp(row.bottom+expand,paper.y,paper.y+paper.h),center:row.center,source:"a22-safe-expanded",boundedByRules:false,sourceRow:row};});}

const EXPECTED=[.02,.405,.425,.475,.575,.590,.685],RADII=[.04,.06,.05,.06,.06,.05,.07];
function assignExpectedRules(measured:number[],expected:number[],radii:number[]){const sorted=[...measured].sort((a,b)=>a-b),out:number[]=[];let minIndex=0;for(let i=0;i<expected.length;i++){let best=-1,bestD=Infinity;for(let j=minIndex;j<sorted.length;j++){const d=Math.abs(sorted[j]-expected[i]);if(d<=radii[i]&&d<bestD){best=j;bestD=d;}}if(best>=0){out.push(sorted[best]);minIndex=best+1;}else out.push(expected[i]);}return out;}
export function columnsFromMeasuredRules(rules:RuleSet,paper:CropBox):ColumnBoxes{const norm=rules.vertical.map(v=>v/paper.w),[b0,b1,b2,b3,b4,b5,b6]=assignExpectedRules(norm,EXPECTED,RADII),margin=Math.max((rules.verticalThickness+1)/paper.w,.003),safe=(a:number,b:number,fa:number,fb:number)=>b-a>.022?{x1:a+margin,x2:b-margin}:{x1:fa,x2:fb};return{name:safe(b0,b1,.025,.395),qty:safe(b2,b3,.432,.472),retail:safe(b3,b4,.480,.570),cost:safe(b5,b6,.596,.676)};}

function sharpnessOf(data:Uint8ClampedArray,w:number,h:number){let sum=0,n=0;for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2){const p=(y*w+x)*4,c=data[p],l=data[p-4],r=data[p+4],u=data[p-w*4],dn=data[p+w*4],lap=4*c-l-r-u-dn;sum+=lap*lap;n++;}return n?Math.sqrt(sum/n):0;}
function blob(c:HTMLCanvasElement,q=.96){return new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error("blob failed")),"image/jpeg",q));}

export async function makeA22CellCrop(canvas:HTMLCanvasElement,paper:CropBox,row:CorrectedRow,col:{x1:number;x2:number},field:FieldKey,rowIndex:number,target=1100):Promise<CellCrop>{const sx=paper.x+paper.w*col.x1,sw=paper.w*(col.x2-col.x1),sy=row.top,sh=Math.max(2,row.bottom-row.top),scale=Math.min(6,Math.max(1,target/sw)),padX=Math.max(4,Math.round(sw*scale*.025)),padY=Math.max(4,Math.round(sh*scale*.10)),out=document.createElement("canvas");out.width=Math.max(1,Math.round(sw*scale)+padX*2);out.height=Math.max(1,Math.round(sh*scale)+padY*2);const ctx=out.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("crop unavailable");ctx.fillStyle="#fff";ctx.fillRect(0,0,out.width,out.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(canvas,sx,sy,sw,sh,padX,padY,Math.round(sw*scale),Math.round(sh*scale));const image=ctx.getImageData(0,0,out.width,out.height);let min=255,max=0,dark=0;for(let i=0;i<image.data.length;i+=4){const r=image.data[i],g=image.data[i+1],b=image.data[i+2];let v=Math.round(r*.20+g*.72+b*.08);v=clamp(Math.round((v-128)*1.28+148),0,255);if(v>246)v=255;min=Math.min(min,v);max=Math.max(max,v);if(v<190)dark++;image.data[i]=image.data[i+1]=image.data[i+2]=v;}ctx.putImageData(image,0,0);const contrast=max-min,sharpness=sharpnessOf(image.data,out.width,out.height),signalRatio=dark/Math.max(1,out.width*out.height),cropHasSignal=contrast>=35&&signalRatio>.002;return{field,rowIndex,canvas:out,blob:await blob(out,.96),preview:out.toDataURL("image/jpeg",.7),width:out.width,height:out.height,padding:Math.max(padX,padY),upscale:scale,contrast,sharpness,cropHasSignal};}

export function classifyNormalization(raw:string,normalized:string,field:FieldKey){const r=raw.normalize("NFKC").trim(),n=normalized.normalize("NFKC").trim();if(!r&&!n)return"raw-blank";if(r&&n)return r===n?"unchanged":"transformed-nonempty";if(r&&!n){if(field!=="name"&&!/[0-9]/.test(r))return"numeric-policy-rejected-no-digit";if(field==="name"&&/^[\s|:;.,・]+$/.test(r))return"name-punctuation-only";return"emptied-other";}return"other";}
export function attributeNormalization(raw:string,normalized:string,field:FieldKey,crop:{truncationLikely?:boolean;tableLineLikely?:boolean;darkOccupancy?:number}){const klass=classifyNormalization(raw,normalized,field);if(klass==="raw-blank")return crop.truncationLikely||crop.tableLineLikely||((crop.darkOccupancy??1)<.0025)?"crop-or-input-suspect":"recognizer-blank-on-usable-crop";if(klass==="numeric-policy-rejected-no-digit"||klass==="name-punctuation-only")return crop.truncationLikely||crop.tableLineLikely?"crop-contamination-before-normalization":"recognizer-output-not-semantic";if(klass==="emptied-other")return"normalization-destructive-candidate";return"normalization-not-emptying";}
