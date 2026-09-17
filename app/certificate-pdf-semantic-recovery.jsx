"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";

function norm(v) { return String(v ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim(); }
function compact(v) { return norm(v).replace(/[\s:：・,，.。()（）\[\]［］]/g, ""); }
function token(item, w, h) {
  const text = norm(item?.str); if (!text) return null;
  const tr = item?.transform || [1,0,0,1,0,0];
  return { text, x:Number(tr[4]||0)/Math.max(1,w), y:1-Number(tr[5]||0)/Math.max(1,h), w:Math.max(Number(item?.width||0),1)/Math.max(1,w), h:Math.max(Math.abs(Number(tr[3]||0)),Number(item?.height||0),1)/Math.max(1,h) };
}
function linesFrom(tokens) {
  const lines=[];
  for (const t of [...tokens].sort((a,b)=>a.y-b.y||a.x-b.x)) {
    let l=lines.find(x=>Math.abs(x.y-t.y)<=Math.max(.0045,t.h*.72));
    if(!l){l={y:t.y,tokens:[]};lines.push(l);} l.tokens.push(t); l.y=l.tokens.reduce((s,x)=>s+x.y,0)/l.tokens.length;
  }
  for(const l of lines){l.tokens.sort((a,b)=>a.x-b.x);l.text=l.tokens.map(x=>x.text).join(" ");}
  return lines.sort((a,b)=>a.y-b.y);
}
function labelAnchor(lines,label){
  const wanted=compact(label);
  for(const line of lines){
    for(let s=0;s<line.tokens.length;s++){
      let joined="";
      for(let e=s;e<line.tokens.length&&e<s+12;e++){
        joined+=compact(line.tokens[e].text);
        if(joined.includes(wanted)) return {x:line.tokens[s].x,y:line.y,line,start:s,end:e};
        if(joined.length>wanted.length+18)break;
      }
    }
  }
  return null;
}
function cellText(tokens, anchor, left, right, bottom){
  if(!anchor)return "";
  const sameLine=anchor.line.tokens.slice(anchor.end+1).filter(t=>t.x>=left&&t.x<right).map(t=>t.text).join(" ");
  const below=tokens.filter(t=>t.y>anchor.y+.002&&t.y<bottom&&t.x>=left&&t.x<right).sort((a,b)=>a.y-b.y||a.x-b.x).map(t=>t.text).join(" ");
  return norm([sameLine,below].filter(Boolean).join(" "));
}
function numericCell(text){
  const s=norm(text).replace(/kg/ig," ");
  const m=s.match(/(\d{2,5})(?:\s*[\[［]\s*(\d{2,5})\s*[\]］])?/);
  if(!m)return "";
  return m[2]?`${Number(m[1])} [${Number(m[2])}]`:String(Number(m[1]));
}
function recoverWeights(tokens, lines){
  const defs=[["最大積載量","maxPayloadKg"],["車両重量","vehicleWeightKg"],["車両総重量","grossVehicleWeightKg"]];
  const anchors=defs.map(([label])=>labelAnchor(lines,label)); if(anchors.some(x=>!x))return {};
  const ordered=anchors.map((a,i)=>({a,i})).sort((p,q)=>p.a.x-q.a.x), bounds=new Map();
  for(let p=0;p<ordered.length;p++){
    const cur=ordered[p], prev=ordered[p-1]?.a, next=ordered[p+1]?.a;
    bounds.set(cur.i,[prev?(prev.x+cur.a.x)/2:Math.max(0,cur.a.x-.04),next?(cur.a.x+next.x)/2:1]);
  }
  const headerBottom=Math.max(...anchors.map(a=>a.y));
  const stopAnchors=[labelAnchor(lines,"車台番号"),labelAnchor(lines,"前前軸重"),labelAnchor(lines,"長さ")].filter(Boolean).filter(a=>a.y>headerBottom+.004);
  const bottom=stopAnchors.length?Math.min(...stopAnchors.map(a=>a.y))-.002:headerBottom+.085;
  const out={};
  defs.forEach(([,key],i)=>{const [left,right]=bounds.get(i);const v=numericCell(cellText(tokens,anchors[i],left,right,bottom));if(v)out[key]=v;});
  return out;
}
const ID_DEFS=[["所有者の氏名又は名称","ownerNameRaw"],["所有者の住所","ownerAddressRaw"],["使用者の氏名又は名称","userNameRaw"],["使用者の住所","userAddressRaw"]];
function cleanIdentity(v){return norm(v).replace(/\[\d+\]$/g,"").trim();}
function recoverIdentity(tokens,lines){
  const anchors=ID_DEFS.map(([label])=>labelAnchor(lines,label));
  const out={};
  for(let i=0;i<ID_DEFS.length;i++){
    const a=anchors[i]; if(!a)continue;
    const sameRow=anchors.filter(Boolean).filter(x=>Math.abs(x.y-a.y)<.025).sort((p,q)=>p.x-q.x);
    const pos=sameRow.indexOf(a), prev=sameRow[pos-1], next=sameRow[pos+1];
    const left=prev?(prev.x+a.x)/2:Math.max(0,a.x-.025), right=next?(a.x+next.x)/2:1;
    const lower=anchors.filter(Boolean).filter(x=>x.y>a.y+.008&&x.x>=left-.03&&x.x<right+.03).sort((p,q)=>p.y-q.y)[0];
    const bottom=lower?lower.y-.002:Math.min(1,a.y+.075);
    let value=cleanIdentity(cellText(tokens,a,left,right,bottom));
    for(const [label] of ID_DEFS)value=value.replace(new RegExp(compact(label),"g"),"");
    value=cleanIdentity(value);
    if(value&&value.length<=180)out[ID_DEFS[i][1]]=value;
  }
  return out;
}
function semanticDisplacement(detail){
  const current=norm(detail?.displacementOrRatedOutput); const m=current.match(/^(\d+(?:\.\d+)?)\s*(L|KW)$/i); if(!m)return "";
  const fuel=norm(detail?.fuel).toUpperCase(), engine=norm(detail?.engineModel);
  const combustionFuel=["ガソリン","揮発油","軽油","LPG","CNG"].some(x=>fuel.includes(x));
  const electricOnly=fuel==="電気"||fuel==="EV";
  if(combustionFuel&&engine)return `${m[1]} L`;
  if(electricOnly)return `${m[1]} KW`;
  return "";
}
async function extract(file){
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"); pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{let best=null;for(let n=1;n<=Math.min(pdf.numPages||1,8);n++){const page=await pdf.getPage(n),vp=page.getViewport({scale:1}),content=await page.getTextContent(),tokens=(content.items||[]).map(x=>token(x,vp.width,vp.height)).filter(Boolean),lines=linesFrom(tokens),text=compact(lines.map(l=>l.text).join(" "));const score=(text.includes("最大積載量")?3:0)+(text.includes("所有者の氏名又は名称")?3:0)+(text.includes("使用者の氏名又は名称")?2:0)+(text.includes("総排気量又は定格出力")?1:0);if(!best||score>best.score)best={tokens,lines,score,pageNumber:n};}return{...recoverWeights(best?.tokens||[],best?.lines||[]),...recoverIdentity(best?.tokens||[],best?.lines||[]),pageNumber:best?.pageNumber||1};}finally{await pdf.destroy?.().catch?.(()=>{});}
}
export default function CertificatePdfSemanticRecovery(){
  useLayoutEffect(()=>{let dead=false,pending=null,latest=null,dispatching=false;
    const onChange=e=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.type!=="file")return;const file=input.files?.[0];if(!file||!(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")))return;const copy=file.slice(0,file.size,file.type);pending=extract(copy).then(r=>{if(!dead)latest=r;return r;}).catch(()=>null);};
    const onAuth=async e=>{if(dispatching)return;const detail=e?.detail;if(!detail||typeof detail!=="object")return;const recovered=latest||(pending?await pending:null)||{};if(dead)return;const merged={...detail};for(const k of ["maxPayloadKg","vehicleWeightKg","grossVehicleWeightKg","ownerNameRaw","ownerAddressRaw","userNameRaw","userAddressRaw"]){if(recovered[k])merged[k]=recovered[k];}const semantic=semanticDisplacement(merged);if(semantic)merged.displacementOrRatedOutput=semantic;const changed=JSON.stringify(merged)!==JSON.stringify(detail);if(!changed)return;dispatching=true;try{window[PDF_PRIORITY_KEY]=merged;window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:merged}));}finally{dispatching=false;}};
    window.addEventListener("change",onChange,true);window.addEventListener(AUTH_EVENT,onAuth);return()=>{dead=true;window.removeEventListener("change",onChange,true);window.removeEventListener(AUTH_EVENT,onAuth);};
  },[]);return null;
}
