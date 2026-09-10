/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type { CropBox } from "../../dynamic-rows";
import type { FieldKey } from "../stage-a20/recognition";
import type { CandidateRow, ColumnBoxes, CellCrop } from "../stage-a20/a19-table-crops";

export type PaperQuad={tl:{x:number;y:number};tr:{x:number;y:number};br:{x:number;y:number};bl:{x:number;y:number};confidence:number};
export type RectifiedPaper={canvas:HTMLCanvasElement;paper:CropBox;quad:PaperQuad;skewDeg:number;perspectiveDelta:number};
export type RuleSet={horizontal:number[];vertical:number[];horizontalThickness:number;verticalThickness:number};
export type CorrectedRow=CandidateRow&{boundedByRules:boolean;sourceRow:CandidateRow};

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const luminance=(d:Uint8ClampedArray,i:number)=>d[i]*.20+d[i+1]*.72+d[i+2]*.08;

function isPaperPixel(d:Uint8ClampedArray,i:number){const r=d[i],g=d[i+1],b=d[i+2],v=(r+g+b)/3;return v>155||(r>105&&g>100&&r+g>b*1.72);}

function linePaperBounds(data:Uint8ClampedArray,w:number,h:number,y:number,step=2){let left=-1,right=-1;const yy=clamp(Math.round(y),0,h-1);for(let x=0;x<w;x+=step){if(isPaperPixel(data,(yy*w+x)*4)){left=x;break;}}for(let x=w-1;x>=0;x-=step){if(isPaperPixel(data,(yy*w+x)*4)){right=x;break;}}return left>=0&&right>left?{left,right}:null;}

export function estimatePaperQuad(canvas:HTMLCanvasElement,fallback:CropBox):PaperQuad{
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  if(!ctx)return{tl:{x:fallback.x,y:fallback.y},tr:{x:fallback.x+fallback.w,y:fallback.y},br:{x:fallback.x+fallback.w,y:fallback.y+fallback.h},bl:{x:fallback.x,y:fallback.y+fallback.h},confidence:0};
  const {width:w,height:h}=canvas,data=ctx.getImageData(0,0,w,h).data;
  const samples:Array<{y:number;left:number;right:number}>=[];
  for(let k=0;k<13;k++){
    const y=fallback.y+fallback.h*(.04+.92*k/12);
    const b=linePaperBounds(data,w,h,y,Math.max(1,Math.round(w/1200)));
    if(b&&b.right-b.left>fallback.w*.45)samples.push({y,left:b.left,right:b.right});
  }
  if(samples.length<5)return{tl:{x:fallback.x,y:fallback.y},tr:{x:fallback.x+fallback.w,y:fallback.y},br:{x:fallback.x+fallback.w,y:fallback.y+fallback.h},bl:{x:fallback.x,y:fallback.y+fallback.h},confidence:0};
  const fit=(key:"left"|"right")=>{let sy=0,sx=0,syy=0,syx=0;for(const p of samples){sy+=p.y;sx+=p[key];syy+=p.y*p.y;syx+=p.y*p[key];}const n=samples.length,den=n*syy-sy*sy||1,a=(n*syx-sy*sx)/den,b=(sx-a*sy)/n;return(y:number)=>a*y+b;};
  const lf=fit("left"),rf=fit("right"),top=samples[0].y,bottom=samples[samples.length-1].y;
  return{tl:{x:lf(top),y:top},tr:{x:rf(top),y:top},br:{x:rf(bottom),y:bottom},bl:{x:lf(bottom),y:bottom},confidence:samples.length/13};
}

function drawTriangle(ctx:CanvasRenderingContext2D,img:HTMLCanvasElement,s0:any,s1:any,s2:any,d0:any,d1:any,d2:any){
  const den=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);if(Math.abs(den)<1e-6)return;
  const A=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/den;
  const C=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/den;
  const E=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/den;
  const B=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/den;
  const D=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/den;
  const F=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/den;
  ctx.save();ctx.beginPath();ctx.moveTo(d0.x,d0.y);ctx.lineTo(d1.x,d1.y);ctx.lineTo(d2.x,d2.y);ctx.closePath();ctx.clip();ctx.setTransform(A,B,C,D,E,F);ctx.drawImage(img,0,0);ctx.restore();
}

export function rectifyPaper(canvas:HTMLCanvasElement,fallback:CropBox):RectifiedPaper{
  const q=estimatePaperQuad(canvas,fallback);
  const topW=Math.hypot(q.tr.x-q.tl.x,q.tr.y-q.tl.y),bottomW=Math.hypot(q.br.x-q.bl.x,q.br.y-q.bl.y),leftH=Math.hypot(q.bl.x-q.tl.x,q.bl.y-q.tl.y),rightH=Math.hypot(q.br.x-q.tr.x,q.br.y-q.tr.y);
  const W=Math.max(32,Math.round((topW+bottomW)/2)),H=Math.max(32,Math.round((leftH+rightH)/2));
  const out=document.createElement("canvas");out.width=W;out.height=H;const ctx=out.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("rectify canvas unavailable");ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
  drawTriangle(ctx,canvas,q.tl,q.tr,q.br,{x:0,y:0},{x:W,y:0},{x:W,y:H});
  drawTriangle(ctx,canvas,q.tl,q.br,q.bl,{x:0,y:0},{x:W,y:H},{x:0,y:H});
  const skewDeg=Math.atan2(q.tr.y-q.tl.y,q.tr.x-q.tl.x)*180/Math.PI;
  const perspectiveDelta=Math.abs(topW-bottomW)/Math.max(1,(topW+bottomW)/2);
  return{canvas:out,paper:{x:0,y:0,w:W,h:H},quad:q,skewDeg,perspectiveDelta};
}

function clusterPeaks(values:Array<{p:number;s:number}>,threshold:number,minGap:number){const ranked=values.filter(x=>x.s>=threshold).sort((a,b)=>b.s-a.s),picked:number[]=[];for(const x of ranked){if(picked.every(p=>Math.abs(p-x.p)>=minGap))picked.push(x.p);}return picked.sort((a,b)=>a-b);}

export function measureTableRules(canvas:HTMLCanvasElement,paper:CropBox):RuleSet{
  const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)return{horizontal:[],vertical:[],horizontalThickness:1,verticalThickness:1};
  const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const xs=Math.max(1,Math.round(paper.w/600)),ys=Math.max(1,Math.round(paper.h/500));
  const horizontal:Array<{p:number;s:number}>=[];
  for(let y=Math.round(paper.h*.34);y<Math.round(paper.h*.94);y+=ys){let dark=0,n=0;for(let x=Math.round(paper.w*.01);x<Math.round(paper.w*.72);x+=xs){if(luminance(d,(y*canvas.width+x)*4)<145)dark++;n++;}horizontal.push({p:y,s:n?dark/n:0});}
  const vertical:Array<{p:number;s:number}>=[];
  for(let x=Math.round(paper.w*.01);x<Math.round(paper.w*.72);x+=xs){let dark=0,n=0;for(let y=Math.round(paper.h*.35);y<Math.round(paper.h*.93);y+=ys){if(luminance(d,(y*canvas.width+x)*4)<145)dark++;n++;}vertical.push({p:x,s:n?dark/n:0});}
  const h=clusterPeaks(horizontal,.20,Math.max(2,paper.h*.006));
  const v=clusterPeaks(vertical,.28,Math.max(2,paper.w*.008));
  const thickness=(arr:number[],axis:"x"|"y")=>{if(!arr.length)return 1;const widths:number[]=[];for(const p of arr){let a=p,b=p;for(let k=1;k<8;k++){const pos=p-k;if(pos<0)break;let ratio=0,n=0;if(axis==="y"){for(let x=Math.round(paper.w*.05);x<Math.round(paper.w*.70);x+=xs){if(luminance(d,(pos*canvas.width+x)*4)<160)ratio++;n++;}}else{for(let y=Math.round(paper.h*.38);y<Math.round(paper.h*.90);y+=ys){if(luminance(d,(y*canvas.width+pos)*4)<160)ratio++;n++;}}if(n&&ratio/n>.12)a=pos;else break;}for(let k=1;k<8;k++){const pos=p+k;if((axis==="y"?pos>=canvas.height:pos>=canvas.width))break;let ratio=0,n=0;if(axis==="y"){for(let x=Math.round(paper.w*.05);x<Math.round(paper.w*.70);x+=xs){if(luminance(d,(pos*canvas.width+x)*4)<160)ratio++;n++;}}else{for(let y=Math.round(paper.h*.38);y<Math.round(paper.h*.90);y+=ys){if(luminance(d,(y*canvas.width+pos)*4)<160)ratio++;n++;}}if(n&&ratio/n>.12)b=pos;else break;}widths.push(b-a+1);}return Math.max(1,Math.round(widths.sort((a,b)=>a-b)[Math.floor(widths.length/2)]||1));};
  return{horizontal:h,vertical:v,horizontalThickness:thickness(h,"y"),verticalThickness:thickness(v,"x")};
}

function nearestBelow(vals:number[],x:number,maxDist:number){return vals.filter(v=>v<x&&x-v<=maxDist).sort((a,b)=>x-b-(x-a))[0]??null;}
function nearestAbove(vals:number[],x:number,maxDist:number){return vals.filter(v=>v>x&&v-x<=maxDist).sort((a,b)=>(a-x)-(b-x))[0]??null;}

export function refineRowsByRules(rows:CandidateRow[],rules:RuleSet,paper:CropBox):CorrectedRow[]{
  return rows.map(row=>{const c=(row.center-paper.y)/paper.h*paper.h;const max=paper.h*.075;const lo=nearestBelow(rules.horizontal,c,max),hi=nearestAbove(rules.horizontal,c,max);if(lo!==null&&hi!==null&&hi-lo>paper.h*.018&&hi-lo<paper.h*.12){const margin=Math.max(rules.horizontalThickness+1,paper.h*.0025);return{top:lo+margin,bottom:hi-margin,center:(lo+hi)/2,source:"a22-rule-bounded",boundedByRules:true,sourceRow:row};}const expand=Math.max((row.bottom-row.top)*.18,paper.h*.006);return{top:clamp(row.top-expand,paper.y,paper.y+paper.h),bottom:clamp(row.bottom+expand,paper.y,paper.y+paper.h),center:row.center,source:"a22-safe-expanded",boundedByRules:false,sourceRow:row};});
}

const EXPECTED=[.02,.405,.425,.475,.575,.590,.685];
export function columnsFromMeasuredRules(rules:RuleSet,paper:CropBox):ColumnBoxes{
  const norm=rules.vertical.map(v=>v/paper.w);const pick=(e:number,r=.06)=>norm.filter(v=>Math.abs(v-e)<=r).sort((a,b)=>Math.abs(a-e)-Math.abs(b-e))[0]??e;
  const [b0,b1,b2,b3,b4,b5,b6]=EXPECTED.map((e,i)=>pick(e,i===0?.04:i===6?.07:.06));
  const margin=Math.max((rules.verticalThickness+1)/paper.w,.003);
  const safe=(a:number,b:number,fa:number,fb:number)=>b-a>.022?{x1:a+margin,x2:b-margin}:{x1:fa,x2:fb};
  return{name:safe(b0,b1,.025,.395),qty:safe(b2,b3,.432,.472),retail:safe(b3,b4,.480,.570),cost:safe(b5,b6,.596,.676)};
}

function sharpnessOf(data:Uint8ClampedArray,w:number,h:number){let sum=0,n=0;for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2){const p=(y*w+x)*4,c=data[p],l=data[p-4],r=data[p+4],u=data[p-w*4],dn=data[p+w*4],lap=4*c-l-r-u-dn;sum+=lap*lap;n++;}return n?Math.sqrt(sum/n):0;}
function blob(c:HTMLCanvasElement,q=.96){return new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error("blob failed")),"image/jpeg",q));}

export async function makeA22CellCrop(canvas:HTMLCanvasElement,paper:CropBox,row:CorrectedRow,col:{x1:number;x2:number},field:FieldKey,rowIndex:number,target=1100):Promise<CellCrop>{
  const x=paper.x+paper.w*col.x1,w=paper.w*(col.x2-col.x1),y=row.top,h=Math.max(2,row.bottom-row.top),scale=Math.min(6,Math.max(1,target/w));
  const out=document.createElement("canvas");out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));const ctx=out.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("crop unavailable");ctx.fillStyle="#fff";ctx.fillRect(0,0,out.width,out.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(canvas,x,y,w,h,0,0,out.width,out.height);
  const image=ctx.getImageData(0,0,out.width,out.height);let min=255,max=0,dark=0;for(let i=0;i<image.data.length;i+=4){const r=image.data[i],g=image.data[i+1],b=image.data[i+2];let v=Math.round(r*.20+g*.72+b*.08);v=clamp(Math.round((v-128)*1.28+148),0,255);if(v>246)v=255;min=Math.min(min,v);max=Math.max(max,v);if(v<190)dark++;image.data[i]=image.data[i+1]=image.data[i+2]=v;}ctx.putImageData(image,0,0);
  const contrast=max-min,sharpness=sharpnessOf(image.data,out.width,out.height),signalRatio=dark/Math.max(1,out.width*out.height),cropHasSignal=contrast>=35&&signalRatio>.002;
  return{field,rowIndex,canvas:out,blob:await blob(out,.96),preview:out.toDataURL("image/jpeg",.7),width:out.width,height:out.height,padding:0,upscale:scale,contrast,sharpness,cropHasSignal};
}

export function classifyNormalization(raw:string,normalized:string,field:FieldKey){const r=raw.normalize("NFKC").trim(),n=normalized.trim();if(!r&&!n)return"raw-blank";if(r&&n)return r===n?"unchanged":"transformed-nonempty";if(r&&!n){if(field!=="name"&&!/\d/.test(r))return"numeric-policy-rejected-no-digit";if(field==="name"&&/^[\s|:;.,・]+$/.test(r))return"name-punctuation-only";return"emptied-other";}return"other";}
