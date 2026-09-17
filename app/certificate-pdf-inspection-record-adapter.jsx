"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const DOC_TYPE = "AUTOMOBILE_INSPECTION_RECORD";
const PASS_KEY = "pdfInspectionRecordAdapterPassThrough";

function norm(v) {
  return String(v || "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}
function compact(v) { return norm(v).replace(/[\s:：・,，.。()（）\[\]［］]/g, ""); }
function jpMonth(v) {
  const m = norm(v).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return "";
  const month = Number(m[3]);
  return month >= 1 && month <= 12 ? `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月` : "";
}
function jpDate(v) {
  const m = norm(v).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]); const day = Number(m[4]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日` : "";
}
function registration(v) {
  const m = norm(v).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  return m ? `${m[1]} ${m[2].replace(/\D/g, "")} ${m[3]} ${m[4].replace(/\D/g, "")}` : "";
}
function token(item, w, h) {
  const text = norm(item?.str); if (!text) return null;
  const tr = item?.transform || [1,0,0,1,0,0];
  return { text, x:Number(tr[4]||0)/Math.max(1,w), y:1-Number(tr[5]||0)/Math.max(1,h), h:Math.max(Math.abs(Number(tr[3]||0)),Number(item?.height||0),1)/Math.max(1,h) };
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
function detect(lines){const d=compact(lines.map(l=>l.text).join("\n"));return d.includes(compact("自動車検査証記録事項"))&&d.includes(compact("1.基本情報"))&&d.includes(compact("3.車両詳細情報"));}
function parse(lines){
  const patch={}; const all=norm(lines.map(l=>l.text).join("\n")); const dense=compact(all);
  const put=(k,v)=>{if(v!==undefined&&v!==null&&String(v).trim())patch[k]=String(v).trim();};
  put("registrationNumber",registration(all));
  const chassis=all.toUpperCase().match(/\b([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\b/); if(chassis)put("chassisNumber",chassis[1].replace(/O/g,"0"));
  const model=all.toUpperCase().match(/\b((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{2,14})\b/); if(model)put("model",model[1]);
  const makers=["トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","日野","UDトラックス"]; put("vehicleName",makers.find(x=>dense.includes(compact(x)))||"");
  const engine=all.match(/原動機の型式\s*([A-Z0-9-]{2,12})/i); if(engine)put("engineModel",engine[1]);
  const dates=[...all.matchAll(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?(?:\s*(\d{1,2})\s*日?)?/g)];
  if(dates[1])put("registrationDate",jpDate(dates[1][0])); if(dates[2])put("firstRegistration",jpMonth(dates[2][0]));
  const expiryMatch=all.match(/有効期間の満了する日[\s\S]{0,100}?((?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年?\s*\d{1,2}\s*月?\s*\d{1,2}\s*日?)/); if(expiryMatch)put("inspectionExpiry",jpDate(expiryMatch[1]));
  put("vehicleClass",["普通","小型","軽自動車","大型特殊"].find(x=>dense.includes(compact(x)))||""); put("purpose",["乗用","貨物","乗合","特種"].find(x=>dense.includes(x))||""); put("privateBusiness",["自家用","事業用"].find(x=>dense.includes(x))||"");
  put("bodyShape",["キャブオーバ","ステーションワゴン","ボンネット","ピックアップ","トラック","ダンプ","セダン","箱型","バン","バス","幌型"].find(x=>dense.includes(x))||"");
  const seat=all.match(/乗車定員[\s\S]{0,80}?(\d{1,2})\s*(?:\[[^\]]+\]\s*)?人/); if(seat)put("seatingCapacity",String(Number(seat[1])));
  const labeled=[["maxPayloadKg","最大積載量","kg"],["vehicleWeightKg","車両重量","kg"],["grossVehicleWeightKg","車両総重量","kg"],["lengthCm","長さ","cm"],["widthCm","幅","cm"],["heightCm","高さ","cm"],["frontFrontAxleWeightKg","前前軸重","kg"],["frontRearAxleWeightKg","前後軸重","kg"],["rearFrontAxleWeightKg","後前軸重","kg"],["rearRearAxleWeightKg","後後軸重","kg"]];
  for(const [k,label,unit] of labeled){const re=new RegExp(label+"[\\s\\S]{0,70}?(-|\\d{1,5})\\s*"+unit,"i");const m=all.match(re);if(m)put(k,m[1]==="-"?"-":String(Number(m[1])));}
  const fuel=["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"].find(x=>all.includes(x)); if(fuel)put("fuel",fuel);
  const disp=all.match(/総排気量又は定格出力[\s\S]{0,100}?(\d+(?:\.\d+)?)\s*(L|kW)/i); if(disp)put("displacementOrRatedOutput",`${disp[1]} ${disp[2].toUpperCase()}`);
  const td=all.match(/型式指定番号\s*(\d{4,6})/); if(td)put("modelDesignationNumber",td[1]); const cl=all.match(/類別区分番号\s*(\d{4})/); if(cl)put("classificationNumber",cl[1]);
  const user=all.match(/使用者の氏名又は名称\s*([^\n]{2,80})/); if(user)put("userName",user[1].replace(/使用者の住所.*$/,"")); const addr=all.match(/使用者の住所\s*([^\n]{4,120})/); if(addr)put("userAddress",addr[1].replace(/\s*\[[0-9\s]+\]\s*$/,"")); const base=all.match(/使用の本拠の位置\s*([^\n]{1,120})/); if(base&&!/^\*+$/.test(compact(base[1])))put("baseLocation",base[1]);
  const required=["registrationNumber","chassisNumber","model","vehicleName","registrationDate","firstRegistration","inspectionExpiry","vehicleClass","purpose","privateBusiness","bodyShape","vehicleWeightKg","grossVehicleWeightKg","lengthCm","widthCm","heightCm","engineModel","fuel"];
  const requiredCount=required.filter(k=>patch[k]).length; const strong=Boolean(patch.registrationNumber&&patch.chassisNumber&&patch.model&&patch.vehicleName&&patch.engineModel&&patch.fuel&&requiredCount>=14);
  return {patch,requiredCount,strong};
}
async function extract(file){
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"); pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{const page=await pdf.getPage(1);const vp=page.getViewport({scale:1});const content=await page.getTextContent();const tokens=(content.items||[]).map(x=>token(x,vp.width,vp.height)).filter(Boolean);const lines=linesFrom(tokens);return {tokens,lines,...parse(lines),isTarget:detect(lines)};}finally{await pdf.destroy?.().catch?.(()=>{});}
}
function apply(patch){window[PDF_PRIORITY_KEY]=patch;window[QR_PRIORITY_KEY]=null;window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:patch}));}
function reset(){Array.from(document.querySelectorAll("button")).find(b=>(b.textContent||"").includes("＋新規車両"))?.click();}
function status(message,error=false){const card=Array.from(document.querySelectorAll("section.card")).find(s=>s.querySelector("h2")?.textContent?.includes("車検証から読み取る"));if(!card)return;let box=card.querySelector("[data-inspection-record-adapter-status]");if(!box){box=document.createElement("div");box.dataset.inspectionRecordAdapterStatus="1";box.style.cssText="margin-top:12px;padding:14px;border-radius:14px;border:1px solid #a8ddbf;font-weight:800";card.querySelector(".actions")?.insertAdjacentElement("afterend",box);}box.textContent=message;box.style.background=error?"#fff1f1":"#effaf4";box.style.color=error?"#922":"#174c2e";}
function passToV3(input){input.dataset[PASS_KEY]="1";input.dispatchEvent(new Event("change",{bubbles:true}));}

export default function CertificatePdfInspectionRecordAdapter(){
  useLayoutEffect(()=>{
    let dead=false;
    const onChange=async e=>{
      const input=e.target;
      if(!(input instanceof HTMLInputElement)||input.type!=="file")return;
      if(input.dataset[PASS_KEY]==="1"){delete input.dataset[PASS_KEY];return;}
      if(input.dataset.pdfStructuredV3PassThrough==="1"||input.dataset.pdfNativeV2PassThrough==="1"||input.dataset.pdfNativePassThrough==="1")return;
      const file=input.files?.[0]; if(!file||!(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")))return;

      // Own the first PDF change synchronously so v3/v2 cannot race this adapter.
      // Non-target or weak target documents are explicitly re-dispatched to the existing v3 path.
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      status("PDF構造読み取り v3: 帳票形式を確認中…");
      try{
        const r=await extract(file); if(dead)return;
        if(!r.isTarget){passToV3(input);return;}
        status(`PDF構造読み取り v3: ${DOC_TYPE} を解析中…`);
        if(!r.strong){status(`PDF構造読み取り v3: ${DOC_TYPE} ${r.requiredCount}必須項目。安全フォールバックへ移行します。`,true);passToV3(input);return;}
        reset(); await new Promise(x=>setTimeout(x,0)); if(dead)return;
        apply(r.patch); status(`PDF構造読み取り v3 完了: ${DOC_TYPE} / ${Object.keys(r.patch).length}項目 / OCR 0pass`); input.value="";
      }catch(err){console.error("inspection record adapter",err);status(`PDF構造読み取り v3: ${DOC_TYPE} adapter error。安全フォールバックへ移行します。`,true);if(!dead)passToV3(input);}
    };
    window.addEventListener("change",onChange,true);
    return()=>{dead=true;window.removeEventListener("change",onChange,true);};
  },[]);
  return null;
}
