"use client";

import {useEffect,useState} from "react";
import {A215_STORAGE_SOURCE,A215_RULE,evaluateA215} from "./contract.mjs";

export default function A215Page(){
 const[result,setResult]=useState(null),[status,setStatus]=useState("A21.4保存evidenceを読み込みます。固定8枚の再runは不要です。"),[loaded,setLoaded]=useState(false);
 useEffect(()=>{try{const raw=localStorage.getItem(A215_STORAGE_SOURCE);if(!raw){setStatus("A21.4保存evidenceがこのoriginにありません。A21.4と同じbranch aliasで開いてください。再runはしないでください。");return;}const detail=JSON.parse(raw);const r=evaluateA215(detail);setResult(r);setLoaded(true);setStatus("A21.5 compact-format acceptance counterfactual判定完了。Formal parser/decoderは未変更です。");}catch(e){setStatus(`A21.5判定FAIL: ${e?.message||e}`);}},[]);
 const copy=async()=>{if(!result)return;const text=JSON.stringify(result);if(text.length>6000)throw new Error("summary length guard");await navigator.clipboard.writeText(text);setStatus(`総合管理用A21.5 summaryをコピーしました（${text.length}/6000文字）。`);};
 return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:900,margin:"0 auto",padding:16}}>
  <h1 style={{fontSize:22}}>Stage A21.5 Compact Acceptance Counterfactual</h1>
  <p style={{fontSize:13,fontWeight:800}}>A21.4のprivacy-safe localStorage evidenceだけを再解析します。画像再選択・QR再decode・Formal parser変更は行いません。</p>
  <section style={{border:"1px solid #aaa",borderRadius:12,padding:12}}>
   <div style={{fontSize:13,fontWeight:800}}>{status}</div>
   <div style={{marginTop:8,fontSize:12}}>rule: {A215_RULE.name}</div>
  </section>
  {loaded&&result&&<section style={{marginTop:14,border:"1px solid #6a8",borderRadius:12,padding:12}}>
   <div style={{fontWeight:900}}>A21.5 Counterfactual Result</div>
   <div style={{marginTop:8,fontSize:14}}>source raw success: {result.sourceRawSuccessCount}</div>
   <div style={{fontSize:14}}>source unique fingerprint: {result.sourceUniqueFingerprintCount}</div>
   <div style={{fontSize:14}}>source STRONG: {result.sourceStrongGroupCount}</div>
   <div style={{marginTop:8,fontSize:16,fontWeight:900}}>compact accepted unique fingerprint: {result.acceptedUniqueFingerprintCount}</div>
   <div style={{fontSize:16,fontWeight:900}}>accepted physical group: {result.acceptedUniquePhysicalGroupCount}</div>
   <div style={{fontSize:13}}>images: {(result.acceptedImages||[]).join(", ")||"none"}</div>
   <div style={{marginTop:8,fontSize:13}}>Formal 28/47 preserved: {String(result.projected.formal28of47Preserved)}</div>
   <div style={{fontSize:13}}>Formal parser changed: {String(result.isolation.formalParserChanged)}</div>
   <div style={{fontSize:13}}>rerun required: {String(result.isolation.rerunRequired)}</div>
   <button onClick={copy} style={{marginTop:12,width:"100%",padding:12,fontWeight:900}}>総合管理用A21.5 summaryをコピー</button>
  </section>}
 </main>;
}
