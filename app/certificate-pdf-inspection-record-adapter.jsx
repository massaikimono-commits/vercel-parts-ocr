"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT="vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY="__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY="__vehicleCertificateQrPriority";
const DOC_TYPE="AUTOMOBILE_INSPECTION_RECORD";
const PASS_KEY="pdfInspectionRecordAdapterPassThrough";

const LABELS=["自動車登録番号又は車両番号","車両番号","車台番号","登録年月日/交付年月日","登録年月日／交付年月日","交付年月日","初度登録年月","初度検査年月","有効期間の満了する日","型式指定番号","類別区分番号","型式","原動機の型式","車名","自動車の種別","用途","自家用・事業用の別","車体の形状","乗車定員","最大積載量","車両重量","車両総重量","長さ","幅","高さ","前前軸重","前後軸重","後前軸重","後後軸重","燃料の種類","総排気量又は定格出力","記録事項番号","使用者の氏名又は名称","使用者の住所","使用の本拠の位置","3.車両詳細情報"];
function norm(v){return String(v||"").normalize("NFKC").replace(/[‐‑‒–—―]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").trim();}
function glyphs(v){return norm(v).replace(/\s+/g,"");}
function compact(v){return norm(v).replace(/[\s:：・,，.。()（）\[\]［］]/g,"");}
function jpMonth(v){const m=glyphs(v).match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?/);if(!m)return"";const mo=Number(m[3]);return mo>=1&&mo<=12?`${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mo}月`:"";}
function jpDate(v){const m=glyphs(v).match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);if(!m)return"";const mo=Number(m[3]),d=Number(m[4]);return mo>=1&&mo<=12&&d>=1&&d<=31?`${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mo}月${d}日`:"";}
function token(item,w,h){const text=norm(item?.str);if(!text)return null;const tr=item?.transform||[1,0,0,1,0,0];return{text,x:Number(tr[4]||0)/Math.max(1,w),y:1-Number(tr[5]||0)/Math.max(1,h),h:Math.max(Math.abs(Number(tr[3]||0)),Number(item?.height||0),1)/Math.max(1,h)};}
function linesFrom(tokens){const lines=[];for(const t of [...tokens].sort((a,b)=>a.y-b.y||a.x-b.x)){let l=lines.find(x=>Math.abs(x.y-t.y)<=Math.max(.0045,t.h*.72));if(!l){l={y:t.y,tokens:[]};lines.push(l);}l.tokens.push(t);l.y=l.tokens.reduce((s,x)=>s+x.y,0)/l.tokens.length;}for(const l of lines){l.tokens.sort((a,b)=>a.x-b.x);l.text=l.tokens.map(x=>x.text).join(" ");}return lines.sort((a,b)=>a.y-b.y);}
function detect(lines){const d=compact(lines.map(l=>l.text).join("\n"));return d.includes("自動車検査証記録事項")&&d.includes("1基本情報")&&d.includes("3車両詳細情報");}
function stripNextLabel(s){let out=glyphs(s);let cut=out.length;for(const label of LABELS){const p=out.indexOf(glyphs(label));if(p>=0&&p<cut)cut=p;}return out.slice(0,cut);}
function parse(lines){
 const patch={};const put=(k,v)=>{const s=String(v??"").trim();if(s)patch[k]=s;};
 const rows=lines.map(l=>({raw:norm(l.text),dense:glyphs(l.text)})).filter(x=>x.raw);
 const whole=rows.map(x=>x.dense).join("\n");
 const field=(labels,maxRows=1)=>{for(let i=0;i<rows.length;i++){for(const label of labels){const g=glyphs(label),at=rows[i].dense.indexOf(g);if(at<0)continue;let s=stripNextLabel(rows[i].dense.slice(at+g.length));if(s)return s;for(let j=1;j<=maxRows&&i+j<rows.length;j++){const n=stripNextLabel(rows[i+j].dense);if(n)return n;}}}return"";};
 const matchField=(labels,re,maxRows=1)=>{const s=field(labels,maxRows);const m=s.match(re);return m?(m[1]||m[0]):"";};
 const plateRaw=matchField(["自動車登録番号又は車両番号","車両番号"],/([ぁ-んァ-ヶ一-龠]{2,8}\d{3}[ぁ-ん]\d{4})/,1);const plate=plateRaw.match(/^([ぁ-んァ-ヶ一-龠]{2,8})(\d{3})([ぁ-ん])(\d{4})$/);if(plate)put("registrationNumber",`${plate[1]} ${plate[2]} ${plate[3]} ${plate[4]}`);
 const chassis=matchField(["車台番号"],/([A-Z]{1,8}[A-Z0-9]{0,10}-[A-Z0-9]{4,14})/i,1);if(chassis)put("chassisNumber",chassis.toUpperCase());
 const regDate=matchField(["登録年月日/交付年月日","登録年月日／交付年月日","交付年月日"],/((?:令和|平成|昭和)(?:元|\d{1,2})年?\d{1,2}月?\d{1,2}日?)/,1);if(regDate)put("registrationDate",jpDate(regDate));
 const first=matchField(["初度登録年月","初度検査年月"],/((?:令和|平成|昭和)(?:元|\d{1,2})年?\d{1,2}月?)/,1);if(first)put("firstRegistration",jpMonth(first));
 const expiry=matchField(["有効期間の満了する日"],/((?:令和|平成|昭和)(?:元|\d{1,2})年?\d{1,2}月?\d{1,2}日?)/,1);if(expiry)put("inspectionExpiry",jpDate(expiry));
 const model=matchField(["型式"],/([0-9A-Z]{2,8}-[0-9A-Z]{2,16})/i,1);if(model)put("model",model.toUpperCase());
 const engine=matchField(["原動機の型式"],/([0-9A-Z-]{2,12})/i,1);if(engine)put("engineModel",engine.toUpperCase());
 const makers=["トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","日野","UDトラックス"];
 const vehicleName=matchField(["車名"],new RegExp(`(${makers.join("|")})`),1)||makers.find(x=>whole.includes(x));if(vehicleName)put("vehicleName",vehicleName);
 const pick=(label,choices)=>matchField([label],new RegExp(`(${choices.join("|")})`),1);
 put("vehicleClass",pick("自動車の種別",["普通","小型","軽自動車","大型特殊"]));put("purpose",pick("用途",["乗用","貨物","乗合","特種"]));put("privateBusiness",pick("自家用・事業用の別",["自家用","事業用"]));put("bodyShape",pick("車体の形状",["キャブオーバ","ステーションワゴン","ボンネット","ピックアップ","トラック","ダンプ","セダン","箱型","バン","バス","幌型"]));
 const seat=matchField(["乗車定員"],/(\d{1,2})(?:\[\d{1,2}\])?人/,1);if(seat)put("seatingCapacity",String(Number(seat)));
 const numeric=[["maxPayloadKg","最大積載量","kg"],["vehicleWeightKg","車両重量","kg"],["grossVehicleWeightKg","車両総重量","kg"],["lengthCm","長さ","cm"],["widthCm","幅","cm"],["heightCm","高さ","cm"],["frontFrontAxleWeightKg","前前軸重","kg"],["frontRearAxleWeightKg","前後軸重","kg"],["rearFrontAxleWeightKg","後前軸重","kg"],["rearRearAxleWeightKg","後後軸重","kg"]];
 for(const[key,label,unit]of numeric){const n=matchField([label],new RegExp(`(-|\\d{1,5})(?:\\[\\d{1,5}\\])?${unit}`,"i"),1);if(n)put(key,n==="-"?"-":String(Number(n)));}
 const fuel=matchField(["燃料の種類"],/(ガソリン|揮発油|軽油|電気|LPG|CNG|水素)/,1);if(fuel)put("fuel",fuel);
 const disp=matchField(["総排気量又は定格出力"],/(\d+(?:\.\d+)?(?:L|kW))/i,1);if(disp){const m=disp.match(/([\d.]+)(L|kW)/i);if(m)put("displacementOrRatedOutput",`${m[1]} ${m[2].toUpperCase()}`);}
 const td=matchField(["型式指定番号"],/(\d{4,6})/,1);if(td)put("modelDesignationNumber",td);const cl=matchField(["類別区分番号"],/(\d{4})/,1);if(cl)put("classificationNumber",cl);const record=matchField(["記録事項番号"],/(\d{8,16})/,1);if(record)put("recordNumber",record);
 const safeText=(labels)=>{const s=field(labels,1).replace(/\[\d+\]$/g,"").trim();return s&&!/^\*+$/.test(s)&&s.length<=100?s:"";};
 put("userName",safeText(["使用者の氏名又は名称"]));put("userAddress",safeText(["使用者の住所"]));put("baseLocation",safeText(["使用の本拠の位置"]));
 const required=["registrationNumber","chassisNumber","model","vehicleName","registrationDate","firstRegistration","inspectionExpiry","vehicleClass","purpose","privateBusiness","bodyShape","vehicleWeightKg","grossVehicleWeightKg","lengthCm","widthCm","heightCm","engineModel","fuel"];
 const requiredCount=required.filter(k=>patch[k]).length;const strong=Boolean(patch.registrationNumber&&patch.chassisNumber&&patch.model&&patch.vehicleName&&patch.engineModel&&patch.fuel&&requiredCount>=14);return{patch,requiredCount,strong};
}
async function extract(file){const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;try{const page=await pdf.getPage(1),vp=page.getViewport({scale:1}),content=await page.getTextContent(),tokens=(content.items||[]).map(x=>token(x,vp.width,vp.height)).filter(Boolean),lines=linesFrom(tokens);return{tokens,lines,...parse(lines),isTarget:detect(lines)};}finally{await pdf.destroy?.().catch?.(()=>{});}}
function apply(patch){window[PDF_PRIORITY_KEY]=patch;window[QR_PRIORITY_KEY]=null;window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:patch}));}
function reset(){Array.from(document.querySelectorAll("button")).find(b=>(b.textContent||"").includes("＋新規車両"))?.click();}
function status(message,error=false){const card=Array.from(document.querySelectorAll("section.card")).find(s=>s.querySelector("h2")?.textContent?.includes("車検証から読み取る"));if(!card)return;let box=card.querySelector("[data-inspection-record-adapter-status]");if(!box){box=document.createElement("div");box.dataset.inspectionRecordAdapterStatus="1";box.style.cssText="margin-top:12px;padding:14px;border-radius:14px;border:1px solid #a8ddbf;font-weight:800";card.querySelector(".actions")?.insertAdjacentElement("afterend",box);}box.textContent=message;box.style.background=error?"#fff1f1":"#effaf4";box.style.color=error?"#922":"#174c2e";}
function passToV3(input){input.dataset[PASS_KEY]="1";input.dispatchEvent(new Event("change",{bubbles:true}));}
export default function CertificatePdfInspectionRecordAdapter(){useLayoutEffect(()=>{let dead=false;const onChange=async e=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.type!=="file")return;if(input.dataset[PASS_KEY]==="1"){delete input.dataset[PASS_KEY];return;}if(input.dataset.pdfStructuredV3PassThrough==="1"||input.dataset.pdfNativeV2PassThrough==="1"||input.dataset.pdfNativePassThrough==="1")return;const file=input.files?.[0];if(!file||!(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();status("PDF構造読み取り v3: 帳票形式を確認中…");try{const r=await extract(file);if(dead)return;if(!r.isTarget){passToV3(input);return;}status(`PDF構造読み取り v3: ${DOC_TYPE} を解析中…`);if(!r.strong){status(`PDF構造読み取り v3: ${DOC_TYPE} ${r.requiredCount}必須項目。安全フォールバックへ移行します。`,true);passToV3(input);return;}reset();await new Promise(x=>setTimeout(x,0));if(dead)return;apply(r.patch);status(`PDF構造読み取り v3 完了: ${DOC_TYPE} / ${Object.keys(r.patch).length}項目 / OCR 0pass`);input.value="";}catch(err){console.error("inspection record adapter",err);status(`PDF構造読み取り v3: ${DOC_TYPE} adapter error。安全フォールバックへ移行します。`,true);if(!dead)passToV3(input);}};window.addEventListener("change",onChange,true);return()=>{dead=true;window.removeEventListener("change",onChange,true);};},[]);return null;}
