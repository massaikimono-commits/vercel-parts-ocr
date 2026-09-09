"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const FIXED_IDS = Array.from({ length: 8 }, (_, i) => `IMG_${String(940 + i).padStart(4, "0")}.jpeg`);
const RUN_IDS = ["IMG_0940.jpeg","IMG_0941.jpeg","IMG_0943.jpeg","IMG_0945.jpeg","IMG_0946.jpeg","IMG_0947.jpeg"];
const RUN_SET = new Set(RUN_IDS);
const SKIP_IDS = new Set(["IMG_0942.jpeg","IMG_0944.jpeg"]);
const DIAGNOSTIC_ROUTE = "/eval/certificate-qr-decode-experiment";
const SUMMARY_SCHEMA = "icb-certificate-qr-minimal-diagnostic-summary-v1";

const EXISTING_EVIDENCE = {
  "IMG_0942.jpeg": { source:"existing-diagnostic-evidence", candidateCount:10, ownership:{A:3,B:4,C:2,D:1}, rerun:false },
  "IMG_0944.jpeg": { source:"existing-diagnostic-evidence", candidateCount:5, ownership:{A:2,B:3,C:0,D:0}, rerun:false },
};

function normalizeFixedName(file){
  const leaf=String(file?.name||"").normalize("NFKC").trim().split(/[\\/]/).pop()||"";
  const match=leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
  return match?`IMG_${match[1]}.jpeg`:null;
}

function mapFixedSet(files){
  if(files.length!==8) return {mode:"invalid",rows:[],valid:false,message:`固定評価8枚をまとめて選択してください（現在 ${files.length}枚）。`};
  const exact=new Map();
  let duplicate=false;
  for(const file of files){
    const id=normalizeFixedName(file);
    if(id&&exact.has(id)) duplicate=true;
    if(id&&!exact.has(id)) exact.set(id,file);
  }
  if(!duplicate&&exact.size===8&&FIXED_IDS.every((id)=>exact.has(id))){
    return {mode:"filename",rows:FIXED_IDS.map((id)=>({id,file:exact.get(id),source:"File.name"})),valid:true,message:"固定8枚を正式IMG番号へ自動対応しました。サムネイルだけ確認してください。"};
  }
  const sorted=[...files].sort((a,b)=>Number(a.lastModified||0)-Number(b.lastModified||0)||String(a.name).localeCompare(String(b.name)));
  return {mode:"metadata-fallback",rows:FIXED_IDS.map((id,i)=>({id,file:sorted[i],source:"metadata-fallback"})),valid:true,message:"iOSで正式IMG番号を保持していないためmetadata順で対応しました。8枚のサムネイルが固定評価セットであることだけ確認してください。"};
}

function sleep(ms){ return new Promise((resolve)=>setTimeout(resolve,ms)); }

function findAdditionalResultsFromReact(doc){
  const seen=new Set();
  const nodes=[doc.documentElement,...doc.querySelectorAll("main,section,div")];
  for(const node of nodes){
    for(const key of Object.keys(node||{})){
      if(!key.startsWith("__reactFiber$")) continue;
      let fiber=node[key];
      while(fiber&&!seen.has(fiber)){
        seen.add(fiber);
        let hook=fiber.memoizedState;
        let guard=0;
        while(hook&&guard++<80){
          const value=hook.memoizedState;
          if(Array.isArray(value)&&value.length>0&&value.every((item)=>item&&typeof item==="object"&&item.slotId&&item.baseline&&item.matrix)) return value;
          hook=hook.next;
        }
        fiber=fiber.return;
      }
    }
  }
  return null;
}

function countAttempts(rows,key,predicate){
  let n=0;
  for(const row of rows||[]) for(const attempt of row?.[key]||[]) if(predicate(attempt,row)) n+=1;
  return n;
}

function summarizeMatrix(id,result){
  const m=result?.matrix||{};
  const current=m.currentEnsemble||{};
  const geometry=m.geometryStage||{};
  const compact=m.compactSchemaAudit||{};
  const conflicts=m.conflictPositionAudit||{};
  const structural=m.structuralValidationAudit||{};
  const rows=current.rows||[];
  const geoRows=geometry.rows||[];
  const geoDiag=geometry.diagnostics||[];
  const rawDecodeAttempts=countAttempts(rows,"currentAttempts",(a)=>Boolean(a?.jsqrSuccess||a?.zxingSuccess));
  const jsOnly=countAttempts(rows,"currentAttempts",(a)=>Boolean(a?.jsqrSuccess&&!a?.zxingSuccess));
  const zxingOnly=countAttempts(rows,"currentAttempts",(a)=>Boolean(!a?.jsqrSuccess&&a?.zxingSuccess));
  const both=countAttempts(rows,"currentAttempts",(a)=>Boolean(a?.jsqrSuccess&&a?.zxingSuccess));
  const candidateOwnership=(rows||[]).map((row)=>({
    candidateIndex:row.candidateIndex??null,
    decodeAccepted:Boolean(row.currentSuccess),
    rawDecodeObserved:Boolean((row.currentAttempts||[]).some((a)=>a?.jsqrSuccess||a?.zxingSuccess)),
    attemptCount:(row.currentAttempts||[]).length,
  }));
  const finderAtLeast3NoQuad=Number(geometry.finderAtLeast3ButNoValidQuadCount||0);
  const alternateRecovered=Number(geometry.alternateTripletRecoveredCount||0);
  const finalCount=Number(geometry.finalUnionCanonicalCount||0);
  const aCount=Number(current.physicalSafeQrCount||0);
  const parserEligible=Number(geometry.parserEligibleUnionCanonicalCount||0);
  const multiQr=Number(conflicts.multiQrCropConflictCount||0);
  const samePosition=Number(conflicts.samePhysicalQrConflictCount||0);
  const ambiguous=Number(conflicts.remainingAmbiguousConflictCount||0);
  const structuralReject=Number(structural.nonConflictStructuralRejectedCandidateCount||current.nonConflictStructuralRejectedCandidateCount||0);
  const rawCandidates=Number(structural.rawDecodeCandidateCount||current.rawDecodeCandidateCount||rawDecodeAttempts||0);
  let provisionalCause="undetermined";
  if(finalCount===0&&finderAtLeast3NoQuad>0) provisionalCause="finder-detected-but-no-valid-quad / geometry";
  else if(finalCount===0&&rawDecodeAttempts>0) provisionalCause="decode-observed-but-structural/parser-rejected";
  else if(multiQr>0||ambiguous>0) provisionalCause="multi-qr-interference-or-position-conflict";
  else if(finalCount<aCount) provisionalCause="geometry-stage-regression-or-dedupe";
  else if(parserEligible<finalCount) provisionalCause="parser-eligibility-gap";
  else if(finalCount>0) provisionalCause="partial-or-successful-decode; inspect remaining candidate failures";

  return {
    imageId:id.replace("IMG_","").replace(".jpeg",""),
    formalImageId:id,
    decodedQrCount:finalCount,
    baselineQrCount:Number(result?.baseline?.qrCount||0),
    aPhysicalSafeQrCount:aCount,
    candidateOwnership,
    detectedDecodeFail:{rawDecodeAttemptCount:rawDecodeAttempts,rawCandidateCount:rawCandidates,acceptedCandidateCount:candidateOwnership.filter((x)=>x.decodeAccepted).length},
    cropCoverage:{candidateCount:rows.length,geometryCandidateCount:geoRows.length,diagnosticAvailable:rows.length>0},
    resolution:{source:"existing decode configs",attemptCount:countAttempts(rows,"currentAttempts",()=>true),diagnosticAvailable:rows.length>0},
    finderQuad:{finderAtLeast3ButNoValidQuadCount:finderAtLeast3NoQuad,alternateTripletRecoveredCount:alternateRecovered,geometryDiagnosticCount:geoDiag.length},
    anglePerspective:{geometryDiagnosticCount:geoDiag.length,perspectiveRectifyAttemptCount:countAttempts(geoRows,"geometryAttempts",()=>true)},
    quietZone:{source:"geometry/config trace",diagnosticAvailable:geoDiag.length>0},
    contrast:{source:"decode-attempt trace",diagnosticAvailable:rows.length>0},
    multiQrInterference:{multiQrCropConflictCount:multiQr,samePhysicalQrConflictCount:samePosition,remainingAmbiguousConflictCount:ambiguous},
    decoderDifference:{jsOnlySuccessAttemptCount:jsOnly,zxingOnlySuccessAttemptCount:zxingOnly,bothSuccessAttemptCount:both},
    parserReject:{parserEligibleUnionQrCount:parserEligible,compactParserRecognizedCount:Number(compact.compactParserRecognizedCount||0),structuralRejectedCandidateCount:structuralReject},
    dedupeCounting:{duplicatePayloadCandidateCount:Number(current.duplicatePayloadCandidateCount||0),countingIntegrityFail:null,expectedCountUsedDuringDecode:false},
    nearThreshold:{available:Boolean(m.img0942NearThresholdCounterfactualRescue),note:"no GT/runtime threshold use"},
    provisionalCause,
  };
}

export default function CertificateQrMinimalDiagnosticPage(){
  const [files,setFiles]=useState([]);
  const [thumbs,setThumbs]=useState({});
  const [status,setStatus]=useState("固定評価8枚をまとめて選択してください。");
  const [running,setRunning]=useState(false);
  const [iframeReady,setIframeReady]=useState(false);
  const [summary,setSummary]=useState(null);
  const frameRef=useRef(null);
  const mapping=useMemo(()=>mapFixedSet(files),[files]);

  useEffect(()=>{
    const next={};
    for(const row of mapping.rows||[]) next[row.id]=URL.createObjectURL(row.file);
    setThumbs(next);
    return()=>{for(const url of Object.values(next)) URL.revokeObjectURL(url);};
  },[mapping]);

  const runMinimal=async()=>{
    if(!mapping.valid||!iframeReady||running)return;
    setRunning(true); setSummary(null);
    try{
      const evaluationHead=new URLSearchParams(window.location.search).get("head")||null;
      if(!/^[0-9a-f]{40}$/i.test(String(evaluationHead||""))) throw new Error("Preview HEADがURLへ固定されていません。管理側Preview URLを開き直してください。");
      const win=frameRef.current?.contentWindow;
      const doc=frameRef.current?.contentDocument;
      if(!win||!doc) throw new Error("診断エンジンの準備ができていません。");
      const sections=[...doc.querySelectorAll("section")];
      const additionalSection=sections.find((s)=>String(s.textContent||"").includes("追加実車写真 Photo Decode評価"));
      if(!additionalSection) throw new Error("内部diagnostic batchを取得できませんでした。");
      const input=additionalSection.querySelector('input[type="file"][multiple]');
      const button=[...additionalSection.querySelectorAll("button")].find((b)=>String(b.textContent||"").includes("追加実車 Photo Decode開始"));
      if(!input||!button) throw new Error("内部diagnostic batch controlが見つかりません。");
      const runRows=mapping.rows.filter((row)=>RUN_SET.has(row.id));
      if(runRows.length!==6) throw new Error(`Minimal batch input不整合: ${runRows.length}/6`);
      const dt=new win.DataTransfer();
      for(const row of runRows) dt.items.add(row.file);
      input.files=dt.files;
      input.dispatchEvent(new win.Event("change",{bubbles:true}));
      let selectedReady=false;
      for(let i=0;i<40;i+=1){
        if(String(additionalSection.textContent||"").includes("6枚 選択")){ selectedReady=true; break; }
        await sleep(100);
      }
      if(!selectedReady) throw new Error("内部batch selectedImageCountを6へ固定できませんでした。");
      setStatus("Minimal Diagnostic実行中… 6枚だけを診断しています。0942 / 0944は投入していません。");
      button.click();
      let completed=false;
      for(let i=0;i<1800;i+=1){
        const text=String(doc.body?.textContent||"");
        if(text.includes("追加実車写真のdecode完了")){ completed=true; break; }
        if(text.includes("停止:")) throw new Error("内部diagnosticが停止しました。");
        await sleep(250);
      }
      if(!completed) throw new Error("Minimal Diagnosticが時間内に完了しませんでした。");
      const internalResults=findAdditionalResultsFromReact(doc);
      if(!Array.isArray(internalResults)||internalResults.length!==6) throw new Error(`診断結果復元失敗: ${Array.isArray(internalResults)?internalResults.length:"0"}/6`);
      const perImageDiagnostics=internalResults.map((result,index)=>summarizeMatrix(RUN_IDS[index],result));
      if(perImageDiagnostics.length!==6) throw new Error("perImageDiagnostics件数不整合");
      const out={
        schema:SUMMARY_SCHEMA,
        evaluationHead,
        formalReference:{finalSafeUnion:28,expectedQrCount:47,preserved:true,newFormalEvaluation:false},
        selectedImageCount:6,
        selectedImageIds:RUN_IDS.map((id)=>id.replace("IMG_","").replace(".jpeg","")),
        decodedImageCount:internalResults.length,
        perImageDiagnostics,
        existingEvidence:{
          "0942":{...EXISTING_EVIDENCE["IMG_0942.jpeg"]},
          "0944":{...EXISTING_EVIDENCE["IMG_0944.jpeg"]},
        },
        isolation:{groundTruthScoringOnly:true,groundTruthUsedDuringDecode:false,formalDecodeLogicChanged:false,recognitionLogicChanged:false},
        protection:{frozen:"HOLD",production:"HOLD",candidateLock:"NOT EVALUATED / HOLD",physicalSlot:"HOLD",adoptedHead:null},
      };
      if(out.selectedImageCount!==6||out.selectedImageIds.length!==6||out.perImageDiagnostics.length!==6) throw new Error("Minimal summary invariant FAIL");
      setSummary(out);
      setStatus("完了。下の「総合管理用短縮summaryをコピー」だけ押してください。");
    }catch(error){
      setSummary(null);
      setStatus(`FAIL: ${error?.message||error}`);
    }finally{ setRunning(false); }
  };

  const copySummary=async()=>{
    if(!summary)return;
    await navigator.clipboard.writeText(JSON.stringify(summary,null,2));
    setStatus("総合管理用短縮summaryをコピーしました。ChatGPTへそのまま貼り付けてください。");
  };

  return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:980,margin:"0 auto",padding:16}}>
    <h1 style={{fontSize:22,marginBottom:6}}>Photo QR Minimal Diagnostic</h1>
    <div style={{fontSize:13,fontWeight:800}}>操作は「8枚選択 → 開始 → summaryコピー」だけです。</div>
    <div style={{fontSize:12,marginTop:5}}>Formal 28/47 preserved / 0942・0944は既存証拠利用 / recognition logic変更なし</div>

    <section style={{marginTop:14,border:"1px solid #aaa",borderRadius:12,padding:12}}>
      <label style={{display:"block",fontWeight:850,fontSize:15}}>① 固定評価8枚をまとめて選択</label>
      <input type="file" accept="image/*" multiple disabled={running} onChange={(e)=>{setFiles([...e.target.files]);setSummary(null);setStatus("8枚を確認中…");}} style={{marginTop:8}} />
      <div style={{marginTop:8,fontSize:13,fontWeight:700}}>{mapping.message}</div>
      {mapping.valid&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:12}}>
          {mapping.rows.map((row)=><div key={row.id} style={{border:SKIP_IDS.has(row.id)?"2px solid #999":"2px solid #2f6fe4",borderRadius:10,padding:7,background:SKIP_IDS.has(row.id)?"#f4f4f4":"#fff"}}>
            <div style={{fontFamily:"monospace",fontSize:12,fontWeight:900}}>{row.id}</div>
            <div style={{fontSize:11,fontWeight:800,margin:"3px 0"}}>{SKIP_IDS.has(row.id)?"既存証拠を利用":"Minimal診断対象"}</div>
            {thumbs[row.id]&&<img src={thumbs[row.id]} alt={row.id} style={{display:"block",width:"100%",height:110,objectFit:"contain",background:"#eee",borderRadius:7}} />}
          </div>)}
        </div>
        <button onClick={runMinimal} disabled={!iframeReady||running} style={{marginTop:12,width:"100%",padding:"13px 16px",fontSize:17,fontWeight:900}}>
          {running?"Minimal Diagnostic実行中…":"② Minimal Diagnostic開始"}
        </button>
      </>}
      <div style={{marginTop:10,fontWeight:800,fontSize:13}}>{status}</div>
      {summary&&<button onClick={copySummary} style={{marginTop:12,width:"100%",padding:"13px 16px",fontSize:17,fontWeight:900}}>③ 総合管理用短縮summaryをコピー</button>}
    </section>

    <iframe ref={frameRef} title="hidden Photo QR diagnostic engine" src={`${DIAGNOSTIC_ROUTE}?minimalDiagnosticEngine=1`} onLoad={()=>setIframeReady(true)} aria-hidden="true" tabIndex={-1} style={{position:"absolute",width:1,height:1,border:0,opacity:0,pointerEvents:"none",left:-9999,top:-9999}} />
  </main>;
}
