"use client";

import { useLayoutEffect } from "react";
import { parseVehicleCertificatePdfStructured } from "./certificate-pdf-structured-reader-v3";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const V3_PASS_KEY = "pdfStructuredV3PassThrough";
const SELF_PASS_KEY = "pdfV3LayoutRecoveryPassThrough";

const MAKERS = ["トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","日野","UDトラックス","メルセデス・ベンツ","フォルクスワーゲン","アウディ","BMW","ボルボ"];
const BODY_TYPES = ["キャブオーバ","ステーションワゴン","ボンネット","ピックアップ","トラック","ダンプ","セダン","箱型","バン","バス","幌型"];
const REQUIRED = ["registrationNumber","chassisNumber","model","vehicleName","registrationDate","firstRegistration","vehicleClass","purpose","privateBusiness","bodyShape","seatingCapacity","maxPayloadKg","vehicleWeightKg","grossVehicleWeightKg","lengthCm","widthCm","heightCm","frontFrontAxleWeightKg","frontRearAxleWeightKg","rearFrontAxleWeightKg","rearRearAxleWeightKg","engineModel","displacementOrRatedOutput","fuel","modelDesignationNumber","classificationNumber","userName","userAddress","inspectionExpiry"];

const LABELS = {
  registrationNumber:["自動車登録番号又は車両番号","自動車登録番号","車両番号"], chassisNumber:["車台番号"], model:["型式"], vehicleName:["車名"],
  registrationDate:["登録年月日/交付年月日","登録年月日／交付年月日","登録年月日","交付年月日"], firstRegistration:["初度登録年月","初度検査年月","初度登録","初度検査"],
  vehicleClass:["自動車の種別"], purpose:["用途"], privateBusiness:["自家用・事業用の別","自家用・事業用"], bodyShape:["車体の形状"], seatingCapacity:["乗車定員"],
  maxPayloadKg:["最大積載量"], vehicleWeightKg:["車両重量"], grossVehicleWeightKg:["車両総重量"], lengthCm:["長さ"], widthCm:["幅"], heightCm:["高さ"],
  frontFrontAxleWeightKg:["前前軸重","前軸重"], frontRearAxleWeightKg:["前後軸重"], rearFrontAxleWeightKg:["後前軸重"], rearRearAxleWeightKg:["後後軸重","後軸重"],
  engineModel:["原動機の型式"], displacementOrRatedOutput:["総排気量又は定格出力","総排気量"], fuel:["燃料の種類","燃料"], modelDesignationNumber:["型式指定番号"], classificationNumber:["類別区分番号"],
  userName:["使用者の氏名又は名称"], userAddress:["使用者の住所"], inspectionExpiry:["有効期間の満了する日","有効期間満了日"]
};

function norm(v){return String(v??"").normalize("NFKC").replace(/[‐‑‒–—―ー]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").trim();}
function compact(v){return norm(v).replace(/[\s:：・,，.。()（）\[\]［］]/g,"");}
function token(item,w,h){const text=norm(item?.str);if(!text)return null;const tr=item?.transform||[1,0,0,1,0,0];return{text,x:Number(tr[4]||0)/Math.max(1,w),y:1-Number(tr[5]||0)/Math.max(1,h),w:Math.max(Number(item?.width||0),1)/Math.max(1,w),h:Math.max(Math.abs(Number(tr[3]||0)),Number(item?.height||0),1)/Math.max(1,h)};}
function linesFrom(tokens){const lines=[];for(const t of [...tokens].sort((a,b)=>a.y-b.y||a.x-b.x)){let l=lines.find(x=>Math.abs(x.y-t.y)<=Math.max(.0045,t.h*.72));if(!l){l={y:t.y,tokens:[]};lines.push(l);}l.tokens.push(t);l.y=l.tokens.reduce((s,x)=>s+x.y,0)/l.tokens.length;}for(const l of lines){l.tokens.sort((a,b)=>a.x-b.x);l.text=l.tokens.map(x=>x.text).join(" ");}return lines.sort((a,b)=>a.y-b.y);}
function anchor(lines,labels){for(const label of labels||[]){const wanted=compact(label);for(const line of lines)for(let s=0;s<line.tokens.length;s++){let joined="";for(let e=s;e<Math.min(line.tokens.length,s+14);e++){joined+=compact(line.tokens[e].text);if(joined.includes(wanted)){const slice=line.tokens.slice(s,e+1);return{line,x:Math.min(...slice.map(t=>t.x)),right:Math.max(...slice.map(t=>t.x+t.w)),y:line.y};}if(joined.length>wanted.length+24)break;}}}return null;}
function nearby(lines,a,{xPad=.055,maxDy=.065,rightSpan=.55}={}){if(!a)return[];const out=[];const same=a.line.tokens.filter(t=>t.x>=a.right-.002&&t.x<=Math.min(1,a.right+rightSpan));if(same.length)out.push(same.map(t=>t.text).join(" "));for(const l of lines){const dy=l.y-a.y;if(dy<=.002||dy>maxDy)continue;const values=l.tokens.filter(t=>{const c=t.x+t.w/2;return c>=Math.max(0,a.x-xPad)&&c<=Math.min(1,a.right+xPad);});if(values.length)out.push(values.map(t=>t.text).join(" "));}return out;}
function firstParsed(lines,labels,parser,opts){const a=anchor(lines,labels);for(const text of nearby(lines,a,opts)){const v=parser(text);if(v!==""&&v!=null)return v;}return "";}
function registration(s){const m=norm(s).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);return m?`${m[1]} ${m[2].replace(/\D/g,"")} ${m[3]} ${m[4].replace(/\D/g,"")}`:"";}
function chassis(s){const ms=norm(s).toUpperCase().replace(/\s+/g,"").match(/[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9O]{4,12}/g)||[];return ms.map(v=>{const [l,r]=v.split("-");return`${l}-${r.replace(/O/g,"0")}`;}).sort((a,b)=>b.length-a.length)[0]||"";}
function model(s){const ms=norm(s).toUpperCase().replace(/\s+/g,"").match(/(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14}/g)||[];return ms.filter(v=>!/^[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9]{4,12}$/.test(v)).sort((a,b)=>b.length-a.length)[0]||"";}
function engine(s){const t=norm(s).toUpperCase().replace(/\s+/g,"");const ms=t.match(/[A-Z0-9]{2,10}(?:-[A-Z0-9]{1,10})?/g)||[];return ms.find(v=>/[A-Z]/.test(v)&&/\d/.test(v)&&!/^\d{3,6}$/.test(v)&&!/^\d[A-Z]{1,3}-[A-Z0-9]{4,}$/.test(v))||"";}
function jpMonth(s){const m=norm(s).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);if(!m)return"";const mo=+m[3];return mo>=1&&mo<=12?`${m[1]}${m[2]==="元"?"元":+m[2]}年${mo}月`:"";}
function jpDate(s){const m=norm(s).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);if(!m)return"";const mo=+m[3],d=+m[4];return mo>=1&&mo<=12&&d>=1&&d<=31?`${m[1]}${m[2]==="元"?"元":+m[2]}年${mo}月${d}日`:"";}
function integer(min,max){return s=>{const ms=norm(s).replace(/,/g,"").match(/\d{1,6}/g)||[];for(const x of ms){const n=+x;if(n>=min&&n<=max)return String(n);}return"";};}
function weight(s){const m=norm(s).replace(/,/g,"").match(/(\d{2,5})(?:\s*[\[［]\s*(\d{2,5})\s*[\]］])?/);return m?(m[2]?`${+m[1]} [${+m[2]}]`:String(+m[1])):"";}
function displacement(s){const m=norm(s).match(/(\d+(?:\.\d+)?)\s*(L|ℓ|l|kW|KW|kw)\b/i);return m?`${m[1]} ${/^(l|ℓ)$/i.test(m[2])?"L":"kW"}`:"";}
function free(s){const v=norm(s).replace(/\[[0-9\s_-]+\]$/g,"").replace(/^[\s:：|/\\-]+|[\s:：|/\\-]+$/g,"").trim();return v&&v.length<=100&&/[一-龠ぁ-んァ-ヶA-Za-z0-9＊*]/.test(v)?v:"";}
function pick(values){return s=>{const d=compact(s);return values.find(v=>d.includes(compact(v)))||"";};}

function recover(lines,strictPatch){const patch={...(strictPatch||{})};const put=(k,v)=>{if((patch[k]===undefined||patch[k]==="")&&v!==undefined&&v!=="")patch[k]=v;};const all=lines.map(l=>l.text).join("\n");
  put("registrationNumber",registration(all)); put("chassisNumber",chassis(all)); put("model",firstParsed(lines,LABELS.model,model,{xPad:.08})||model(all)); put("vehicleName",firstParsed(lines,LABELS.vehicleName,pick(MAKERS),{xPad:.08})||pick(MAKERS)(all));
  put("registrationDate",firstParsed(lines,LABELS.registrationDate,jpDate,{xPad:.08})); put("firstRegistration",firstParsed(lines,LABELS.firstRegistration,jpMonth,{xPad:.08})); put("inspectionExpiry",firstParsed(lines,LABELS.inspectionExpiry,jpDate,{rightSpan:.4,xPad:.08,maxDy:.08}));
  put("vehicleClass",firstParsed(lines,LABELS.vehicleClass,free,{xPad:.07})); put("purpose",firstParsed(lines,LABELS.purpose,free,{xPad:.07})); put("privateBusiness",firstParsed(lines,LABELS.privateBusiness,free,{xPad:.08})); put("bodyShape",firstParsed(lines,LABELS.bodyShape,pick(BODY_TYPES),{xPad:.08})||pick(BODY_TYPES)(all));
  put("seatingCapacity",firstParsed(lines,LABELS.seatingCapacity,integer(1,99),{xPad:.06})); put("maxPayloadKg",firstParsed(lines,LABELS.maxPayloadKg,weight,{xPad:.06})); put("vehicleWeightKg",firstParsed(lines,LABELS.vehicleWeightKg,weight,{xPad:.06})); put("grossVehicleWeightKg",firstParsed(lines,LABELS.grossVehicleWeightKg,weight,{xPad:.06}));
  put("lengthCm",firstParsed(lines,LABELS.lengthCm,integer(100,3000),{xPad:.05})); put("widthCm",firstParsed(lines,LABELS.widthCm,integer(80,500),{xPad:.05})); put("heightCm",firstParsed(lines,LABELS.heightCm,integer(80,500),{xPad:.05}));
  put("frontFrontAxleWeightKg",firstParsed(lines,LABELS.frontFrontAxleWeightKg,integer(0,30000),{xPad:.055})); put("frontRearAxleWeightKg",firstParsed(lines,LABELS.frontRearAxleWeightKg,integer(0,30000),{xPad:.055})); put("rearFrontAxleWeightKg",firstParsed(lines,LABELS.rearFrontAxleWeightKg,integer(0,30000),{xPad:.055})); put("rearRearAxleWeightKg",firstParsed(lines,LABELS.rearRearAxleWeightKg,integer(0,30000),{xPad:.055}));
  put("engineModel",firstParsed(lines,LABELS.engineModel,engine,{xPad:.07})); put("displacementOrRatedOutput",firstParsed(lines,LABELS.displacementOrRatedOutput,displacement,{xPad:.08,maxDy:.08})); put("fuel",firstParsed(lines,LABELS.fuel,free,{xPad:.06}));
  put("modelDesignationNumber",firstParsed(lines,LABELS.modelDesignationNumber,integer(1,999999),{xPad:.055})); put("classificationNumber",firstParsed(lines,LABELS.classificationNumber,s=>{const m=norm(s).match(/\b\d{4}\b/);return m?m[0]:"";},{xPad:.055}));
  put("userName",firstParsed(lines,LABELS.userName,free,{xPad:.12,maxDy:.08})); put("userAddress",firstParsed(lines,LABELS.userAddress,free,{xPad:.16,maxDy:.09}));
  const found=REQUIRED.filter(k=>patch[k]!==undefined&&patch[k]!=="").length; const strong=Boolean(patch.registrationNumber&&patch.chassisNumber&&patch.model&&patch.vehicleName&&patch.vehicleWeightKg&&patch.grossVehicleWeightKg&&patch.lengthCm&&patch.widthCm&&patch.heightCm&&patch.engineModel&&patch.fuel&&found>=22); return{patch,found,strong};}

async function anchorParse(file){const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;try{let best=null;for(let n=1;n<=Math.min(pdf.numPages||1,8);n++){const page=await pdf.getPage(n),vp=page.getViewport({scale:1}),content=await page.getTextContent(),tokens=(content.items||[]).map(x=>token(x,vp.width,vp.height)).filter(Boolean),lines=linesFrom(tokens),d=compact(lines.map(l=>l.text).join(" ")),score=(d.includes("車両番号")||d.includes("自動車登録番号")?3:0)+(d.includes("車台番号")?3:0)+(d.includes("車両重量")?2:0)+(d.includes("原動機の型式")?2:0);if(!best||score>best.score)best={lines,score,pageNumber:n};}return best||{lines:[],score:0,pageNumber:1};}finally{await pdf.destroy?.().catch?.(()=>{});}}
function statusText(){return document.querySelector("[data-pdf-structured-v3-status]")?.textContent||"";}
function resetForm(){Array.from(document.querySelectorAll("button")).find(b=>(b.textContent||"").includes("＋新規車両"))?.click();}
function apply(patch){window[PDF_PRIORITY_KEY]=patch;window[QR_PRIORITY_KEY]=null;window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:patch}));}

export default function CertificatePdfV3LayoutRecovery(){useLayoutEffect(()=>{let dead=false,pending=null,latest=null;const onChange=async e=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.type!=="file")return;if(input.dataset[SELF_PASS_KEY]==="1"){delete input.dataset[SELF_PASS_KEY];return;}const file=input.files?.[0];if(!file||!(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")))return;
    if(input.dataset[V3_PASS_KEY]!=="1"){const copy=file.slice(0,file.size,file.type);pending=Promise.all([parseVehicleCertificatePdfStructured(copy.slice(0,copy.size,copy.type)),anchorParse(copy.slice(0,copy.size,copy.type))]).then(([strict,a])=>{latest=recover(a.lines,strict.patch);latest.strictFound=strict.found;latest.strictStrong=strict.strong;latest.pageNumber=a.pageNumber;return latest;}).catch(err=>{console.warn("certificate pdf v3 layout recovery",err);return null;});return;}
    const status=statusText();if(status.includes("QRを検出"))return;if(!status.includes("構造確信度不足"))return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();const result=latest||(pending?await pending:null);if(dead)return;if(result?.strong){delete input.dataset[V3_PASS_KEY];resetForm();await new Promise(r=>setTimeout(r,0));if(dead)return;apply(result.patch);const box=document.querySelector("[data-pdf-structured-v3-status]");if(box)box.textContent=`PDF構造読み取り v3 + layout recovery 完了: ${result.found}項目（strict ${result.strictFound}項目）。`;input.value="";return;}
    input.dataset[SELF_PASS_KEY]="1";input.dispatchEvent(new Event("change",{bubbles:true}));};window.addEventListener("change",onChange,true);return()=>{dead=true;window.removeEventListener("change",onChange,true);};},[]);return null;}
