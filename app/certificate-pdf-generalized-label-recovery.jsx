"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const RUN_KEY = "__vehicleCertificatePdfRun";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";

function norm(v){return String(v??"").normalize("NFKC").replace(/[‐‑‒–—―]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").trim();}
function compact(v){return norm(v).replace(/[\s:：・,，.。()（）\[\]［］]/g,"");}
function jpDateDense(s){const m=String(s||"").match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);if(!m)return"";return`${m[1]}${m[2]}年${Number(m[3])}月${Number(m[4])}日`;}
function jpMonthDense(s){const m=String(s||"").match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?/);if(!m)return"";return`${m[1]}${m[2]}年${Number(m[3])}月`;}
function between(text,label,nextLabels=[]){const at=text.indexOf(label);if(at<0)return"";const start=at+label.length;let end=Math.min(text.length,start+180);for(const next of nextLabels){const n=text.indexOf(next,start);if(n>=0&&n<end)end=n;}return text.slice(start,end);}
function first(pattern,text){const m=String(text||"").match(pattern);return m?m[1]||m[0]:"";}
function parse(text){const d=compact(text),out={};const put=(k,v)=>{if(v!==undefined&&v!==null&&String(v).trim()!=="")out[k]=String(v).trim();};
  const regSeg=between(d,d.includes("自動車登録番号又は車両番号")?"自動車登録番号又は車両番号":"車両番号",["車台番号","登録年月日","交付年月日","初度登録年月","初度検査年月"]);
  const rm=regSeg.match(/([一-龠ぁ-んァ-ヶ]{1,8})(\d{3})([ぁ-ん])([0-9]{1,4})/);if(rm)put("registrationNumber",`${rm[1]} ${rm[2]} ${rm[3]} ${rm[4]}`);
  const chassisSeg=between(d,"車台番号",["登録年月日","交付年月日","初度登録年月","初度検査年月","有効期間","所有者","使用者","乗車定員","長さ","型式"]);const cm=chassisSeg.match(/([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})/i);if(cm)put("chassisNumber",cm[1].toUpperCase().replace(/O/g,"0"));
  const regDateSeg=between(d,d.includes("登録年月日/交付年月日")?"登録年月日/交付年月日":d.includes("登録年月日")?"登録年月日":"交付年月日",["初度登録年月","初度検査年月","有効期間"]);put("registrationDate",jpDateDense(regDateSeg));
  const firstSeg=between(d,d.includes("初度登録年月")?"初度登録年月":"初度検査年月",["有効期間","所有者","使用者","車名","型式"]);put("firstRegistration",jpMonthDense(firstSeg));
  const expSeg=between(d,"有効期間の満了する日",["所有者","使用者","車両詳細情報","車名","型式"]);put("inspectionExpiry",jpDateDense(expSeg));
  const maker=["トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","日野","UDトラックス","BMW","ボルボ"].find(x=>d.includes(x));put("vehicleName",maker||"");
  const modelSeg=between(d,"型式",["原動機の型式","総排気量又は定格出力","燃料の種類"]);put("model",first(/((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{2,14})/i,modelSeg));
  const engineSeg=between(d,"原動機の型式",["総排気量又は定格出力","燃料の種類","型式指定番号"]);put("engineModel",first(/([A-Z0-9]{2,10}(?:-[A-Z0-9]{2,10})?)/i,engineSeg));
  const fuelSeg=between(d,"燃料の種類",["型式指定番号","類別区分番号","所有者","使用者"]);put("fuel",["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"].find(x=>fuelSeg.includes(x))||"");
  const md=between(d,"型式指定番号",["類別区分番号","所有者","使用者"]);put("modelDesignationNumber",first(/(\d{4,6})/,md));const cl=between(d,"類別区分番号",["所有者","使用者","備考"]);put("classificationNumber",first(/(\d{4})/,cl));
  return out;
}
async function extract(file){const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;try{let best="",score=-1;for(let n=1;n<=Math.min(pdf.numPages||1,8);n++){const page=await pdf.getPage(n),content=await page.getTextContent();const text=(content.items||[]).map(x=>norm(x?.str)).filter(Boolean).join(" ");const d=compact(text);const s=(d.includes("自動車登録番号")?3:0)+(d.includes("車台番号")?3:0)+(d.includes("車両重量")?2:0)+(d.includes("原動機の型式")?2:0);if(s>score){score=s;best=text;}}return parse(best);}finally{await pdf.destroy?.().catch?.(()=>{});}}
function statusBox(){return Array.from(document.querySelectorAll("section.card")).find(s=>s.querySelector("h2")?.textContent?.includes("車検証から読み取る"))?.querySelector("[data-pdf-structured-v3-status]")||null;}
export default function CertificatePdfGeneralizedLabelRecovery(){useLayoutEffect(()=>{let dead=false,latest=null,runId=null,dispatching=false,observer=null;const commit=(base={})=>{if(dead||!latest||!runId||window[RUN_KEY]?.id!==runId)return;const merged={...base,...latest,__generalizedLabelRecoveryV1:true};if(!Object.keys(latest).length)return;dispatching=true;try{window[PDF_PRIORITY_KEY]=merged;window[QR_PRIORITY_KEY]=null;window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:merged}));}finally{dispatching=false;}};const onChange=e=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.type!=="file")return;if(input.dataset.pdfStructuredV3PassThrough==="1"||input.dataset.pdfNativeV2PassThrough==="1"||input.dataset.pdfNativePassThrough==="1")return;const file=input.files?.[0];if(!file||!(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")))return;runId=window[RUN_KEY]?.id||null;latest=null;const copy=file.slice(0,file.size,file.type);extract(copy).then(r=>{if(!dead&&window[RUN_KEY]?.id===runId)latest=r;}).catch(err=>console.warn("certificate generalized label recovery",err));observer?.disconnect();const root=statusBox()?.parentElement;if(root){observer=new MutationObserver(()=>{const t=statusBox()?.textContent||"";if(/フォールバック/.test(t))setTimeout(()=>commit(window[PDF_PRIORITY_KEY]||{}),0);});observer.observe(root,{subtree:true,childList:true,characterData:true});}};const onAuth=e=>{if(dispatching||!latest||window[RUN_KEY]?.id!==runId)return;const detail=e?.detail;if(!detail||typeof detail!=="object"||detail.__generalizedLabelRecoveryV1)return;commit(detail);};window.addEventListener("change",onChange,true);window.addEventListener(AUTH_EVENT,onAuth);return()=>{dead=true;observer?.disconnect();window.removeEventListener("change",onChange,true);window.removeEventListener(AUTH_EVENT,onAuth);};},[]);return null;}
