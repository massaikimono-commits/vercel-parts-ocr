/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";

type FuelType = "EV" | "ガソリン" | "HV" | "ディーゼル" | "その他";
type Cert = Record<string, string>;
type Vehicle = {
  id?: string; number: string; registration: string; last4: string; chassis: string;
  model: string; type: FuelType; weight: string; firstRegistration: string;
  customerId: string; certificate: Cert;
};
type Box = { x:number; y:number; w:number; h:number };
type AuthoritativePatch = Partial<Cert> & {
  registrationNumber?: string; chassisNumber?: string; model?: string;
  vehicleWeightKg?: string; firstRegistration?: string; fuel?: string;
};

const FIELDS = [
  ["recordDate","記録年月日"],["documentNumber","記録事項番号"],["registrationNumber","自動車登録番号又は車両番号"],
  ["chassisNumber","車台番号"],["registrationDate","登録年月日／交付年月日"],["firstRegistration","初度登録年月"],
  ["inspectionExpiry","有効期間の満了する日"],["userName","使用者の氏名又は名称"],["userAddress","使用者の住所"],
  ["baseLocation","使用の本拠の位置"],["vehicleName","車名"],["model","型式"],["engineModel","原動機の型式"],
  ["vehicleClass","自動車の種別"],["purpose","用途"],["privateBusiness","自家用・事業用の別"],["bodyShape","車体の形状"],
  ["seatingCapacity","乗車定員"],["maxPayloadKg","最大積載量 kg"],["vehicleWeightKg","車両重量 kg"],
  ["grossVehicleWeightKg","車両総重量 kg"],["lengthCm","長さ cm"],["widthCm","幅 cm"],["heightCm","高さ cm"],
  ["frontFrontAxleWeightKg","前前軸重 kg"],["frontRearAxleWeightKg","前後軸重 kg"],["rearFrontAxleWeightKg","後前軸重 kg"],
  ["rearRearAxleWeightKg","後後軸重 kg"],["displacementOrRatedOutput","総排気量又は定格出力"],["fuel","燃料の種類"],
  ["modelDesignationNumber","型式指定番号"],["classificationNumber","類別区分番号"]
] as const;

const emptyCert = () => Object.fromEntries(FIELDS.map(([k]) => [k, ""])) as Cert;
const EMPTY: Vehicle = { number:"",registration:"",last4:"",chassis:"",model:"",type:"その他",weight:"",firstRegistration:"",customerId:"",certificate:emptyCert() };
const ACTIVE_KEY = "parts-active-vehicle";
const BEFORE_KEY = "parts-before-ocr-ids";
const AUTH_EVENT = "vehicle-certificate-authoritative";
const DATE_CANDIDATES_KEY = "__vehicleCertificateRegistrationDateCandidates";

function norm(s:string){ return (s||"").normalize("NFKC").replace(/[‐‑‒–—―ー]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim(); }
function digits(s:string){ return s.replace(/\D/g,""); }
function display(v:Vehicle){ return v.registration || v.number || v.chassis || "車両"; }
function eraYear(e:string,y:string){ const n=y==="元"?1:Number(y); return e==="令和"?2018+n:e==="平成"?1988+n:e==="昭和"?1925+n:0; }
function jpMonth(s:string){ const t=norm(s); const m=t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/); if(m){const mm=Number(m[3]); if(mm>=1&&mm<=12)return `${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mm}月`;} const loose=t.replace(/[年月日.,/\-]/g," ").replace(/\s+/g," "); const q=loose.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s+(\d{1,2})/); if(q){const mm=Number(q[3]); if(mm>=1&&mm<=12)return `${q[1]}${q[2]==="元"?"元":Number(q[2])}年${mm}月`;} return ""; }
function jpDate(s:string){ const t=norm(s); const m=t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/); if(m){const mm=Number(m[3]),dd=Number(m[4]); if(mm>=1&&mm<=12&&dd>=1&&dd<=31)return `${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mm}月${dd}日`;} const loose=t.replace(/[年月日.,/\-]/g," ").replace(/\s+/g," "); const q=loose.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/); if(q){const mm=Number(q[3]),dd=Number(q[4]); if(mm>=1&&mm<=12&&dd>=1&&dd<=31)return `${q[1]}${q[2]==="元"?"元":Number(q[2])}年${mm}月${dd}日`;} return ""; }
function dateIso(s:string){ const m=norm(s).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/); if(!m)return null; const y=eraYear(m[1],m[2]); return y?`${y}-${String(Number(m[3])).padStart(2,"0")}-${String(Number(m[4])).padStart(2,"0")}`:null; }
function monthOrdinal(s:string){ const m=norm(s).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月/); if(!m)return null; const y=eraYear(m[1],m[2]),mo=Number(m[3]); return y&&mo>=1&&mo<=12?y*12+mo:null; }
function dateOrdinal(s:string){ const m=norm(s).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/); if(!m)return null; const y=eraYear(m[1],m[2]),mo=Number(m[3]),d=Number(m[4]); if(!y||mo<1||mo>12||d<1||d>31)return null; return y*10000+mo*100+d; }
function plausibleRegistrationDate(value:string,firstRegistration:string,inspectionExpiry:string){
  const r=dateOrdinal(value); if(!r)return false;
  const first=monthOrdinal(firstRegistration), expiry=dateOrdinal(inspectionExpiry);
  if(first){ const ry=Math.floor(r/10000),rm=Math.floor((r%10000)/100); if(ry*12+rm<first)return false; }
  if(expiry&&r>expiry)return false;
  return true;
}
function fuelType(s:string):FuelType{ const t=norm(s); if(/軽油|ディーゼル/.test(t))return "ディーゼル"; if(/ハイブリッド|\bHV\b/.test(t))return "HV"; if(/電気自動車|\bEV\b|電気/.test(t))return "EV"; if(/ガソリン|揮発油/.test(t))return "ガソリン"; return "その他"; }
function reg(s:string){ const t=norm(s); const m=t.match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/); if(!m)return ""; return `${m[1]} ${digits(m[2])} ${m[3]} ${digits(m[4])}`; }
function chassis(s:string){ const t=norm(s).toUpperCase().replace(/\s+/g,""); const a=t.match(/[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}/g)||[]; return a.map(x=>{const [l,r]=x.split("-");return `${l}-${r.replace(/O/g,"0")}`;}).sort((a,b)=>b.length-a.length)[0]||""; }
function model(s:string){ const t=norm(s).toUpperCase().replace(/\s+/g,""); const a=t.match(/(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,12}/g)||[]; return a.filter(x=>!/^[A-Z]{1,4}[0-9]{2,6}-[0-9]{4,10}$/.test(x)).sort((a,b)=>b.length-a.length)[0]||""; }
function repairModel(m:string,c:string){ if(!m||!c||!m.includes("-")||!c.includes("-"))return m; const fam=c.split("-")[0]; const [p,r]=m.split("-"); const i=r.indexOf(fam); return i>=0?`${p}-${r.slice(i)}`:m; }
function integer(s:string,min:number,max:number){ const a=(norm(s).replace(/[Oo]/g,"0").replace(/[Il|]/g,"1").replace(/,/g,"").match(/\d{1,6}/g)||[]); for(const x of a){const n=Number(x);if(n>=min&&n<=max)return String(n);} return ""; }
function intDash(s:string,min:number,max:number){ return integer(s,min,max) || (/(^|\s)-($|\s)/.test(norm(s))?"-":""); }
function docNo(s:string){ const d=digits(norm(s)); return d.match(/\d{10,14}/)?.[0]||""; }
function pick(s:string,a:string[]){ const t=norm(s).replace(/\s+/g,""); return a.find(v=>t.includes(v.replace(/\s+/g,"")))||""; }
const vehicleClass=(s:string)=>pick(s,["普通","小型","軽自動車","大型特殊"]);
const purpose=(s:string)=>pick(s,["貨物","乗用","乗合","特種"]);
const privateBiz=(s:string)=>pick(s,["自家用","事業用"]);
const body=(s:string)=>pick(s,["バン","キャブオーバ","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]);
const maker=(s:string)=>pick(s,["日野","トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","メルセデス・ベンツ","BMW","アウディ","フォルクスワーゲン","ボルボ"]);
const fuelText=(s:string)=>pick(s,["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]);
function engine(s:string){ const t=norm(s).toUpperCase().replace(/\s+/g,"").replace(/O/g,"0"); return (t.match(/[A-Z0-9]{3,8}/g)||[]).find(x=>/[A-Z]/.test(x)&&/\d/.test(x))||""; }
function freeJp(s:string){ const t=norm(s).replace(/\n/g," ").replace(/\s+/g," ").replace(/^[\s|:：,，.。・/\\\-]+|[\s|:：,，.。・/\\\-]+$/g,"").trim(); if(!t||t.length>80)return ""; const jp=(t.match(/[一-龠ぁ-んァ-ヶ]/g)||[]).length, en=(t.match(/[A-Za-z]/g)||[]).length; return jp===0&&en>4?"":t; }
function output(s:string){ const t=norm(s); return t.match(/[0-9]+(?:\.[0-9]+)?\s*(?:L|l|kW|KW|kw)?/)?.[0]?.replace(/\s+/g,"")||""; }
function afterLabel(text:string, labels:string[]){ const lines=norm(text).split("\n").map(x=>x.trim()).filter(Boolean); for(let i=0;i<lines.length;i++){ if(!labels.some(l=>lines[i].replace(/\s+/g,"").includes(l.replace(/\s+/g,""))))continue; for(let j=i+1;j<Math.min(lines.length,i+5);j++)if(lines[j])return lines[j]; } return ""; }
function context(text:string, labels:string[],n=140){ const t=norm(text); for(const l of labels){const i=t.indexOf(l);if(i>=0)return t.slice(i,i+n);} return ""; }
function toInt(s:string){ const n=Number(s); return s&&s!=="-"&&Number.isFinite(n)?n:null; }
function mode(items:string[]){ const m=new Map<string,number>(); for(const v of items.filter(Boolean))m.set(v,(m.get(v)||0)+1); return [...m.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||""; }

function mergeVehicle(prev:Vehicle,patch:AuthoritativePatch){
  const certificate={...prev.certificate};
  for(const [k,v] of Object.entries(patch)){ if(typeof v==="string"&&v.trim())certificate[k]=v.trim(); }
  const first=certificate.firstRegistration||prev.firstRegistration;
  const expiry=certificate.inspectionExpiry;
  if(patch.registrationDate && !plausibleRegistrationDate(patch.registrationDate,first,expiry)){
    certificate.registrationDate=prev.certificate.registrationDate||"";
  }
  const registration=certificate.registrationNumber||prev.registration;
  const chassisNumber=certificate.chassisNumber||prev.chassis;
  return {
    ...prev,
    certificate,
    registration,
    last4:registration.match(/(\d{4})(?!.*\d)/)?.[1]||prev.last4,
    chassis:chassisNumber,
    number:chassisNumber||registration||prev.number,
    model:certificate.model||prev.model,
    weight:certificate.vehicleWeightKg||prev.weight,
    firstRegistration:certificate.firstRegistration||prev.firstRegistration,
    type:certificate.fuel?fuelType(certificate.fuel):prev.type,
  };
}

async function loadCanvas(file:File){ const url=URL.createObjectURL(file); try{ const img=await new Promise<HTMLImageElement>((res,rej)=>{const x=new Image();x.onload=()=>res(x);x.onerror=()=>rej(new Error("画像を開けませんでした"));x.src=url;}); const scale=Math.min(1,3600/Math.max(img.naturalWidth,img.naturalHeight)); const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale); const ctx=c.getContext("2d",{willReadFrequently:true})!;ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c;} finally{URL.revokeObjectURL(url);} }
function detectPaper(c:HTMLCanvasElement):Box{ const ctx=c.getContext("2d",{willReadFrequently:true}); if(!ctx)return{x:0,y:0,w:c.width,h:c.height}; const {width:w,height:h}=c,d=ctx.getImageData(0,0,w,h).data,step=Math.max(3,Math.floor(Math.max(w,h)/700)); const ok=(x:number,y:number)=>{const p=(y*w+x)*4,r=d[p],g=d[p+1],b=d[p+2],br=(r+g+b)/3;return br>128&&Math.max(r,g,b)-Math.min(r,g,b)<75;}; const ys:number[]=[]; for(let y=0;y<h;y+=step){let hit=0,n=0;for(let x=0;x<w;x+=step){if(ok(x,y))hit++;n++;}if(hit/Math.max(1,n)>.28)ys.push(y);} if(ys.length<10)return{x:0,y:0,w,h}; const top=Math.max(0,ys[0]-step*2),bottom=Math.min(h-1,ys[ys.length-1]+step*2); const xs:number[]=[]; for(let x=0;x<w;x+=step){let hit=0,n=0;for(let y=top;y<=bottom;y+=step){if(ok(x,y))hit++;n++;}if(hit/Math.max(1,n)>.28)xs.push(x);} if(xs.length<10)return{x:0,y:top,w,h:bottom-top+1}; const left=Math.max(0,xs[0]-step*2),right=Math.min(w-1,xs[xs.length-1]+step*2); return{x:left,y:top,w:right-left+1,h:bottom-top+1}; }
function rel(p:Box,x:number,y:number,w:number,h:number):Box{return{x:Math.round(p.x+p.w*x),y:Math.round(p.y+p.h*y),w:Math.round(p.w*w),h:Math.round(p.h*h)};}
function crop(source:HTMLCanvasElement,b:Box,target=1800,binary=false){ const sc=Math.max(1,Math.min(6,target/Math.max(1,b.w))),c=document.createElement("canvas");c.width=Math.max(1,Math.round(b.w*sc));c.height=Math.max(1,Math.round(b.h*sc));const x=c.getContext("2d",{willReadFrequently:true})!;x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";x.drawImage(source,b.x,b.y,b.w,b.h,0,0,c.width,c.height);const im=x.getImageData(0,0,c.width,c.height),gray=new Uint8Array(c.width*c.height);let sum=0;for(let p=0,i=0;p<im.data.length;p+=4,i++){const v=Math.round(im.data[p]*.22+im.data[p+1]*.70+im.data[p+2]*.08);gray[i]=v;sum+=v;}const th=Math.max(105,Math.min(205,sum/gray.length-22));for(let p=0,i=0;p<im.data.length;p+=4,i++){const g=gray[i],v=binary?(g<th?0:255):Math.max(0,Math.min(255,Math.round((g-130)*1.55+155)));im.data[p]=im.data[p+1]=im.data[p+2]=v;}x.putImageData(im,0,0);return c; }
async function recognize(worker:any,c:HTMLCanvasElement,psm:any,wl=""){ await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:String(psm),user_defined_dpi:"300",tessedit_char_whitelist:wl}); return norm((await worker.recognize(c)).data.text||""); }
async function cell(worker:any,src:HTMLCanvasElement,paper:Box,psm:any,b:[number,number,number,number],parser:(s:string)=>string,wl=""){ const a=await recognize(worker,crop(src,rel(paper,...b)),psm,wl),v=parser(a); if(v)return{raw:a,value:v}; const [xx,yy,ww,hh]=b,pad=.008,bb:[number,number,number,number]=[Math.max(0,xx-pad),Math.max(0,yy-pad),Math.min(1-xx+pad,ww+pad*2),Math.min(1-yy+pad,hh+pad*2)]; const z=await recognize(worker,crop(src,rel(paper,...bb),2000,true),psm,wl); return{raw:[a,z].filter(Boolean).join(" / "),value:parser(`${a}\n${z}`)}; }

export default function Page(){
  const cam=useRef<HTMLInputElement>(null),lib=useRef<HTMLInputElement>(null);
  const [vehicles,setVehicles]=useState<Vehicle[]>([]),[vehicle,setVehicle]=useState<Vehicle>({...EMPTY,certificate:emptyCert()}),[search,setSearch]=useState("");
  const [message,setMessage]=useState("車検証を読み取るか、作業車両を選んでください。"),[busy,setBusy]=useState(true),[docBusy,setDocBusy]=useState(false),[progress,setProgress]=useState(0),[preview,setPreview]=useState(""),[debug,setDebug]=useState("");

  useEffect(()=>{(async()=>{try{const {data:{session}}=await supabase.auth.getSession();if(!session){setMessage("ログイン後に車両一覧を読み込みます。");return;}const {data,error}=await supabase.from("vehicles").select("*").order("created_at",{ascending:false});if(error)throw error;const list=(data||[]).map((v:any):Vehicle=>({id:v.id,number:v.vehicle_number||"",registration:v.registration_number||"",last4:v.registration_number_last4||"",chassis:v.chassis_number||"",model:v.model||"",type:(v.fuel_type||"その他") as FuelType,weight:v.vehicle_weight==null?"":String(v.vehicle_weight),firstRegistration:jpMonth(v.first_registration||"")||v.first_registration||"",customerId:v.customer_id||"",certificate:{...emptyCert(),...(v.certificate_fields||{})}}));setVehicles(list);const saved=localStorage.getItem(ACTIVE_KEY);if(saved){const a=JSON.parse(saved),f=list.find(x=>x.id===a.id||x.number===a.number);if(f)setVehicle(f);}}catch(e:any){setMessage(`車両一覧エラー: ${e?.message||e}`);}finally{setBusy(false);}})();},[]);

  useEffect(()=>{
    const apply=(event:Event)=>{
      const raw=((event as CustomEvent<AuthoritativePatch>).detail||{}) as AuthoritativePatch;
      if(!raw||typeof raw!=="object")return;
      const patch:AuthoritativePatch={...raw};
      const first=patch.firstRegistration||"";
      const expiry=patch.inspectionExpiry||"";
      if(!patch.registrationDate&&first&&expiry){
        const candidates=((window as any)[DATE_CANDIDATES_KEY]||[]) as string[];
        const plausible=candidates.filter(x=>plausibleRegistrationDate(x,first,expiry));
        if(plausible.length)patch.registrationDate=mode(plausible);
      }
      setVehicle(prev=>mergeVehicle(prev,patch));
    };
    window.addEventListener(AUTH_EVENT,apply as EventListener);
    return()=>window.removeEventListener(AUTH_EVENT,apply as EventListener);
  },[]);

  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return vehicles.slice(0,50);const d=digits(q);return vehicles.filter(v=>[v.number,v.registration,v.last4,v.chassis,v.model].join(" ").toLowerCase().includes(q)||(d.length>=2&&v.last4.includes(d.slice(-4)))).slice(0,60);},[vehicles,search]);
  function select(v:Vehicle){setVehicle(v);localStorage.setItem(ACTIVE_KEY,JSON.stringify(v));setMessage(`${display(v)} を作業車両に選択しました。`);}
  function update(k:string,val:string){
    setVehicle(prev=>{
      if(k==="registrationDate"&&val&&prev.certificate.firstRegistration&&prev.certificate.inspectionExpiry&&!plausibleRegistrationDate(val,prev.certificate.firstRegistration,prev.certificate.inspectionExpiry))return prev;
      const certificate={...prev.certificate,[k]:val};
      const next={...prev,certificate};
      if(k==="registrationNumber"){next.registration=val;next.last4=val.match(/(\d{4})(?!.*\d)/)?.[1]||"";next.number=next.chassis||val||next.number;}
      if(k==="chassisNumber"){next.chassis=val;next.number=val||next.registration||next.number;}
      if(k==="model")next.model=val;
      if(k==="vehicleWeightKg")next.weight=val;
      if(k==="firstRegistration")next.firstRegistration=val;
      if(k==="fuel")next.type=fuelType(val);
      return next;
    });
  }

  async function read(file:File){
    if(!file.type.startsWith("image/")){setMessage("写真・画像を選んでください。");return;}
    setDocBusy(true);setProgress(1);setDebug("");setMessage("車検証の各欄を読み取り中です…");if(preview)URL.revokeObjectURL(preview);setPreview(URL.createObjectURL(file));let worker:any=null;
    try{
      const src=await loadCanvas(file),paper=detectPaper(src),t:any=await import("tesseract.js");worker=await t.createWorker("jpn+eng",1);const P=t.PSM,single=P?.SINGLE_LINE??"7",block=P?.SINGLE_BLOCK??"6",c=emptyCert(),log:string[]=[`紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];let n=0;
      const rd=async(k:string,b:[number,number,number,number],p:(s:string)=>string,wl="",psm=single)=>{const r=await cell(worker,src,paper,psm,b,p,wl);c[k]=r.value;log.push(`【${FIELDS.find(x=>x[0]===k)?.[1]||k} 生OCR】 ${r.raw||"(空)"}`,`【${FIELDS.find(x=>x[0]===k)?.[1]||k} 採用】 ${r.value||"未読"}`);setProgress(Math.min(94,Math.round(++n/32*94)));};

      await rd("recordDate",[.65,.090,.25,.030],jpDate); await rd("documentNumber",[.70,.137,.18,.027],docNo,"0123456789");
      await rd("registrationNumber",[.22,.185,.36,.030],reg); await rd("chassisNumber",[.13,.216,.36,.030],chassis,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");
      await rd("registrationDate",[.18,.247,.21,.030],jpDate); await rd("firstRegistration",[.40,.247,.17,.030],jpMonth); await rd("inspectionExpiry",[.62,.247,.25,.030],jpDate);
      await rd("userName",[.19,.300,.43,.030],freeJp,"",block); await rd("userAddress",[.19,.338,.61,.031],freeJp,"",block); await rd("baseLocation",[.19,.376,.35,.030],s=>/[＊*]{2,}/.test(s)?"***":freeJp(s),"",block);
      await rd("vehicleName",[.10,.417,.20,.028],maker); const mr=await cell(worker,src,paper,single,[.10,.445,.30,.030],model,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");c.model=mr.value;log.push(`【型式 生OCR】 ${mr.raw||"(空)"}`,`【型式 採用】 ${mr.value||"未読"}`);setProgress(Math.min(94,Math.round(++n/32*94)));
      await rd("engineModel",[.48,.445,.16,.030],engine,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"); await rd("vehicleClass",[.15,.475,.15,.028],vehicleClass); await rd("purpose",[.34,.475,.14,.028],purpose); await rd("privateBusiness",[.58,.475,.18,.028],privateBiz);
      await rd("bodyShape",[.15,.501,.16,.028],body); await rd("seatingCapacity",[.56,.501,.09,.028],s=>integer(s,1,99),"0123456789人"); await rd("maxPayloadKg",[.73,.501,.15,.028],s=>intDash(s,1,99999),"0123456789-kgKG");
      await rd("vehicleWeightKg",[.15,.526,.13,.028],s=>integer(s,100,99999),"0123456789kgKG"); await rd("grossVehicleWeightKg",[.37,.526,.14,.028],s=>integer(s,100,99999),"0123456789kgKG"); await rd("lengthCm",[.49,.526,.10,.028],s=>integer(s,50,3000),"0123456789cmCM"); await rd("widthCm",[.62,.526,.10,.028],s=>integer(s,50,1000),"0123456789cmCM"); await rd("heightCm",[.75,.526,.10,.028],s=>integer(s,50,1000),"0123456789cmCM");
      await rd("frontFrontAxleWeightKg",[.15,.553,.13,.027],s=>intDash(s,1,30000),"0123456789-kgKG"); await rd("frontRearAxleWeightKg",[.30,.553,.11,.027],s=>intDash(s,1,30000),"0123456789-kgKG"); await rd("rearFrontAxleWeightKg",[.43,.553,.11,.027],s=>intDash(s,1,30000),"0123456789-kgKG"); await rd("rearRearAxleWeightKg",[.56,.553,.12,.027],s=>intDash(s,1,30000),"0123456789-kgKG");
      await rd("displacementOrRatedOutput",[.69,.553,.18,.027],output,"0123456789.LlkWKWkw"); await rd("fuel",[.15,.580,.15,.027],fuelText); await rd("modelDesignationNumber",[.48,.580,.15,.027],s=>intDash(s,1,999999),"0123456789-"); await rd("classificationNumber",[.67,.580,.15,.027],s=>intDash(s,1,999999),"0123456789-");

      const dateCandidates:string[]=[];
      for(const b of [[.170,.215,.250,.040],[.185,.220,.220,.032],[.155,.212,.280,.046]] as [number,number,number,number][]){
        const r=await cell(worker,src,paper,single,b,jpDate,"0123456789年月日令和平成昭和 ");
        if(r.value)dateCandidates.push(r.value);
        log.push(`【登録年月日 狭域OCR】 ${r.raw||"(空)"} => ${r.value||"未読"}`);
      }
      (window as any)[DATE_CANDIDATES_KEY]=dateCandidates;

      const bodyCandidates:string[]=[];
      for(const b of [[.070,.430,.280,.055],[.090,.438,.240,.042],[.110,.445,.200,.033]] as [number,number,number,number][]){
        const r=await cell(worker,src,paper,single,b,body);
        if(r.value)bodyCandidates.push(r.value);
        log.push(`【車体形状 狭域OCR】 ${r.raw||"(空)"} => ${r.value||"未読"}`);
      }
      if(bodyCandidates.length)c.bodyShape=mode(bodyCandidates);

      const global=await recognize(worker,crop(src,{x:0,y:0,w:src.width,h:src.height},3000,false),P?.SPARSE_TEXT??"11");log.push("","【車検証 全体OCR】",global);
      c.documentNumber ||= docNo(context(global,["記録事項"],120)); c.registrationNumber ||= reg(context(global,["自動車登録番号又は車両番号"],220)); c.chassisNumber ||= chassis(context(global,["車台番号"],140))||chassis(global);
      c.registrationDate ||= jpDate(context(global,["登録年月日","交付年月日"],160)); c.firstRegistration ||= jpMonth(context(global,["初度登録年月","初度登録"],130)); c.inspectionExpiry ||= jpDate(context(global,["有効期間の満了する日"],160));
      const un=afterLabel(global,["使用者の氏名又は名称"]),ua=afterLabel(global,["使用者の住所"]),bl=afterLabel(global,["使用の本拠の位置"]); if(/[一-龠ぁ-んァ-ヶ]/.test(un))c.userName=freeJp(un)||c.userName;if(/[一-龠ぁ-んァ-ヶ0-9]/.test(ua))c.userAddress=freeJp(ua)||c.userAddress;if(/[＊*]{2,}/.test(bl))c.baseLocation="***";
      c.vehicleName=maker(context(global,["車名"],120))||c.vehicleName;c.model=repairModel(c.model||model(context(global,["型式"],180))||model(global),c.chassisNumber);c.engineModel=engine(context(global,["原動機の型式"],100))||c.engineModel;c.vehicleClass=vehicleClass(context(global,["自動車の種別"],100))||c.vehicleClass;c.purpose=purpose(context(global,["用途"],90))||c.purpose;c.privateBusiness=privateBiz(context(global,["自家用・事業用の別","自家用・事業用"],110))||c.privateBusiness;c.bodyShape=body(context(global,["車体の形状"],100))||c.bodyShape;c.fuel=fuelText(context(global,["燃料の種類","燃料"],100))||c.fuel;
      if(!vehicleClass(c.vehicleClass))c.vehicleClass="";if(!purpose(c.purpose))c.purpose="";if(!privateBiz(c.privateBusiness))c.privateBusiness="";if(!body(c.bodyShape))c.bodyShape="";if(!fuelText(c.fuel))c.fuel="";

      // QRは別コンポーネントで並行解析されるため、メインOCRの最終stateを作る直前で
      // 初度登録・有効期限が確定するまで短時間待つ。外付けDOM補正ではなく、
      // ここでcへ直接取り込むことで最終setVehicle()自体を正しい値にする。
      let qr=((window as any).__vehicleCertificateQrPriority||{}) as AuthoritativePatch;
      for(let i=0;i<120&&(!qr.firstRegistration||!qr.inspectionExpiry);i++){
        await new Promise(resolve=>setTimeout(resolve,250));
        qr=((window as any).__vehicleCertificateQrPriority||{}) as AuthoritativePatch;
      }
      for(const [k,v] of Object.entries(qr))if(typeof v==="string"&&v)c[k]=v;
      log.push(`【QR最終確定】 初度=${c.firstRegistration||"未取得"} / 有効期限=${c.inspectionExpiry||"未取得"}`);

      const plausibleDates=dateCandidates.filter(x=>plausibleRegistrationDate(x,c.firstRegistration,c.inspectionExpiry));
      if(plausibleDates.length)c.registrationDate=mode(plausibleDates);
      else if(c.registrationDate&&!plausibleRegistrationDate(c.registrationDate,c.firstRegistration,c.inspectionExpiry))c.registrationDate="";

      const ft=fuelType(c.fuel||global),last4=c.registrationNumber.match(/(\d{4})(?!.*\d)/)?.[1]||"",ex:Vehicle={...EMPTY,number:c.chassisNumber||c.registrationNumber,registration:c.registrationNumber,last4,chassis:c.chassisNumber,model:c.model,type:ft,weight:c.vehicleWeightKg,firstRegistration:c.firstRegistration,certificate:c};const old=vehicles.find(v=>(c.chassisNumber&&v.chassis===c.chassisNumber)||(c.registrationNumber&&v.registration===c.registrationNumber));setVehicle(old?{...ex,id:old.id,customerId:old.customerId}:ex);setDebug(log.join("\n"));setProgress(100);setMessage(`備考欄より上の32項目中${FIELDS.filter(([k])=>Boolean(c[k])).length}項目を候補として読み取りました。怪しい値は空欄にしています。`);
    }catch(e:any){console.error(e);setMessage(`車検証OCRエラー: ${e?.message||"読み取りに失敗しました"}`);}finally{if(worker)await worker.terminate().catch(()=>{});setDocBusy(false);}
  }

  async function save(){if(!vehicle.number.trim()&&!vehicle.chassis.trim()){setMessage("車台番号または登録番号を確認してください。");return;}const c=vehicle.certificate,p:any={vehicle_number:vehicle.number.trim()||vehicle.chassis.trim()||vehicle.registration.trim(),registration_number:vehicle.registration.trim()||null,registration_number_last4:(vehicle.last4||vehicle.registration.match(/(\d{4})(?!.*\d)/)?.[1]||"").slice(-4)||null,chassis_number:vehicle.chassis.trim()||null,model:vehicle.model.trim()||null,fuel_type:vehicle.type,vehicle_weight:vehicle.weight?Number(vehicle.weight):null,curb_weight_kg:toInt(c.vehicleWeightKg),gross_vehicle_weight_kg:toInt(c.grossVehicleWeightKg),seating_capacity:toInt(c.seatingCapacity),engine_model:c.engineModel||null,usage_category:c.purpose||null,body_type:c.bodyShape||null,inspection_certificate_number:c.documentNumber||null,user_name_snapshot:c.userName||null,first_registration:jpMonth(vehicle.firstRegistration)||vehicle.firstRegistration||null,inspection_expiry_date:dateIso(c.inspectionExpiry),certificate_fields:c,front_front_axle_weight_kg:toInt(c.frontFrontAxleWeightKg),front_rear_axle_weight_kg:toInt(c.frontRearAxleWeightKg),rear_front_axle_weight_kg:toInt(c.rearFrontAxleWeightKg),rear_rear_axle_weight_kg:toInt(c.rearRearAxleWeightKg),customer_id:vehicle.customerId||null,updated_at:new Date().toISOString()};const q=vehicle.id?await supabase.from("vehicles").update(p).eq("id",vehicle.id).select().single():await supabase.from("vehicles").insert(p).select().single();if(q.error){setMessage(`車両保存エラー: ${q.error.message}`);return;}const v={...vehicle,id:q.data.id,number:p.vehicle_number,last4:p.registration_number_last4||"",firstRegistration:p.first_registration||""};setVehicle(v);setVehicles(old=>[v,...old.filter(x=>x.id!==v.id)]);localStorage.setItem(ACTIVE_KEY,JSON.stringify(v));setMessage("車検証情報を保存し、作業車両に設定しました。");}
  function startOCR(){if(!vehicle.number&&!vehicle.chassis&&!vehicle.registration){setMessage("先に車両を選択または保存してください。");return;}localStorage.setItem(ACTIVE_KEY,JSON.stringify(vehicle));try{const a=JSON.parse(localStorage.getItem("parts-data")||"[]");localStorage.setItem(BEFORE_KEY,JSON.stringify(Array.isArray(a)?a.map((x:any)=>x.id).filter(Boolean):[]));}catch{localStorage.setItem(BEFORE_KEY,"[]");}location.assign("/ocr/auto");}

  return <main className="page"><div className="top"><button onClick={()=>location.assign("/")}>← メインへ</button><strong>icb</strong></div>
    <section className="card"><h1>作業車両を選択</h1><p>車体番号・ナンバー下4桁・車台番号・型式で検索できます。</p><div className="notice">{busy?"車両一覧を読み込み中…":message}</div><input className="search" placeholder="車体番号 / 下4桁 / 車台番号 / 型式" value={search} onChange={e=>setSearch(e.target.value)}/><div className="list">{filtered.map(v=><button key={v.id||v.number} className={`row ${vehicle.id===v.id&&v.id?"active":""}`} onClick={()=>select(v)}><b>{v.registration||v.number}</b><span>{v.model||"型式未入力"}　下4桁 {v.last4||"----"}</span><small>{v.chassis||v.number}</small></button>)}</div></section>
    <section className="card"><h2>車検証から読み取る</h2><p>備考欄より上の32項目を、値欄の位置と全体OCRの両方で照合します。怪しい文字列は勝手に保存せず空欄にします。</p><input ref={cam} className="hidden" type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files?.[0];if(f)void read(f);e.currentTarget.value="";}}/><input ref={lib} className="hidden" type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void read(f);e.currentTarget.value="";}}/><div className="actions"><button className="primary" disabled={docBusy} onClick={()=>cam.current?.click()}>📷 今撮影して読み取る</button><button disabled={docBusy} onClick={()=>lib.current?.click()}>🖼 写真から読み取る</button></div>{docBusy&&<><div className="progress"><div style={{width:`${progress}%`}}/></div><p>読み取り中 {progress}%</p></>}{preview&&<img className="preview" src={preview} alt="車検証"/>}{debug&&<details><summary>OCR詳細（確認用）</summary><pre>{debug}</pre></details>}</section>
    <section className="card"><h2>基本情報</h2><div className="grid"><label>登録番号<input value={vehicle.registration} onChange={e=>update("registrationNumber",e.target.value)}/></label><label>ナンバー下4桁<input value={vehicle.last4} onChange={e=>setVehicle(prev=>({...prev,last4:digits(e.target.value).slice(-4)}))}/></label><label>車台番号<input value={vehicle.chassis} onChange={e=>update("chassisNumber",e.target.value)}/></label><label>型式<input value={vehicle.model} onChange={e=>update("model",e.target.value)}/></label><label>燃料<select value={vehicle.type} onChange={e=>setVehicle(prev=>({...prev,type:e.target.value as FuelType}))}><option>EV</option><option>ガソリン</option><option>HV</option><option>ディーゼル</option><option>その他</option></select></label><label>車両重量 kg<input value={vehicle.weight} onChange={e=>update("vehicleWeightKg",e.target.value)}/></label><label>初度登録（和暦）<input value={vehicle.firstRegistration} placeholder="令和2年4月" onChange={e=>update("firstRegistration",e.target.value)}/></label></div></section>
    <section className="card"><h2>車検証読み取り情報（備考欄より上）</h2><p>読み取り後にここで全部確認・修正できます。</p><div className="grid">{FIELDS.map(([k,l])=><label key={k}><span>{l}</span><input value={vehicle.certificate[k]||""} onChange={e=>update(k,e.target.value)}/></label>)}</div><div className="axles"><b>軸重</b><span>前前 {vehicle.certificate.frontFrontAxleWeightKg||"未読"} kg</span><span>前後 {vehicle.certificate.frontRearAxleWeightKg||"未読"} kg</span><span>後前 {vehicle.certificate.rearFrontAxleWeightKg||"未読"} kg</span><span>後後 {vehicle.certificate.rearRearAxleWeightKg||"未読"} kg</span></div><div className="actions"><button onClick={()=>setVehicle({...EMPTY,certificate:emptyCert()})}>＋新規車両</button><button onClick={save}>車両を保存</button></div><button className="primary wide" onClick={startOCR}>この車両で伝票OCRへ →</button></section>
    <style jsx global>{`*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:12px 15px;font-size:16px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{font-size:24px;margin:0 0 8px}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:14px;margin:14px 0}.search,input,select{width:100%;border:1px solid #cdd7e5;border-radius:11px;padding:12px;font-size:16px;background:#fff}.list{display:grid;gap:8px;margin-top:12px;max-height:360px;overflow:auto}.row{text-align:left;display:grid;gap:3px;color:#172033}.row span,.row small{color:#5d6878;font-weight:500}.row.active{border:2px solid #2f6fe4;background:#eef4ff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid label{display:grid;gap:6px;color:#5d6878;font-weight:700}.grid label span{font-size:14px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.actions>*{flex:1 1 220px}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.wide{width:100%;margin-top:12px;font-size:18px;padding:16px}.hidden{display:none}.preview{width:100%;max-height:560px;object-fit:contain;border-radius:14px;margin-top:14px;background:#f4f6fa}.progress{height:8px;background:#e4eaf3;border-radius:999px;overflow:hidden;margin-top:14px}.progress>div{height:100%;background:#2f6fe4}details{margin-top:14px;border:1px solid #d9e0ea;border-radius:12px;padding:12px}summary{font-weight:800}pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px}.axles{margin-top:16px;background:#eef4ff;border:1px solid #c8d8fb;border-radius:14px;padding:14px;display:flex;gap:12px;flex-wrap:wrap}.axles b{width:100%}.axles span{font-weight:700;color:#315fba}@media(max-width:650px){.grid{grid-template-columns:1fr}.card{padding:18px}.page{padding-left:10px;padding-right:10px}}`}</style>
  </main>;
}
