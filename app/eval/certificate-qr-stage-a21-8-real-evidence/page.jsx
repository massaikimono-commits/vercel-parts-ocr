"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {runPhotoQrA212Counterfactual} from "../certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated";
import {A213_FIXED_IDS,buildA213Detail,buildA213Summary} from "../certificate-qr-stage-a21-3-evidence/contract.mjs";
import {sanitizeA214Detail} from "../certificate-qr-stage-a21-4-evidence/contract.mjs";
import {evaluateA217Counterfactual} from "../../../scripts/photo-qr-stage-a21-7-structure-counterfactual.mjs";
import {evaluateA218AdoptionReadiness} from "../../../scripts/photo-qr-stage-a21-8-adoption-readiness.mjs";

function normalizeFixedName(file){
 const leaf=String(file?.name||"").normalize("NFKC").trim().split(/[\\/]/).pop()||"";
 const m=leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
 return m?`IMG_${m[1]}.jpeg`:null;
}
function mapFixedSet(files){
 if(files.length!==8)return{valid:false,rows:[],message:`固定評価8枚を一度に選択してください（現在 ${files.length}枚）。`};
 const exact=new Map();let duplicate=false;
 for(const file of files){const id=normalizeFixedName(file);if(id&&exact.has(id))duplicate=true;if(id&&!exact.has(id))exact.set(id,file);}
 if(!duplicate&&exact.size===8&&A213_FIXED_IDS.every(id=>exact.has(id)))return{valid:true,rows:A213_FIXED_IDS.map(id=>({id,file:exact.get(id)})),strategy:"filename"};
 const sorted=[...files].sort((a,b)=>Number(a.lastModified||0)-Number(b.lastModified||0)||String(a.name).localeCompare(String(b.name)));
 return{valid:true,rows:A213_FIXED_IDS.map((id,i)=>({id,file:sorted[i]})),strategy:"ios-metadata"};
}
function failedResult(error){
 const msg=String(error?.message||error||"unknown");
 const base={physicalUniqueQrCount:0,netNewCanonicalQrCount:0,lostCurrentQrCount:0,countingIntegrityFail:false,runtimeMs:0};
 return{current:{...base},a:{...base,structuralPassCount:0,structuralPassAttribution:[],structuralPassAttributionComplete:true},b:{...base,actualRawDecodeSuccessCount:0},c:{...base,jsqrRawSuccessCount:0,zxingRawSuccessCount:0,rawSuccessEvidence:[],rawSuccessEvidenceComplete:true},diagnosticError:msg,gtUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeLogicChanged:false,diagnosticOnly:true};
}
function compactGroup(g){return{imageId:g.imageId,candidateIndex:g.candidateIndex,fingerprint:g.fingerprint,decoders:g.decoders,variants:g.variants,decoderAgreement:g.decoderAgreement,samePhysicalReproduction:g.samePhysicalReproduction,currentCollision:g.currentCollision,privacySafe:g.privacySafe,structurallyClean:g.structurallyClean,classCounts:g.classCounts,nonAsciiPositions:g.nonAsciiPositions,nonAsciiRuns:g.nonAsciiRuns,separatorPositions:g.separatorPositions,asciiNonAsciiPattern:g.asciiNonAsciiPattern,positionClassMask:g.positionClassMask,counterfactualEligibility:g.counterfactualEligibility};}

export default function A218RealEvidencePage(){
 const[files,setFiles]=useState([]),[running,setRunning]=useState(false),[status,setStatus]=useState("固定8枚を一度だけ選択すると自動実行します。追加の開始操作はありません。"),[result,setResult]=useState(null);
 const started=useRef(false);const mapping=useMemo(()=>mapFixedSet(files),[files]);
 useEffect(()=>{
  if(!mapping.valid||running||started.current)return;
  started.current=true;
  (async()=>{
   setRunning(true);
   try{
    const evaluationHead=process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA||null;
    const records=[];
    for(let i=0;i<mapping.rows.length;i++){
      const row=mapping.rows[i];setStatus(`${i+1}/8 ${row.id}: privacy-safe character-class evidence取得中…`);
      try{const r=await runPhotoQrA212Counterfactual(row.file);records.push({imageId:row.id,diagnosticError:null,result:r});}
      catch(e){records.push({imageId:row.id,diagnosticError:{name:String(e?.name||"Error"),message:String(e?.message||e||"unknown")},result:failedResult(e)});}
    }
    const formalSummary=buildA213Summary({evaluationHead,records});
    const detail=sanitizeA214Detail(buildA213Detail({evaluationHead,records}));
    const a217=evaluateA217Counterfactual(detail);
    const a218=evaluateA218AdoptionReadiness(a217,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"NOT_RUN"});
    const compact={schema:"icb-certificate-qr-stage-a21-8-fixed8-real-summary-v1",evaluationHead,runPolicy:"AUTHORIZED_FIXED8_SINGLE_RUN",mappingStrategy:mapping.strategy,selectedImageCount:8,diagnosticErrorImageCount:formalSummary.diagnosticErrorImageCount,formal:{current:formalSummary.formal.current,expected:47,preserved:formalSummary.formal.preserved,countingIntegrityFail:formalSummary.formal.countingIntegrityFail},A217:{eligibleGroupCount:a217.eligibleGroupCount,eligibleUniqueFingerprintCount:a217.eligibleUniqueFingerprintCount,sharedSchemaAcrossEligibleGroups:a217.sharedSchemaAcrossEligibleGroups,projected31of47Candidate:a217.projected31of47Candidate,groups:a217.groups.map(compactGroup)},A218:a218,privacy:{rawPayloadIncluded:false,payloadFragmentIncluded:false,unicodeCodePointsIncluded:false,canonicalPayloadIncluded:false},protection:{formalParserChanged:false,formalDecoderChanged:false,acceptanceGateChanged:false,frozen:"HOLD",main:"HOLD",production:"HOLD",adoptedHead:null}};
    const text=JSON.stringify(compact);
    if(text.length>6000)throw new Error(`A218_SUMMARY_TOO_LONG_${text.length}`);
    setResult({compact,text});
    setStatus("fixed8 1run完了。再runしないでください。総合管理用短縮summaryをコピーできます。");
   }catch(e){setStatus(`FAIL: ${e?.message||e}。自動再runはしません。`);}finally{setRunning(false);}
  })();
 },[mapping,running]);
 const copy=async()=>{if(!result)return;await navigator.clipboard.writeText(result.text);setStatus(`総合管理用短縮summaryをコピーしました（${result.text.length}/6000文字）。`);};
 return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:900,margin:"0 auto",padding:16}}>
  <h1 style={{fontSize:22}}>Stage A21.8 fixed8 Real Evidence</h1>
  <p style={{fontSize:13,fontWeight:800}}>総合管理GO済みの固定8枚1run専用。raw payload・payload fragment・Unicode code point・PII文字列は保存/表示しません。</p>
  <section style={{border:"1px solid #aaa",borderRadius:12,padding:12}}>
   <input type="file" accept="image/*" multiple disabled={running||started.current} onChange={e=>setFiles([...e.target.files])}/>
   <div style={{marginTop:8,fontSize:13,fontWeight:800}}>{mapping.valid?"8枚を自動対応しました。選択直後に自動評価します。":mapping.message}</div>
   <div style={{marginTop:8,fontSize:13,fontWeight:800}}>{status}</div>
  </section>
  {result&&<section style={{marginTop:14,border:"1px solid #6a8",borderRadius:12,padding:12}}>
   <div style={{fontWeight:900}}>A21.8判定: {result.compact.A218.status}</div>
   <div style={{marginTop:6,fontSize:13}}>Formal {result.compact.formal.current}/47 / preserved {String(result.compact.formal.preserved)}</div>
   <div style={{marginTop:4,fontSize:13}}>A21.7 eligible groups {result.compact.A217.eligibleGroupCount} / unique fingerprint {result.compact.A217.eligibleUniqueFingerprintCount} / shared schema {String(result.compact.A217.sharedSchemaAcrossEligibleGroups)}</div>
   <div style={{marginTop:4,fontSize:13}}>31/47 candidate {String(result.compact.A217.projected31of47Candidate)}</div>
   <div style={{marginTop:4,fontSize:13}}>blockers: {result.compact.A218.blockers.join(", ")||"none"}</div>
   <button onClick={copy} style={{marginTop:10,width:"100%",padding:12,fontWeight:900}}>総合管理用短縮summaryをコピー</button>
  </section>}
 </main>;
}
