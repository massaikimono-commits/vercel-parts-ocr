/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { safeActionError } from "../lib/client-security";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { parseRegistrationNumber } from "../lib/registration-number";
import { expectedCertificateQrCount, normalizeCertificateCanvas } from "../lib/certificate-photo-normalize";

type FuelType = "EV" | "ガソリン" | "HV" | "ディーゼル" | "その他";
type Cert = Record<string, string>;
type Box = { x:number; y:number; w:number; h:number };
type Vehicle = {
  id?: string; number:string; registration:string; last4:string; chassis:string; model:string;
  type:FuelType; weight:string; firstRegistration:string; customerId:string; certificate:Cert;
};
type Patch = Partial<Cert> & { registrationNumber?:string; chassisNumber?:string; model?:string; vehicleWeightKg?:string; firstRegistration?:string; fuel?:string };

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

const emptyCert=()=>Object.fromEntries(FIELDS.map(([k])=>[k,""])) as Cert;
const EMPTY:Vehicle={number:"",registration:"",last4:"",chassis:"",model:"",type:"その他",weight:"",firstRegistration:"",customerId:"",certificate:emptyCert()};
const AUTH_EVENT="vehicle-certificate-authoritative";
const ACTIVE_KEY="parts-active-vehicle";
const BEFORE_KEY="parts-before-ocr-ids";

function norm(s:string){return String(s||"").normalize("NFKC").replace(/[‐‑‒–—―]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();}
function compact(s:string){return norm(s).replace(/\s+/g,"");}
function digits(s:string){return String(s||"").replace(/\D/g,"");}
function eraYear(e:string,y:string){const n=y==="元"?1:Number(y);return e==="令和"?2018+n:e==="平成"?1988+n:e==="昭和"?1925+n:0;}
function jpDate(s:string){const m=norm(s).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);if(!m)return"";const mo=Number(m[3]),d=Number(m[4]);return mo>=1&&mo<=12&&d>=1&&d<=31?`${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mo}月${d}日`:"";}
function jpMonth(s:string){const m=norm(s).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);if(!m)return"";const mo=Number(m[3]);return mo>=1&&mo<=12?`${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mo}月`:"";}
function dateIso(s:string){const m=compact(s).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);if(!m)return null;const y=eraYear(m[1],m[2]);return y?`${y}-${String(Number(m[3])).padStart(2,"0")}-${String(Number(m[4])).padStart(2,"0")}`:null;}
function fuelType(s:string):FuelType{const t=norm(s);if(/軽油|ディーゼル/.test(t))return"ディーゼル";if(/ハイブリッド|\bHV\b|ガソリン・電気/.test(t))return"HV";if(/電気自動車|\bEV\b|^電気$/.test(t))return"EV";if(/ガソリン|揮発油/.test(t))return"ガソリン";return"その他";}
function toInt(s:string){const n=Number(s);return s&&s!=="-"&&Number.isFinite(n)?n:null;}
function serialFromRegistration(v:string){const p=parseRegistrationNumber(v);if(p)return p.serial;const m=norm(v).match(/([0-9]{1,4})(?!.*[0-9])/);return m?.[1]||"";}
function display(v:Vehicle){return v.registration||v.chassis||v.number||"車両";}
function pick(s:string,values:string[]){const t=compact(s);return values.find(v=>t.includes(compact(v)))||"";}
const maker=(s:string)=>pick(s,["日野","トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","BMW","アウディ","ボルボ"]);
const vehicleClass=(s:string)=>pick(s,["普通","小型","軽自動車","大型特殊"]);
const purpose=(s:string)=>pick(s,["貨物","乗用","乗合","特種"]);
const privateBiz=(s:string)=>pick(s,["自家用","事業用"]);
const body=(s:string)=>pick(s,["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","バン","バス","幌型"]);
const fuelText=(s:string)=>pick(s,["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]);

function lines(text:string){return norm(text).split("\n").map(x=>x.trim()).filter(Boolean);}
function valueNear(text:string,labels:string[],parser:(s:string)=>string,span=3){const a=lines(text);for(let i=0;i<a.length;i++){const c=compact(a[i]);const label=labels.find(l=>c.includes(compact(l)));if(!label)continue;const same=a[i].replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").split("").join("\\s*")),"");const v=parser(same);if(v)return v;for(let j=i+1;j<Math.min(a.length,i+1+span);j++){const q=parser(a[j]);if(q)return q;}}return"";}
function freeJp(s:string){const t=norm(s).replace(/\[[0-9\s_-]+\]/g,"").replace(/^[\s|:：,，.。・/\\-]+|[\s|:：,，.。・/\\-]+$/g,"").trim();if(!t||t.length>100)return"";return /[一-龠ぁ-んァ-ヶA-Za-z0-9]/.test(t)?t:"";}
function docNo(s:string){return (digits(s).match(/\d{10,14}/)||[])[0]||"";}
function output(s:string){return norm(s).match(/\d+(?:\.\d+)?\s*(?:L|l|kW|KW|kw)/)?.[0]?.replace(/\s+/g,"")||norm(s).match(/\b\d+\.\d+\b/)?.[0]||"";}
function modelCandidate(s:string,chassis=""){const cf=(chassis.split("-")[0]||"").toUpperCase(),a=lines(s),out:{value:string;score:number}[]=[];for(let i=0;i<a.length;i++){const raw=a[i].toUpperCase().replace(/[‐‑‒–—―ー]/g,"-");for(const m of raw.matchAll(/(?:^|[\s|])((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})\s*-\s*[A-Z0-9]{3,12})(?=$|[\s|])/g)){const value=m[1].replace(/\s+/g,"");if(/^([A-Z0-9]{3,8})-\d{4,12}$/.test(value))continue;const suffix=(value.split("-")[1]||"").replace(/[^A-Z0-9]/g,"");let score=1;if(cf&&suffix&&(suffix.startsWith(cf)||cf.startsWith(suffix)))score+=18;const around=`${a[i-1]||""} ${a[i]} ${a[i+1]||""}`;if(/型式/.test(around))score+=8;if(/^(?:DAA|DBA|ABA|CBA|DLA|ZAA|EBD|HBD|LDA|TDA|TKG|TPG|TRG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|6BA|7BA|8BA|GF|GH|TA|UA|LA)-/.test(value))score+=5;out.push({value,score});}}return out.sort((x,y)=>y.score-x.score||x.value.length-y.value.length)[0]?.value||"";}
function modelFamily(model:string){const t=compact(model).toUpperCase();return (t.split("-").pop()||t).replace(/[^A-Z0-9]/g,"");}
function chassisCandidate(text:string,model=""){const fam=modelFamily(model),a=lines(text),out:{value:string;score:number}[]=[];for(let i=0;i<a.length;i++){const u=a[i].toUpperCase().replace(/[‐‑‒–—―ー]/g,"-");for(const raw of u.match(/[A-Z0-9]{3,9}\s*-\s*[A-Z0-9]{4,12}/g)||[]){const [l0,r0]=raw.replace(/\s+/g,"").split("-");const l=l0.replace(/O(?=\d)|(?<=\d)O/g,"0"),r=r0.replace(/O/g,"0");if(!l||r.length<4||r.length>10)continue;if(/^(DAA|DBA|ABA|CBA|EBD|HBD|LDA|TDA|TKG|TPG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|7BA|8BA)$/.test(l))continue;let score=2;if(/^\d+$/.test(r))score+=4;if(fam&&(fam===l||fam.startsWith(l)||l.startsWith(fam)))score+=8;const around=`${a[i-1]||""} ${a[i]} ${a[i+1]||""}`;if(/車台番号/.test(around))score+=8;out.push({value:`${l}-${r}`,score});}}return out.sort((x,y)=>y.score-x.score)[0]?.value||"";}
function engineCandidate(text:string,model="",chassis=""){const fam=modelFamily(model),cf=(chassis.split("-")[0]||"").toUpperCase(),a=lines(text),out:{value:string;score:number}[]=[];for(let i=0;i<a.length;i++){const raw=a[i].toUpperCase().replace(/[‐‑‒–—―ー]/g,"-");const vals:string[]=[];for(const m of raw.matchAll(/(?:^|[\s|])([A-Z0-9]{2,6}\s*-\s*[A-Z0-9]{1,6})(?=$|[\s|])/g))vals.push(m[1].replace(/\s+/g,""));for(const m of raw.matchAll(/(?:^|[\s|])([A-Z0-9]{3,6})(?=$|[\s|])/g))vals.push(m[1].replace(/\s+/g,""));for(const v0 of vals){const v=v0.replace(/O(?=\d)|(?<=\d)O/g,"0");if(!/[A-Z]/.test(v)||!/\d/.test(v))continue;if(fam&&v.includes(fam))continue;if(cf&&v.includes(cf))continue;if(/^(DAA|DBA|ABA|CBA|5AA|6AA|7BA|8BA)-/.test(v))continue;if(!/^[A-Z0-9]{2,6}(?:-[A-Z0-9]{1,6})?$/.test(v))continue;let score=1;const around=`${a[i-1]||""} ${a[i]} ${a[i+1]||""}`;if(/原動機|エンジン/.test(around))score+=10;if(v.includes("-"))score+=2;if(v.length>=3&&v.length<=10)score+=3;if(/[0-9][A-Z]|[A-Z][0-9]/.test(v))score+=1;out.push({value:v,score});}}return out.sort((x,y)=>y.score-x.score||x.value.length-y.value.length)[0]?.value||"";}

function allDates(text:string){const out:string[]=[];const re=/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/g;for(const m of norm(text).matchAll(re)){const mo=Number(m[3]),d=Number(m[4]);if(mo>=1&&mo<=12&&d>=1&&d<=31)out.push(`${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mo}月${d}日`);}return out;}
function dateOrdinal(s:string){const m=compact(s).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);if(!m)return 0;return eraYear(m[1],m[2])*10000+Number(m[3])*100+Number(m[4]);}
function monthOrdinal(s:string){const m=compact(s).match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月/);if(!m)return 0;return eraYear(m[1],m[2])*12+Number(m[3]);}
function chooseRegistrationDate(text:string,first:string,expiry:string){const direct=valueNear(text,["登録年月日/交付年月日","登録年月日／交付年月日","登録年月日","交付年月日"],jpDate,2);if(direct)return direct;const f=monthOrdinal(first),e=dateOrdinal(expiry);const c=allDates(text).filter(v=>{const r=dateOrdinal(v),y=Math.floor(r/10000),m=Math.floor((r%10000)/100);return r&&(!f||y*12+m>=f)&&(!e||r<=e)&&compact(v)!==compact(expiry);});return c[0]||"";}

function boundedInt(v:string,min:number,max:number){const n=Number(String(v||"").replace(/\D/g,""));return Number.isFinite(n)&&n>=min&&n<=max?String(n):"";}
function firstBoundedNumber(s:string,min:number,max:number){for(const raw of norm(s).match(/\d{1,5}/g)||[]){const n=Number(raw);if(Number.isFinite(n)&&n>=min&&n<=max)return String(n);}return"";}
function axleValue(s:string){return firstBoundedNumber(s,1,30000);}
function seatValue(s:string){return firstBoundedNumber(s,1,99);}
function payloadValue(s:string){const t=norm(s);if(/(?:^|\s)[-―ー]\s*(?:kg)?(?:\s|$)/i.test(t))return"-";return firstBoundedNumber(t,1,30000);}
function numericTuple(text:string,qr:Patch){
  const t=norm(text).replace(/,/g,"");
  const kei=/軽自動車/.test(String(qr.vehicleClass||""));
  const valid=(w:number,g:number,l:number,wi:number,h:number)=>w>=300&&w<=30000&&g>=w&&g<=50000&&g<=w*4.2&&l>=100&&l<=2000&&wi>=100&&wi<=300&&h>=100&&h<=450&&l>=wi&&(!kei||(w<=2200&&g<=3000&&l<=340&&wi<=148&&h<=220));
  const axle=[Number(qr.frontFrontAxleWeightKg||0),Number(qr.frontRearAxleWeightKg||0),Number(qr.rearFrontAxleWeightKg||0),Number(qr.rearRearAxleWeightKg||0)].filter(x=>x>0).reduce((a,b)=>a+b,0);
  const cm=[...t.matchAll(/(\d{2,4})\s*c\s*m/gi)];
  if(cm.length>=3){
    for(let ci=0;ci+2<cm.length;ci++){
      const l=Number(cm[ci][1]),wi=Number(cm[ci+1][1]),h=Number(cm[ci+2][1]);
      if(l<100||l>2000||wi<100||wi>300||h<100||h>450||l<wi)continue;
      const before=t.slice(0,cm[ci].index||t.length);
      const nums=(before.match(/\d{3,5}/g)||[]).map(Number);
      for(let i=Math.max(0,nums.length-5);i+1<nums.length;i++){
        const w=nums[i],g=nums[i+1];
        if(!valid(w,g,l,wi,h))continue;
        if(axle&&Math.abs(w-axle)>Math.max(100,axle*.12))continue;
        return{score:axle&&Math.abs(w-axle)<=20?16:8,vehicleWeightKg:String(w),grossVehicleWeightKg:String(g),lengthCm:String(l),widthCm:String(wi),heightCm:String(h)};
      }
    }
  }
  const all=(t.match(/\d{2,5}/g)||[]).map(Number);
  let best:any=null;
  for(let i=0;i+4<all.length;i++){
    const [w,g,l,wi,h]=all.slice(i,i+5);
    if(!valid(w,g,l,wi,h))continue;
    let score=2;
    if(axle&&Math.abs(w-axle)<=20)score+=12;else if(axle&&Math.abs(w-axle)<=80)score+=5;
    if(kei&&l<=340&&wi<=148)score+=5;
    if(!best||score>best.score)best={score,vehicleWeightKg:String(w),grossVehicleWeightKg:String(g),lengthCm:String(l),widthCm:String(wi),heightCm:String(h)};
  }
  return best||{};
}
function safePhotoPatch(patch:Patch){
  const p:any={...patch};
  const drop=(k:string)=>{delete p[k];};
  for(const k of ["recordDate","registrationDate","inspectionExpiry"])if(p[k]&&!jpDate(String(p[k])))drop(k);
  if(p.firstRegistration&&!jpMonth(String(p.firstRegistration)))drop("firstRegistration");
  if(p.documentNumber&&!/^\d{13}$/.test(digits(String(p.documentNumber))))drop("documentNumber");
  if(p.registrationNumber){const r=parseRegistrationNumber(String(p.registrationNumber));if(r)p.registrationNumber=r.canonical;else drop("registrationNumber");}
  if(p.chassisNumber&&!/^[A-Z0-9]{2,10}-[A-Z0-9]{4,12}$/i.test(compact(String(p.chassisNumber))))drop("chassisNumber");
  if(p.model&&!/^(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14}$/i.test(compact(String(p.model))))drop("model");
  if(p.model&&p.chassisNumber){const cf=(compact(String(p.chassisNumber)).split("-")[0]||"").toUpperCase(),mf=modelFamily(String(p.model));if(cf.length>=3&&mf.length>=3&&!(mf.startsWith(cf)||cf.startsWith(mf)))drop("model");}
  if(p.engineModel&&!/^[A-Z0-9]{2,6}(?:-[A-Z0-9]{1,6})?$/i.test(compact(String(p.engineModel))))drop("engineModel");
  if(p.vehicleName&&!["日野","トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","BMW","アウディ","ボルボ"].includes(String(p.vehicleName)))drop("vehicleName");
  if(p.vehicleClass&&!["普通","小型","軽自動車","大型特殊"].includes(String(p.vehicleClass)))drop("vehicleClass");
  if(p.purpose&&!["貨物","乗用","乗合","特種"].includes(String(p.purpose)))drop("purpose");
  if(p.privateBusiness&&!["自家用","事業用"].includes(String(p.privateBusiness)))drop("privateBusiness");
  if(p.bodyShape&&!["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","バン","バス","幌型"].includes(String(p.bodyShape)))drop("bodyShape");
  if(p.seatingCapacity&&!boundedInt(String(p.seatingCapacity),1,99))drop("seatingCapacity");
  if(p.maxPayloadKg&&p.maxPayloadKg!=="-"&&!boundedInt(String(p.maxPayloadKg),1,30000))drop("maxPayloadKg");
  const ranges:Record<string,[number,number]>={vehicleWeightKg:[300,30000],grossVehicleWeightKg:[300,50000],lengthCm:[100,2000],widthCm:[100,300],heightCm:[100,450],frontFrontAxleWeightKg:[1,30000],frontRearAxleWeightKg:[1,30000],rearFrontAxleWeightKg:[1,30000],rearRearAxleWeightKg:[1,30000]};
  for(const [k,[min,max]] of Object.entries(ranges)){if(p[k]&&p[k]!=="-"&&!boundedInt(String(p[k]),Number(min),Number(max)))drop(k);}
  const w=Number(p.vehicleWeightKg||0),g=Number(p.grossVehicleWeightKg||0);
  if(w&&g&&(g<w||g>w*4.2))drop("grossVehicleWeightKg");
  const l=Number(p.lengthCm||0),wi=Number(p.widthCm||0),h=Number(p.heightCm||0);
  if(l&&wi&&l<wi)drop("lengthCm");
  if(String(p.vehicleClass||"")==="軽自動車"){if(l>340)drop("lengthCm");if(wi>148)drop("widthCm");if(h>220)drop("heightCm");}
  if(p.fuel&&!["軽油","ガソリン","揮発油","電気","LPG","CNG","水素","ガソリン・電気"].includes(String(p.fuel)))drop("fuel");
  if(p.modelDesignationNumber&&!/^\d{4,6}$/.test(String(p.modelDesignationNumber)))drop("modelDesignationNumber");
  if(p.classificationNumber&&!/^\d{4}$/.test(String(p.classificationNumber)))drop("classificationNumber");
  if(p.userName&&(/^\d/.test(String(p.userName).trim())||String(p.userName).length>100))drop("userName");
  if(p.userAddress&&(String(p.userAddress).length>120||!/[都道府県市区町村丁目番0-9]/.test(String(p.userAddress))))drop("userAddress");
  if(p.baseLocation&&String(p.baseLocation)!=="***"&&!/同じ/.test(String(p.baseLocation))&&(String(p.baseLocation).length>120||!/[都道府県市区町村丁目番0-9]/.test(String(p.baseLocation))))drop("baseLocation");
  return p as Patch;
}

async function loadCanvas(file:File){const url=URL.createObjectURL(file);try{const img=await new Promise<HTMLImageElement>((res,rej)=>{const x=new Image();x.onload=()=>res(x);x.onerror=()=>rej(new Error("画像を開けませんでした"));x.src=url;});const scale=Math.min(1,3400/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement("canvas");c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);const ctx=c.getContext("2d",{willReadFrequently:true})!;ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c;}finally{URL.revokeObjectURL(url);}}
function detectPaper(c:HTMLCanvasElement):Box{const ctx=c.getContext("2d",{willReadFrequently:true});if(!ctx)return{x:0,y:0,w:c.width,h:c.height};const w=c.width,h=c.height,d=ctx.getImageData(0,0,w,h).data,step=Math.max(4,Math.floor(Math.max(w,h)/650));const ok=(x:number,y:number)=>{const p=(y*w+x)*4,r=d[p],g=d[p+1],b=d[p+2],br=(r+g+b)/3;return br>112&&Math.max(r,g,b)-Math.min(r,g,b)<100;};const ys:number[]=[];for(let y=0;y<h;y+=step){let hit=0,n=0;for(let x=0;x<w;x+=step){if(ok(x,y))hit++;n++;}if(hit/Math.max(1,n)>.22)ys.push(y);}if(ys.length<10)return{x:0,y:0,w,h};const top=Math.max(0,ys[0]-step*2),bottom=Math.min(h-1,ys[ys.length-1]+step*2);const xs:number[]=[];for(let x=0;x<w;x+=step){let hit=0,n=0;for(let y=top;y<=bottom;y+=step){if(ok(x,y))hit++;n++;}if(hit/Math.max(1,n)>.22)xs.push(x);}if(xs.length<10)return{x:0,y:top,w,h:bottom-top+1};const left=Math.max(0,xs[0]-step*2),right=Math.min(w-1,xs[xs.length-1]+step*2);return{x:left,y:top,w:right-left+1,h:bottom-top+1};}
function rel(p:Box,x:number,y:number,w:number,h:number):Box{return{x:Math.round(p.x+p.w*x),y:Math.round(p.y+p.h*y),w:Math.round(p.w*w),h:Math.round(p.h*h)};}
function crop(source:HTMLCanvasElement,b:Box,target=2300,binary=false){const sc=Math.max(1,Math.min(5,target/Math.max(1,b.w))),c=document.createElement("canvas");c.width=Math.max(1,Math.round(b.w*sc));c.height=Math.max(1,Math.round(b.h*sc));const x=c.getContext("2d",{willReadFrequently:true})!;x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";x.drawImage(source,b.x,b.y,b.w,b.h,0,0,c.width,c.height);const im=x.getImageData(0,0,c.width,c.height);let sum=0;for(let p=0;p<im.data.length;p+=4){const g=Math.round(im.data[p]*.22+im.data[p+1]*.70+im.data[p+2]*.08);sum+=g;im.data[p]=im.data[p+1]=im.data[p+2]=g;}const th=Math.max(100,Math.min(210,sum/(im.data.length/4)-18));for(let p=0;p<im.data.length;p+=4){const g=im.data[p],v=binary?(g<th?0:255):Math.max(0,Math.min(255,Math.round((g-128)*1.5+152)));im.data[p]=im.data[p+1]=im.data[p+2]=v;}x.putImageData(im,0,0);return c;}
async function recognize(worker:any,c:HTMLCanvasElement,psm:any,wl=""){await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:String(psm),user_defined_dpi:"300",tessedit_char_whitelist:wl});return norm((await worker.recognize(c)).data.text||"");}
function readQr(){const q=(window as any).__vehicleCertificateQrPriority;return q&&typeof q==="object"?{...q}:{} as Patch;}
async function wait(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

export default function VehicleWorkflowFast(){
  const cam=useRef<HTMLInputElement>(null),lib=useRef<HTMLInputElement>(null),fileKind=useRef<"image"|"pdf"|"">("");
  const [vehicles,setVehicles]=useState<Vehicle[]>([]),[vehicle,setVehicle]=useState<Vehicle>({...EMPTY,certificate:emptyCert()}),[search,setSearch]=useState("");
  const [message,setMessage]=useState("車検証を読み取るか、作業車両を選んでください。"),[busy,setBusy]=useState(true),[docBusy,setDocBusy]=useState(false),[progress,setProgress]=useState(0),[preview,setPreview]=useState(""),[debug,setDebug]=useState("");

  function mergePatch(patch:Patch){setVehicle(prev=>{const certificate={...prev.certificate};for(const [k,v] of Object.entries(patch))if(typeof v==="string"&&v.trim())certificate[k]=v.trim();const registration=certificate.registrationNumber||prev.registration,chassis=certificate.chassisNumber||prev.chassis,last4=serialFromRegistration(registration)||prev.last4;return{...prev,certificate,registration,chassis,last4,number:chassis||registration||prev.number,model:certificate.model||prev.model,weight:certificate.vehicleWeightKg||prev.weight,firstRegistration:certificate.firstRegistration||prev.firstRegistration,type:certificate.fuel?fuelType(certificate.fuel):prev.type};});}

  useEffect(()=>{(async()=>{try{const {data:{session}}=await supabase.auth.getSession();if(!session){setMessage("ログイン後に車両一覧を読み込みます。");return;}const {data,error}=await supabase.from("vehicles").select("*").order("created_at",{ascending:false});if(error)throw error;const list=(data||[]).map((v:any):Vehicle=>({id:v.id,number:v.vehicle_number||"",registration:v.registration_number||"",last4:v.registration_number_last4||"",chassis:v.chassis_number||"",model:v.model||"",type:(v.fuel_type||"その他") as FuelType,weight:v.vehicle_weight==null?"":String(v.vehicle_weight),firstRegistration:v.first_registration||"",customerId:v.customer_id||"",certificate:{...emptyCert(),...(v.certificate_fields||{})}}));setVehicles(list);}catch(e:any){setMessage(`車両一覧エラー: ${e?.message||e}`);}finally{setBusy(false);}})();},[]);

  useEffect(()=>{const apply=(event:Event)=>{const patch=((event as CustomEvent<Patch>).detail||{}) as Patch;if(!patch||typeof patch!=="object")return;mergePatch(patch);if(fileKind.current==="pdf"&&Object.keys(patch).length>=6){setProgress(100);setDocBusy(false);setMessage("PDFネイティブ読み取り完了。内容を確認してください。");}};window.addEventListener(AUTH_EVENT,apply as EventListener);return()=>window.removeEventListener(AUTH_EVENT,apply as EventListener);},[]);

  const cert=vehicle.certificate;
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return vehicles.slice(0,50);const d=digits(q);return vehicles.filter(v=>[v.number,v.registration,v.last4,v.chassis,v.model].join(" ").toLowerCase().includes(q)||(d.length&&v.last4.includes(d.slice(-4)))).slice(0,60);},[vehicles,search]);
  function select(v:Vehicle){setVehicle(v);localStorage.setItem(ACTIVE_KEY,JSON.stringify(v));setMessage(`${display(v)} を作業車両に選択しました。`);}
  function update(k:string,val:string){mergePatch({[k]:val});}

  async function readPhoto(file:File){
    fileKind.current="image";setDocBusy(true);setProgress(2);setDebug("");setMessage("QRを先に解析し、不足項目だけOCRしています…");if(preview)URL.revokeObjectURL(preview);setPreview(URL.createObjectURL(file));
    (window as any).__vehicleCertificateQrPriority=null;(window as any).__vehicleCertificatePhotoPriority=null;(window as any).__vehicleCertificateQr=[];
    let worker:any=null;const started=performance.now();let passes=0;
    try{
      const srcPromise=loadCanvas(file);const tessPromise=import("tesseract.js");
      await wait(250);let qr=readQr();
      const [rawSrc,t]:any=await Promise.all([srcPromise,tessPromise]);const normalized=normalizeCertificateCanvas(rawSrc,1800);const src=normalized.canvas;rawSrc.width=1;rawSrc.height=1;const paper={x:0,y:0,w:src.width,h:src.height};setProgress(12);
      const workerPromise=t.createWorker("jpn+eng",1);const P=t.PSM,block=P?.SINGLE_BLOCK??"6",sparse=P?.SPARSE_TEXT??"11";
      // QRはOCR worker起動と並列。最大約1.5秒だけ先行待ちする。
      for(let i=0;i<5&&!Object.keys(qr).length;i++){await wait(250);qr=readQr();}
      mergePatch(qr);setProgress(22);
      worker=await workerPromise;
      const rr=async(box:[number,number,number,number],psm:any,binary=false)=>{passes++;return recognize(worker,crop(src,rel(paper,...box),2300,binary),psm);};

      // 旧32セル逐次OCRを4つの帯域OCRへ集約。
      const top=await rr([.055,.075,.89,.215],sparse);setProgress(42);
      const user=await rr([.055,.285,.89,.120],block);setProgress(57);
      const core=await rr([.055,.405,.89,.105],block);setProgress(72);
      const spec=await rr([.055,.495,.89,.105],block);setProgress(86);

      qr=readQr();
      const patch:Patch={};
      const reg=parseRegistrationNumber(top)?.canonical||"";
      const chassisHint=String(qr.chassisNumber||chassisCandidate(top,"")||"");
      const modelNow=String(qr.model||modelCandidate(core,chassisHint)||"");
      const ch=String(qr.chassisNumber||chassisHint||chassisCandidate(top,modelNow)||"");
      const engine=String(qr.engineModel||engineCandidate(core,modelNow,ch)||"");
      if(reg)patch.registrationNumber=reg;
      if(ch)patch.chassisNumber=ch;
      if(modelNow)patch.model=modelNow;
      if(engine)patch.engineModel=engine;
      patch.recordDate=valueNear(top,["記録年月日"],jpDate,2);
      patch.documentNumber=valueNear(top,["記録事項番号"],docNo,2)||docNo(top);
      patch.registrationDate=chooseRegistrationDate(top,String(qr.firstRegistration||""),String(qr.inspectionExpiry||""));
      patch.firstRegistration=String(qr.firstRegistration||valueNear(top,["初度登録年月","初度登録"],jpMonth,2)||"");
      patch.inspectionExpiry=String(qr.inspectionExpiry||valueNear(top,["有効期間の満了する日"],jpDate,2)||"");
      patch.userName=String(qr.userName||valueNear(user,["使用者の氏名又は名称"],freeJp,2)||"");
      patch.userAddress=String(qr.userAddress||valueNear(user,["使用者の住所"],freeJp,2)||"");
      patch.baseLocation=valueNear(user,["使用の本拠の位置"],freeJp,2);
      patch.vehicleName=String(qr.vehicleName||maker(core)||"");
      patch.vehicleClass=String(qr.vehicleClass||vehicleClass(core)||"");
      patch.purpose=String(qr.purpose||purpose(core)||"");
      patch.privateBusiness=String(qr.privateBusiness||privateBiz(core)||"");
      patch.bodyShape=String(qr.bodyShape||body(core)||"");
      patch.seatingCapacity=String(qr.seatingCapacity||valueNear(`${core}\n${spec}`,["乗車定員"],seatValue,1)||(core.match(/(\d{1,2})\s*人/)?.[1]||""));
      patch.maxPayloadKg=String(qr.maxPayloadKg||valueNear(`${core}\n${spec}`,["最大積載量"],payloadValue,2)||"");
      // 軸重を先に拾い、軸重合計と矛盾する重量タプルを落とす。QR未読時のトラック系で特に有効。
      patch.frontFrontAxleWeightKg=String(qr.frontFrontAxleWeightKg||valueNear(spec,["前前軸重","前軸重"],axleValue,2)||"");
      patch.frontRearAxleWeightKg=String(qr.frontRearAxleWeightKg||valueNear(spec,["前後軸重"],axleValue,2)||"");
      patch.rearFrontAxleWeightKg=String(qr.rearFrontAxleWeightKg||valueNear(spec,["後前軸重"],axleValue,2)||"");
      patch.rearRearAxleWeightKg=String(qr.rearRearAxleWeightKg||valueNear(spec,["後後軸重","後軸重"],axleValue,2)||"");
      Object.assign(patch,numericTuple(spec,{...patch,...qr}));
      patch.displacementOrRatedOutput=String(qr.displacementOrRatedOutput||output(spec)||"");
      patch.fuel=String(qr.fuel||fuelText(spec)||"");
      patch.modelDesignationNumber=String(qr.modelDesignationNumber||"");
      patch.classificationNumber=String(qr.classificationNumber||"");

      // 登録番号・車台番号・登録年月日が欠けた時だけ上段を1回だけ二値化再読取。
      if(!patch.registrationNumber||!patch.chassisNumber||!patch.registrationDate||!patch.recordDate){
        const retry=await rr([.045,.070,.91,.225],sparse,true);setProgress(93);
        if(!patch.registrationNumber)patch.registrationNumber=parseRegistrationNumber(retry)?.canonical||"";
        if(!patch.chassisNumber)patch.chassisNumber=chassisCandidate(retry,modelNow);
        if(!patch.registrationDate)patch.registrationDate=chooseRegistrationDate(retry,patch.firstRegistration||"",patch.inspectionExpiry||"");
        if(!patch.recordDate)patch.recordDate=valueNear(retry,["記録年月日"],jpDate,2);
      }

      // QRは最後にもう一度だけ取り込み、OCRより優先。
      qr=readQr();const finalPatch={...safePhotoPatch(patch),...qr};
      // 型式由来の誤読を原動機として確定しない。
      const fam=modelFamily(String(finalPatch.model||""));
      if(finalPatch.engineModel&&fam&&compact(finalPatch.engineModel).toUpperCase().includes(fam))delete finalPatch.engineModel;
      mergePatch(finalPatch);window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:finalPatch}));
      const elapsed=Math.round(performance.now()-started),qrItems=Array.isArray((window as any).__vehicleCertificateQr)?(window as any).__vehicleCertificateQr:[],qrCount=qrItems.length,qrExpected=expectedCertificateQrCount(qrItems,String(finalPatch.recordDate||""));
      setDebug([`写真高速OCR v2`, `所要: ${elapsed}ms`, `OCR: ${passes}pass`, `QR: ${qrCount}/${qrExpected.count} (${qrExpected.label})`, `用紙補正: ${normalized.mode} / ${Math.round(normalized.confidence*100)}%`,"","--- 上段 ---",top,"","--- 使用者 ---",user,"","--- 車両 ---",core,"","--- 数値 ---",spec].join("\n"));
      src.width=1;src.height=1;setProgress(100);setMessage(`写真高速OCR完了: ${elapsed}ms / OCR ${passes}pass / QR ${qrCount}/${qrExpected.count}。内容を確認してください。`);
    }catch(e:any){console.error(e);setMessage(`写真OCRエラー: ${e?.message||"読み取りに失敗しました"}`);}finally{if(worker)await worker.terminate().catch(()=>{});setDocBusy(false);}
  }

  function onFile(file:File){if(file.type==="application/pdf"){fileKind.current="pdf";setDocBusy(true);setProgress(10);setMessage("PDFネイティブ読み取り中…");setTimeout(()=>{if(fileKind.current==="pdf")setDocBusy(false);},12000);return;}void readPhoto(file);}

  async function save(){if(!vehicle.chassis&&!vehicle.registration){setMessage("車台番号または登録番号を確認してください。");return;}const c=vehicle.certificate,p:any={vehicle_number:vehicle.chassis||vehicle.registration,registration_number:vehicle.registration||null,registration_number_last4:vehicle.last4||null,chassis_number:vehicle.chassis||null,model:vehicle.model||null,fuel_type:vehicle.type,vehicle_weight:vehicle.weight?Number(vehicle.weight):null,curb_weight_kg:toInt(c.vehicleWeightKg),gross_vehicle_weight_kg:toInt(c.grossVehicleWeightKg),seating_capacity:toInt(c.seatingCapacity),engine_model:c.engineModel||null,usage_category:c.purpose||null,body_type:c.bodyShape||null,inspection_certificate_number:c.documentNumber||null,user_name_snapshot:c.userName||null,first_registration:vehicle.firstRegistration||null,inspection_expiry_date:dateIso(c.inspectionExpiry),certificate_fields:c,front_front_axle_weight_kg:toInt(c.frontFrontAxleWeightKg),front_rear_axle_weight_kg:toInt(c.frontRearAxleWeightKg),rear_front_axle_weight_kg:toInt(c.rearFrontAxleWeightKg),rear_rear_axle_weight_kg:toInt(c.rearRearAxleWeightKg),customer_id:vehicle.customerId||null,updated_at:new Date().toISOString()};const q=vehicle.id?await supabase.from("vehicles").update(p).eq("id",vehicle.id).select().single():await supabase.from("vehicles").insert(p).select().single();if(q.error){setMessage(safeActionError("車両情報の保存", q.error));return;}const v={...vehicle,id:q.data.id};setVehicle(v);setVehicles(old=>[v,...old.filter(x=>x.id!==v.id)]);localStorage.setItem(ACTIVE_KEY,JSON.stringify(v));setMessage("車検証情報を保存し、作業車両に設定しました。");}
  function startOCR(){if(!vehicle.chassis&&!vehicle.registration){setMessage("先に車両を選択または保存してください。");return;}localStorage.setItem(ACTIVE_KEY,JSON.stringify(vehicle));try{const a=JSON.parse(localStorage.getItem("parts-data")||"[]");localStorage.setItem(BEFORE_KEY,JSON.stringify(Array.isArray(a)?a.map((x:any)=>x.id).filter(Boolean):[]));}catch{localStorage.setItem(BEFORE_KEY,"[]");}location.assign("/ocr/auto");}

  return <main className="page"><div className="top"><button onClick={()=>location.assign("/")}>← メインへ</button><strong>icb</strong></div>
    <section className="card"><h1>作業車両を選択</h1><div className="notice">{busy?"車両一覧を読み込み中…":message}</div><input placeholder="ナンバー / 車台番号 / 型式" value={search} onChange={e=>setSearch(e.target.value)}/><div className="list">{filtered.map(v=><button key={v.id||v.number} className={`row ${vehicle.id===v.id&&v.id?"active":""}`} onClick={()=>select(v)}><b>{v.registration||v.number}</b><span>{v.model||"型式未入力"}　番号 {v.last4||"----"}</span><small>{v.chassis||v.number}</small></button>)}</div></section>
    <section className="card"><h2>車検証から読み取る</h2><p>写真はQRを先に解析し、QRで埋まらない部分だけを帯域OCRします。PDFは文字レイヤーを直接利用します。</p><input ref={cam} className="hidden" type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);e.currentTarget.value="";}}/><input ref={lib} className="hidden" type="file" accept="image/*,application/pdf" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);e.currentTarget.value="";}}/><div className="actions"><button className="primary" disabled={docBusy} onClick={()=>cam.current?.click()}>📷 今撮影して読み取る</button><button disabled={docBusy} onClick={()=>lib.current?.click()}>📄 PDF / 写真から読み取る</button></div>{docBusy&&<><div className="progress"><div style={{width:`${progress}%`}}/></div><p>読み取り中 {progress}%</p></>}{preview&&<img className="preview" src={preview} alt="車検証"/>}{debug&&<details><summary>高速読み取り詳細（確認用）</summary><pre>{debug}</pre></details>}</section>
    <section className="card"><h2>基本情報</h2><div className="grid"><label>登録番号<input value={vehicle.registration} onChange={e=>update("registrationNumber",e.target.value)}/></label><label>ナンバー番号<input value={vehicle.last4} onChange={e=>setVehicle(p=>({...p,last4:digits(e.target.value).slice(-4)}))}/></label><label>車台番号<input value={vehicle.chassis} onChange={e=>update("chassisNumber",e.target.value)}/></label><label>型式<input value={vehicle.model} onChange={e=>update("model",e.target.value)}/></label><label>燃料<select value={vehicle.type} onChange={e=>setVehicle(p=>({...p,type:e.target.value as FuelType}))}><option>EV</option><option>ガソリン</option><option>HV</option><option>ディーゼル</option><option>その他</option></select></label><label>車両重量 kg<input value={vehicle.weight} onChange={e=>update("vehicleWeightKg",e.target.value)}/></label><label>初度登録<input value={vehicle.firstRegistration} onChange={e=>update("firstRegistration",e.target.value)}/></label></div></section>
    <section className="card"><h2>車検証読み取り情報</h2><div className="grid">{FIELDS.map(([k,l])=><label key={k}><span>{l}</span><input value={cert[k]||""} onChange={e=>update(k,e.target.value)}/></label>)}</div><div className="axles"><b>軸重</b><span>前前 {cert.frontFrontAxleWeightKg||"未読"} kg</span><span>前後 {cert.frontRearAxleWeightKg||"未読"} kg</span><span>後前 {cert.rearFrontAxleWeightKg||"未読"} kg</span><span>後後 {cert.rearRearAxleWeightKg||"未読"} kg</span></div><div className="actions"><button onClick={()=>setVehicle({...EMPTY,certificate:emptyCert()})}>＋新規車両</button><button onClick={save}>車両を保存</button></div><button className="primary wide" onClick={startOCR}>この車両で伝票OCRへ →</button></section>
    <style jsx global>{`*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{font-size:24px;margin:0 0 8px}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:14px;margin:14px 0}.list{display:grid;gap:8px;margin-top:12px;max-height:300px;overflow:auto}.row{text-align:left;display:grid;gap:3px}.row span,.row small{color:#5d6878;font-weight:500}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid label{display:grid;gap:6px;color:#5d6878;font-weight:700}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.actions>*{flex:1 1 220px}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.wide{width:100%;margin-top:12px;font-size:18px;padding:16px}.hidden{display:none}.preview{width:100%;max-height:560px;object-fit:contain;border-radius:14px;margin-top:14px;background:#f4f6fa}.progress{height:8px;background:#e4eaf3;border-radius:999px;overflow:hidden;margin-top:14px}.progress>div{height:100%;background:#2f6fe4}details{margin-top:14px;border:1px solid #d9e0ea;border-radius:12px;padding:12px}pre{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px}.axles{margin-top:16px;background:#eef4ff;border:1px solid #c8d8fb;border-radius:14px;padding:14px;display:flex;gap:12px;flex-wrap:wrap}.axles b{width:100%}.axles span{font-weight:700;color:#315fba}@media(max-width:650px){.grid{grid-template-columns:1fr}.card{padding:18px}.page{padding-left:10px;padding-right:10px}}`}</style>
  </main>;
}
