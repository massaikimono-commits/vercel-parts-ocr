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
function labelX(line,label){const wanted=compact(label);for(let s=0;s<line.tokens.length;s++){let j="";for(let e=s;e<line.tokens.length&&e<s+8;e++){j+=compact(line.tokens[e].text);if(j.includes(wanted))return line.tokens[s].x;if(j.length>wanted.length+10)break;}}return null;}
function primaryNumber(text){const outside=norm(text).replace(/[\[［].*?[\]］]/g," ");const m=outside.match(/(?:^|\D)(\d{2,5})(?:\D|$)/);return m?String(Number(m[1])):"";}
function recoverWeights(tokens, lines){
  const header=lines.find(l=>{const t=compact(l.text);return t.includes("最大積載量")&&t.includes("車両重量")&&t.includes("車両総重量");});
  if(!header)return {};
  const labels=["最大積載量","車両重量","車両総重量"], xs=labels.map(x=>labelX(header,x)); if(xs.some(x=>x===null))return {};
  const ordered=xs.map((x,i)=>({x,i})).sort((a,b)=>a.x-b.x), bounds=new Map();
  for(let p=0;p<ordered.length;p++){const left=p===0?ordered[p].x-.02:(ordered[p-1].x+ordered[p].x)/2;const right=p===ordered.length-1?1:(ordered[p].x+ordered[p+1].x)/2;bounds.set(ordered[p].i,[left,right]);}
  const next=lines.find(l=>l.y>header.y+.006&&compact(l.text).includes("車台番号")&&compact(l.text).includes("前前軸重")); const maxY=next?next.y-.002:header.y+.09;
  const vals=labels.map((_,i)=>{const [left,right]=bounds.get(i);return primaryNumber(tokens.filter(t=>t.y>header.y+.002&&t.y<maxY&&t.x>=left&&t.x<right).sort((a,b)=>a.y-b.y||a.x-b.x).map(t=>t.text).join(" "));});
  const out={}; if(vals[0])out.maxPayloadKg=vals[0];if(vals[1])out.vehicleWeightKg=vals[1];if(vals[2])out.grossVehicleWeightKg=vals[2];return out;
}
const OWNER_LABELS=["所有者の氏名又は名称","所有者の住所","使用者の氏名又は名称","使用者の住所"];
function recoverIdentity(lines){
  const out={}; const map=[["所有者の氏名又は名称","ownerNameRaw"],["所有者の住所","ownerAddressRaw"],["使用者の氏名又は名称","userNameRaw"],["使用者の住所","userAddressRaw"]];
  const isLabel=s=>OWNER_LABELS.some(l=>compact(s).includes(compact(l)));
  for(const [label,key] of map){
    const wanted=compact(label); const i=lines.findIndex(l=>compact(l.text).includes(wanted)); if(i<0)continue;
    const line=lines[i]; let value=""; let joined="";
    for(let p=0;p<line.tokens.length;p++){joined+=compact(line.tokens[p].text);if(joined.includes(wanted)){value=norm(line.tokens.slice(p+1).map(t=>t.text).join(" "));break;}}
    if(!value){for(let j=i+1;j<Math.min(lines.length,i+4);j++){if(isLabel(lines[j].text))break;const candidate=norm(lines[j].text);if(candidate){value=candidate;break;}}}
    value=value.replace(/\[\d+\]$/g,"").trim(); if(value&&value.length<=160)out[key]=value;
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
  try{let best=null;for(let n=1;n<=Math.min(pdf.numPages||1,8);n++){const page=await pdf.getPage(n),vp=page.getViewport({scale:1}),content=await page.getTextContent(),tokens=(content.items||[]).map(x=>token(x,vp.width,vp.height)).filter(Boolean),lines=linesFrom(tokens),text=compact(lines.map(l=>l.text).join(" "));const score=(text.includes("最大積載量")?3:0)+(text.includes("所有者の氏名又は名称")?3:0)+(text.includes("使用者の氏名又は名称")?2:0)+(text.includes("総排気量又は定格出力")?1:0);if(!best||score>best.score)best={tokens,lines,score,pageNumber:n};}return{...recoverWeights(best?.tokens||[],best?.lines||[]),...recoverIdentity(best?.lines||[]),pageNumber:best?.pageNumber||1};}finally{await pdf.destroy?.().catch?.(()=>{});}
}
export default function CertificatePdfSemanticRecovery(){
  useLayoutEffect(()=>{let dead=false,pending=null,latest=null,dispatching=false;
    const onChange=e=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.type!=="file")return;const file=input.files?.[0];if(!file||!(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")))return;const copy=file.slice(0,file.size,file.type);pending=extract(copy).then(r=>{if(!dead)latest=r;return r;}).catch(()=>null);};
    const onAuth=async e=>{if(dispatching)return;const detail=e?.detail;if(!detail||typeof detail!=="object")return;const recovered=latest||(pending?await pending:null)||{};if(dead)return;const merged={...detail};for(const k of ["maxPayloadKg","vehicleWeightKg","grossVehicleWeightKg","ownerNameRaw","ownerAddressRaw","userNameRaw","userAddressRaw"]){if(recovered[k])merged[k]=recovered[k];}const semantic=semanticDisplacement(merged);if(semantic)merged.displacementOrRatedOutput=semantic;const changed=JSON.stringify(merged)!==JSON.stringify(detail);if(!changed)return;dispatching=true;try{window[PDF_PRIORITY_KEY]=merged;window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:merged}));}finally{dispatching=false;}};
    window.addEventListener("change",onChange,true);window.addEventListener(AUTH_EVENT,onAuth);return()=>{dead=true;window.removeEventListener("change",onChange,true);window.removeEventListener(AUTH_EVENT,onAuth);};
  },[]);return null;
}
