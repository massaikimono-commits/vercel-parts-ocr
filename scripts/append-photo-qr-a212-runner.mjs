import fs from "node:fs";

const corePath="app/eval/certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated.js";
if(!fs.existsSync(corePath)) throw new Error("generated Photo QR core missing");
let core=fs.readFileSync(corePath,"utf8");
if(core.includes("export async function runPhotoQrA212Counterfactual")){
  console.log("Stage A21.2 runner already appended");
  process.exit(0);
}

const a212=String.raw`
function a212Hypotheses(base){
  const unresolved=(base.geometry?.diagnostics||[]).filter(g=>!g?.skippedBecauseASuccess&&!g?.skippedBecausePhysicalConsensus);
  return unresolved.map(g=>({
    candidateIndex:g?.candidateIndex??null,
    x:g?.x??null,y:g?.y??null,
    finderCount:Number(g?.finderCount||0),
    geometryValid:Boolean(g?.geometryValid),
    overlapRejected:Boolean(g?.overlapRejected),
    geometryFailReason:g?.geometryFailReason||null,
    ownershipState:g?.overlapRejected?"physical-overlap":g?.geometryValid?"geometry-position-hypothesis":Number(g?.finderCount||0)>=3?"finder-position-hypothesis":"candidate-position-hypothesis",
    source:g,
  }));
}
function a212SafeCanonicals(result){
  return unionCanonicalSets(result?.canonicalSet,result?.compactCanonicalSet);
}
function a212RawSuccessCount(result){return Number(Boolean(result?.jsqrSuccess))+Number(Boolean(result?.zxingSuccess));}
function a212StructuralPassCount(result){return Number(Boolean(result?.jsqrSuccess&&result?.jsStructuralPass))+Number(Boolean(result?.zxingSuccess&&result?.zxingStructuralPass));}
function a212StructuralRejectCount(result){return Number(Boolean(result?.jsqrSuccess&&!result?.jsStructuralPass))+Number(Boolean(result?.zxingSuccess&&!result?.zxingStructuralPass));}
function a212CanonicalList(result){return [...a212SafeCanonicals(result)].filter(Boolean);}
function a212AddNetNew({canonicals,currentFinal,accepted,position,radius,counters}){
  for(const canonical of canonicals||[]){
    if(!canonical) continue;
    if(currentFinal.has(canonical)||accepted.has(canonical)){counters.duplicateRejectedCount+=1;continue;}
    if(position){
      const conflict=[...accepted.values()].some(v=>v.position&&Math.hypot(Number(v.position.x)-Number(position.x),Number(v.position.y)-Number(position.y))<=radius&&v.canonical!==canonical);
      if(conflict){counters.positionConflictRejectedCount+=1;continue;}
    }
    accepted.set(canonical,{canonical,position:position||null});
  }
}
function a212TripletGeometry(t){
  const modulePx=Number(t?.modulePx||0),dimension=Number(t?.qrDimension||0);
  if(!modulePx||!dimension||!Array.isArray(t?.qrQuad)||t.qrQuad.length!==4)return null;
  return {geometryValid:true,qrQuad:t.qrQuad,quietQuad:t.quietQuad,qrDimension:dimension,modulePx,perspectiveScaleSpread:Number(t?.perspectiveScaleSpread||0)};
}
function a212NormalizedGate(t){
  const modulePx=Number(t?.modulePx||0),dimension=Number(t?.qrDimension||0),side=quadSideMetricsFromDiagnostic(t?.qrQuad||[]);
  if(!modulePx||!dimension||!side)return{pass:false,reason:"missing-normalized-geometry"};
  const sideRatio=(side.minSidePx/modulePx)/dimension;
  const areaRatio=(side.areaPx2/(modulePx*modulePx))/(dimension*dimension);
  const spread=Number(t?.perspectiveScaleSpread||side.perspectiveScaleSpread||1);
  const pass=sideRatio>=.65&&sideRatio<=1.35&&areaRatio>=.42&&areaRatio<=1.85&&spread<=2.5;
  return{pass,sideRatio:Number(sideRatio.toFixed(4)),areaRatio:Number(areaRatio.toFixed(4)),spread:Number(spread.toFixed(4)),reason:pass?null:"normalized-gate-reject"};
}
async function a212DecodeCanvas(base,canvas){
  return decodeCanvasPair({jsQR:base.jsQR,reader:base.reader,canvas});
}
export async function runPhotoQrA212Counterfactual(file){
  const totalStarted=performance.now();
  const base=await a21PrepareBase(file);
  const currentRuntimeMs=Math.round(performance.now()-totalStarted);
  const currentAttemptCount=Number(base.current?.totalAttempts||0)+Number(base.geometry?.totalAttempts||0);
  const currentCount=base.currentFinal.size;
  const radius=Math.max(8,base.paperW*.018);
  const current={id:"CURRENT",physicalUniqueQrCount:currentCount,netNewCanonicalQrCount:0,lostCurrentQrCount:0,duplicateInflationCount:0,countingIntegrityFail:false,runtimeMs:currentRuntimeMs,attemptCount:currentAttemptCount};
  try{
    const aStarted=performance.now();
    const hypotheses=a212Hypotheses(base);
    const aAccepted=new Map();
    const aCounters={inputHypothesisCount:hypotheses.length,recoveryAttemptCount:0,decodeAttemptCount:0,rawDecodeSuccessCount:0,structuralPassCount:0,duplicateRejectedCount:0,positionConflictRejectedCount:0};
    const aPer=[];
    const currentRows=new Map((base.current?.rows||[]).map(r=>[r.candidateIndex,r]));
    for(const h of hypotheses){
      const item={candidateIndex:h.candidateIndex,ownershipState:h.ownershipState,recoveryAttemptCount:0,decodeAttemptCount:0,rawDecodeSuccessCount:0,structuralPassCount:0,netNewCanonicalCount:0,duplicateRejectedCount:0,positionConflictRejectedCount:0,results:[],error:null};
      const beforeNet=aAccepted.size,beforeDup=aCounters.duplicateRejectedCount,beforeConflict=aCounters.positionConflictRejectedCount;
      try{
        const attempts=[];
        if(h.geometryValid&&!h.overlapRejected) attempts.push({kind:"geometry-position-hypothesis",geometry:h.source,config:{id:"a212-a-geometry-native",outputScale:1,sampling:"bilinear"}});
        for(const t of h.source?.tripletDiagnostics||[]){
          if(!Array.isArray(t?.qrQuad)||t.qrQuad.length!==4)continue;
          if(h.ownershipState==="physical-overlap"||h.ownershipState==="finder-position-hypothesis"){
            const geometry=a212TripletGeometry(t);if(geometry)attempts.push({kind:h.ownershipState,geometry,config:{id:`a212-a-triplet-${t.rank??0}`,outputScale:1,sampling:"bilinear"},tripletRank:t.rank??null});
          }
        }
        if(!attempts.length){
          const row=currentRows.get(h.candidateIndex);
          if(row) for(const config of ENSEMBLE_CONFIGS.slice(0,1)) attempts.push({kind:"candidate-position-hypothesis",candidate:row,config});
        }
        for(const att of attempts){
          aCounters.recoveryAttemptCount++;item.recoveryAttemptCount++;
          let canvas=null;
          try{
            canvas=att.geometry?rectifyQrGeometry(base.raw,att.geometry,att.config):cropCandidate(base.raw,base.normalized.paper,att.candidate,att.config);
            if(!canvas){item.results.push({kind:att.kind,tripletRank:att.tripletRank??null,rectifyGenerated:false});continue;}
            aCounters.decodeAttemptCount++;item.decodeAttemptCount++;
            const result=await a212DecodeCanvas(base,canvas);
            const raw=a212RawSuccessCount(result),struct=a212StructuralPassCount(result);
            aCounters.rawDecodeSuccessCount+=raw;item.rawDecodeSuccessCount+=raw;aCounters.structuralPassCount+=struct;item.structuralPassCount+=struct;
            const pos=h.source?.qrCenter||((h.x!=null&&h.y!=null)?{x:h.x,y:h.y}:null);
            a212AddNetNew({canonicals:a212CanonicalList(result),currentFinal:base.currentFinal,accepted:aAccepted,position:pos,radius,counters:aCounters});
            item.results.push({kind:att.kind,tripletRank:att.tripletRank??null,rectifyGenerated:true,jsqrRawSuccess:Boolean(result.jsqrSuccess),zxingRawSuccess:Boolean(result.zxingSuccess),jsqrStructuralPass:Boolean(result.jsStructuralPass),zxingStructuralPass:Boolean(result.zxingStructuralPass),canonicalResult:a212CanonicalList(result)});
          }catch(e){item.results.push({kind:att.kind,tripletRank:att.tripletRank??null,error:String(e?.message||e)});}finally{if(canvas){canvas.width=1;canvas.height=1;}}
        }
      }catch(e){item.error=String(e?.message||e);}
      item.netNewCanonicalCount=aAccepted.size-beforeNet;item.duplicateRejectedCount=aCounters.duplicateRejectedCount-beforeDup;item.positionConflictRejectedCount=aCounters.positionConflictRejectedCount-beforeConflict;aPer.push(item);
    }
    const a={id:"A_PHYSICAL_SEPARATION",physicalUniqueQrCount:currentCount+aAccepted.size,netNewCanonicalQrCount:aAccepted.size,lostCurrentQrCount:0,duplicateInflationCount:0,countingIntegrityFail:false,runtimeMs:Math.round(performance.now()-aStarted),attemptCount:aCounters.decodeAttemptCount,...aCounters,perHypothesis:aPer};

    const bStarted=performance.now();
    const bAccepted=new Map();
    const bCounters={inspectedTripletCount:0,eligibleTripletCount:0,normalizedGatePassCount:0,normalizedGateRejectCount:0,actualRectifyAttemptCount:0,actualRectifyGeneratedCount:0,actualDecodeAttemptCount:0,actualRawDecodeSuccessCount:0,actualStructuralPassCount:0,actualDecodeFailCount:0,duplicateRejectedCount:0,positionConflictRejectedCount:0};
    const bDetails=[];
    for(const g of base.geometry?.diagnostics||[]){
      if(g?.skippedBecauseASuccess||g?.overlapRejected)continue;
      for(const t of g?.tripletDiagnostics||[]){
        bCounters.inspectedTripletCount++;
        if(t?.geometryValid||!["quad-too-small","quad-side-spread-too-large"].includes(t?.rejectedReason))continue;
        bCounters.eligibleTripletCount++;
        const gate=a212NormalizedGate(t);if(gate.pass)bCounters.normalizedGatePassCount++;else bCounters.normalizedGateRejectCount++;
        const d={candidateIndex:g.candidateIndex,tripletRank:t.rank??null,gate,...{rectifyAttempted:false,rectifyGenerated:false,decodeAttempted:false,rawDecodeSuccessCount:0,structuralPassCount:0,decodeFailed:false,canonicalResult:[],error:null}};
        if(!gate.pass){bDetails.push(d);continue;}
        bCounters.actualRectifyAttemptCount++;d.rectifyAttempted=true;let canvas=null;
        try{
          const geometry=a212TripletGeometry(t);canvas=geometry?rectifyQrGeometry(base.raw,geometry,{id:"a212-b-normalized",outputScale:1,sampling:"bilinear"}):null;
          if(!canvas){bDetails.push(d);continue;}bCounters.actualRectifyGeneratedCount++;d.rectifyGenerated=true;bCounters.actualDecodeAttemptCount++;d.decodeAttempted=true;
          const result=await a212DecodeCanvas(base,canvas);const raw=a212RawSuccessCount(result),struct=a212StructuralPassCount(result);d.rawDecodeSuccessCount=raw;d.structuralPassCount=struct;bCounters.actualRawDecodeSuccessCount+=raw;bCounters.actualStructuralPassCount+=struct;d.canonicalResult=a212CanonicalList(result);if(!raw){d.decodeFailed=true;bCounters.actualDecodeFailCount++;}
          a212AddNetNew({canonicals:d.canonicalResult,currentFinal:base.currentFinal,accepted:bAccepted,position:g.qrCenter||null,radius,counters:bCounters});
        }catch(e){d.error=String(e?.message||e);d.decodeFailed=true;bCounters.actualDecodeFailCount++;}finally{if(canvas){canvas.width=1;canvas.height=1;}bDetails.push(d);}
      }
    }
    const b={id:"B_NORMALIZED_QUAD",physicalUniqueQrCount:currentCount+bAccepted.size,netNewCanonicalQrCount:bAccepted.size,lostCurrentQrCount:0,duplicateInflationCount:0,countingIntegrityFail:false,runtimeMs:Math.round(performance.now()-bStarted),attemptCount:bCounters.actualDecodeAttemptCount,...bCounters,perTriplet:bDetails};

    const cStarted=performance.now();
    const cAccepted=new Map();
    const variants=[{id:"native-nearest",outputScale:1,sampling:"nearest",quietZone:"geometry"},{id:"module-scale-1.5-nearest",outputScale:1.5,sampling:"nearest",quietZone:"geometry"},{id:"module-scale-1.5-bilinear",outputScale:1.5,sampling:"bilinear",quietZone:"geometry"},{id:"module-scale-2-nearest",outputScale:2,sampling:"nearest",quietZone:"geometry"}];
    const cCounters={eligibleGeometryCount:0,configuredVariantCount:variants.length,actualVariantAttemptCount:0,rectifyGeneratedCount:0,jsqrAttemptCount:0,zxingAttemptCount:0,jsqrRawSuccessCount:0,zxingRawSuccessCount:0,parserEligibleCount:0,structuralRejectCount:0,duplicateRejectedCount:0,positionConflictRejectedCount:0};
    const cDetails=[];const eByIndex=new Map((base.geometry?.rows||[]).map(x=>[x.candidateIndex,x]));
    for(const g of base.geometry?.diagnostics||[]){
      if(!g?.geometryValid||g?.overlapRejected||g?.skippedBecauseASuccess)continue;const eRow=eByIndex.get(g.candidateIndex);if(eRow?.geometrySuccess)continue;cCounters.eligibleGeometryCount++;
      for(const config of variants){
        cCounters.actualVariantAttemptCount++;const d={candidateIndex:g.candidateIndex,variantId:config.id,resampleMode:config.sampling,outputScale:config.outputScale,quietZone:config.quietZone,rectifyGenerated:false,decoders:[],canonicalResult:[],error:null};let canvas=null;
        try{
          canvas=rectifyQrGeometry(base.raw,g,config);if(!canvas){cDetails.push(d);continue;}d.rectifyGenerated=true;cCounters.rectifyGeneratedCount++;cCounters.jsqrAttemptCount++;cCounters.zxingAttemptCount++;
          const result=await a212DecodeCanvas(base,canvas);if(result.jsqrSuccess)cCounters.jsqrRawSuccessCount++;if(result.zxingSuccess)cCounters.zxingRawSuccessCount++;const parserEligible=Number(Boolean(result.jsqrSuccess))+Number(Boolean(result.zxingSuccess));cCounters.parserEligibleCount+=parserEligible;cCounters.structuralRejectCount+=a212StructuralRejectCount(result);d.canonicalResult=a212CanonicalList(result);
          d.decoders=[{decoder:"jsQR",rawSuccess:Boolean(result.jsqrSuccess),structuralResult:result.jsqrSuccess?(result.jsStructuralPass?"PASS":"REJECT"):"NO_RAW",canonicalResult:result.jsCanonical||null},{decoder:"ZXing",rawSuccess:Boolean(result.zxingSuccess),structuralResult:result.zxingSuccess?(result.zxingStructuralPass?"PASS":"REJECT"):"NO_RAW",canonicalResult:result.zxingCanonical||null}];
          a212AddNetNew({canonicals:d.canonicalResult,currentFinal:base.currentFinal,accepted:cAccepted,position:g.qrCenter||null,radius,counters:cCounters});
        }catch(e){d.error=String(e?.message||e);}finally{if(canvas){canvas.width=1;canvas.height=1;}cDetails.push(d);}
      }
    }
    const c={id:"C_RECTIFIED_RECOVERY",physicalUniqueQrCount:currentCount+cAccepted.size,netNewCanonicalQrCount:cAccepted.size,lostCurrentQrCount:0,duplicateInflationCount:0,countingIntegrityFail:false,runtimeMs:Math.round(performance.now()-cStarted),attemptCount:cCounters.jsqrAttemptCount+cCounters.zxingAttemptCount,...cCounters,perVariant:cDetails};
    return{schema:"icb-certificate-qr-stage-a21-2-direct-counterfactual-v1",current,a,b,c,totalCounterfactualRuntimeMs:Math.round(performance.now()-totalStarted),gtUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeLogicChanged:false,diagnosticOnly:true};
  }finally{base.raw.width=1;base.raw.height=1;base.norm.width=1;base.norm.height=1;}
}
`;

core+=`\n${a212}\n`;
fs.writeFileSync(corePath,core);
console.log("Stage A21.2 direct counterfactual runner appended");
