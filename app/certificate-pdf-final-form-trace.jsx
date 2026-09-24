"use client";

// Diagnostic-only A→H observer. It never mutates parser output or form state.
import { useEffect } from "react";
import { getCertificatePdfFieldProvenance } from "./certificate-pdf-field-provenance";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PANEL_ID = "certificate-pdf-final-form-trace";
const FIELDS = [
  "maxPayloadKg","vehicleWeightKg","grossVehicleWeightKg","lengthCm","widthCm","heightCm",
  "frontFrontAxleWeightKg","frontRearAxleWeightKg","rearFrontAxleWeightKg","rearRearAxleWeightKg",
  "engineModel","displacementOrRatedOutput","modelDesignationNumber","classificationNumber",
  "userName","userAddress","ownerName","ownerAddress","baseLocation"
];
const LABELS = {
  maxPayloadKg:"最大積載量 kg",vehicleWeightKg:"車両重量 kg",grossVehicleWeightKg:"車両総重量 kg",
  lengthCm:"長さ cm",widthCm:"幅 cm",heightCm:"高さ cm",frontFrontAxleWeightKg:"前前軸重 kg",
  frontRearAxleWeightKg:"前後軸重 kg",rearFrontAxleWeightKg:"後前軸重 kg",rearRearAxleWeightKg:"後後軸重 kg",
  engineModel:"原動機の型式",displacementOrRatedOutput:"総排気量又は定格出力",modelDesignationNumber:"型式指定番号",
  classificationNumber:"類別区分番号",userName:"使用者の氏名又は名称",userAddress:"使用者の住所",
  ownerName:"所有者の氏名又は名称",ownerAddress:"所有者の住所",baseLocation:"使用の本拠の位置"
};
const compact = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
function enabled(){try{const host=location.hostname.toLowerCase();return(host==="localhost"||host==="127.0.0.1"||host.endsWith(".vercel.app"))&&new URLSearchParams(location.search).get("certificatePdfDataFlow")==="1";}catch{return false;}}
function inputByLabel(label){for(const node of document.querySelectorAll("label")){const span=node.querySelector("span");const text=span?.textContent||node.childNodes?.[0]?.textContent||"";if(compact(text)===compact(label))return node.querySelector("input,select,textarea");}return null;}
function formSnapshot(){const result={};for(const field of FIELDS){const el=inputByLabel(LABELS[field]);result[field]=el?String(el.value??""):null;}return result;}
function stageSnapshot(){const trace=getCertificatePdfFieldProvenance();const result={};for(const field of FIELDS){const item=trace?.fields?.[field];result[field]={A_raw:item?.rawItems?.map(x=>x.str).filter(Boolean)??[],B_generic:item?.stages?.canonical?.provenance?.decision?.source==="generic-structural"?item?.stages?.canonical?.output??null:null,C_canonical:item?.stages?.canonical?.output??null,D_semantic:item?.stages?.semantic?.output??null,E_specialized:item?.stages?.weight?.output??item?.stages?.displacement?.output??null,F_final:item?.final?.finalSelectedValue??null,applyPatch:item?.final?.applyPatchValue??null};}return result;}
function ensurePanel(){let panel=document.getElementById(PANEL_ID);if(panel)return panel;panel=document.createElement("section");panel.id=PANEL_ID;panel.style.cssText="position:fixed;z-index:2147483001;left:8px;right:8px;top:8px;max-height:40vh;overflow:auto;padding:10px;border:2px solid #7c3aed;border-radius:10px;background:#fff;color:#2e1065;font:12px/1.4 monospace";panel.innerHTML='<strong>PDF Runtime Data-Flow A→H</strong><div style="display:flex;gap:8px;margin:8px 0"><button type="button" data-copy>Traceをコピー</button><button type="button" data-close>閉じる</button></div><textarea readonly style="width:100%;min-height:180px;font:11px/1.35 monospace"></textarea>';panel.querySelector("[data-close]").onclick=()=>panel.remove();panel.querySelector("[data-copy]").onclick=async()=>{const text=panel.querySelector("textarea").value;try{await navigator.clipboard.writeText(text);}catch{panel.querySelector("textarea").focus();panel.querySelector("textarea").select();}};document.body.appendChild(panel);return panel;}
export default function CertificatePdfFinalFormTrace(){useEffect(()=>{if(!enabled())return;let sequence=0;const onFinal=(event)=>{const detail=event?.detail;if(!detail||detail.__certificatePdfFinalOwner!=="structured-v3")return;const id=++sequence;const payload=Object.fromEntries(FIELDS.map(k=>[k,detail[k]??null]));const stages=stageSnapshot();const capture=(delay)=>setTimeout(()=>{if(id!==sequence)return;const hydrated=formSnapshot();const mismatches=FIELDS.filter(k=>String(payload[k]??"")!==String(hydrated[k]??""));const output={schema:"certificate-pdf-runtime-data-flow-v1",runId:detail.__certificatePdfRunId??null,delayMs:delay,checkpoints:{A_to_F:stages,G_finalEventPayload:payload,H_formHydration:hydrated},payloadToHydrationMismatches:mismatches,notes:{nullHydration:"field is not rendered in current form",diagnosticOnly:true}};const panel=ensurePanel();panel.querySelector("textarea").value=JSON.stringify(output,null,2);},delay);capture(0);capture(80);capture(250);};window.addEventListener(AUTH_EVENT,onFinal);return()=>window.removeEventListener(AUTH_EVENT,onFinal);},[]);return null;}
