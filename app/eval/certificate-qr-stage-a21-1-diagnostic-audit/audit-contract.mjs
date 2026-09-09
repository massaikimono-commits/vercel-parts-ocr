export const A211_FIXED_IDS=Object.freeze(Array.from({length:8},(_,i)=>`IMG_${String(940+i).padStart(4,"0")}.jpeg`));
export const A211_EXPECTED_SCORING_ONLY=Object.freeze({"IMG_0940.jpeg":6,"IMG_0941.jpeg":6,"IMG_0942.jpeg":6,"IMG_0943.jpeg":6,"IMG_0944.jpeg":6,"IMG_0945.jpeg":6,"IMG_0946.jpeg":6,"IMG_0947.jpeg":5});

function sideMetrics(quad){
  if(!Array.isArray(quad)||quad.length!==4)return null;
  const d=(a,b)=>Math.hypot(Number(a?.x||0)-Number(b?.x||0),Number(a?.y||0)-Number(b?.y||0));
  const sides=[d(quad[0],quad[1]),d(quad[1],quad[2]),d(quad[2],quad[3]),d(quad[3],quad[0])];
  const min=Math.min(...sides),max=Math.max(...sides);
  let area=0;for(let i=0;i<4;i++){const j=(i+1)%4;area+=Number(quad[i]?.x||0)*Number(quad[j]?.y||0)-Number(quad[j]?.x||0)*Number(quad[i]?.y||0);}area=Math.abs(area)/2;
  return {minSidePx:min,maxSidePx:max,areaPx2:area,perspectiveScaleSpread:min>0?max/min:null};
}

export function deriveA211Audit(matrix,a21){
  const detection=matrix?.candidateDetection||{};
  const geometry=matrix?.geometryStage||{};
  const geo=geometry.diagnostics||[];
  const currentCount=Number(geometry.finalUnionCanonicalCount||0);
  const allTriplets=geo.flatMap(g=>(g.tripletDiagnostics||[]).map(t=>({g,t})));
  const bEligible=allTriplets.filter(({g,t})=>!g?.skippedBecauseASuccess&&!g?.overlapRejected&&!t?.geometryValid&&["quad-too-small","quad-side-spread-too-large"].includes(t?.rejectedReason));
  const bGate=bEligible.map(({g,t})=>{const modulePx=Number(t?.modulePx||0),dimension=Number(t?.qrDimension||0),side=sideMetrics(t?.qrQuad||[]);if(!modulePx||!dimension||!side)return{candidateIndex:g?.candidateIndex??null,tripletRank:t?.rank??null,pass:false,reason:"missing-normalized-geometry"};const sideRatio=(side.minSidePx/modulePx)/dimension;const areaRatio=(side.areaPx2/(modulePx*modulePx))/(dimension*dimension);const spread=Number(t?.perspectiveScaleSpread||side.perspectiveScaleSpread||1);const pass=sideRatio>=.65&&sideRatio<=1.35&&areaRatio>=.42&&areaRatio<=1.85&&spread<=2.5;return{candidateIndex:g?.candidateIndex??null,tripletRank:t?.rank??null,pass,sideToDimensionRatio:Number(sideRatio.toFixed(4)),areaToDimensionSquaredRatio:Number(areaRatio.toFixed(4)),perspectiveScaleSpread:Number(spread.toFixed(4))};});
  const unresolved=geo.filter(g=>!g?.skippedBecauseASuccess&&!g?.skippedBecausePhysicalConsensus);
  const aHypotheses=unresolved.map(g=>({candidateIndex:g?.candidateIndex??null,center:{x:g?.x??null,y:g?.y??null},finderCount:Number(g?.finderCount||0),geometryValid:Boolean(g?.geometryValid),overlapRejected:Boolean(g?.overlapRejected),geometryFailReason:g?.geometryFailReason||null,ownershipState:g?.overlapRejected?"physical-overlap":g?.geometryValid?"geometry-position-hypothesis":Number(g?.finderCount||0)>=3?"finder-position-hypothesis":"candidate-position-hypothesis"}));
  const cEligible=geo.filter(g=>g?.geometryValid&&!g?.overlapRejected&&!g?.skippedBecauseASuccess);
  return {
    current:{physicalUniqueQrCount:currentCount,currentAttemptCount:Number(matrix?.currentEnsemble?.totalAttempts||0),runtimeSource:"A21.1 page wall-clock; never attempt-count-as-ms"},
    A_PHYSICAL_SEPARATION:{canonicalSuccessfulEvidenceOnlyInA21:true,undecodedHypothesisParticipationEnabledInAudit:true,coarsePhysicalCandidateCount:Number(detection.coarsePhysicalCandidateCount||0),ownershipHypothesisCount:aHypotheses.length,ownershipHypotheses:aHypotheses,recoveredCount:Number(a21?.a?.netNewCanonicalQrCount||0),efficacyStatus:"NOT EVALUABLE UNTIL A DIRECT RECOVERY PATH CONSUMES UNDECODED HYPOTHESES"},
    B_NORMALIZED_QUAD:{inspectedTripletCount:allTriplets.length,eligibleTripletCount:bEligible.length,normalizedGatePassCount:bGate.filter(x=>x.pass).length,normalizedGateRejectCount:bGate.filter(x=>!x.pass).length,gateDetails:bGate,recoveredCount:Number(a21?.b?.netNewCanonicalQrCount||0),instrumentationGap:"A21 runner did not persist rectify/decode attempt counters"},
    C_RECTIFIED_RECOVERY:{eligibleGeometryCount:cEligible.length,configuredVariantsPerEligible:4,upperBoundVariantAttemptCount:cEligible.length*4,recoveredCount:Number(a21?.c?.netNewCanonicalQrCount||0),instrumentationGap:"A21 runner did not persist actual per-variant rectify/decode counters"},
  };
}

export function buildA211Summary({evaluationHead,records}){
  if(!Array.isArray(records)||records.length!==8)throw new Error("A211_REQUIRES_EIGHT_RECORDS");
  if(!records.every((r,i)=>r?.imageId===A211_FIXED_IDS[i]))throw new Error("A211_FIXED_ID_ORDER_FAIL");
  const perImage=records.map(r=>({imageId:r.imageId,expectedQrCount:A211_EXPECTED_SCORING_ONLY[r.imageId],diagnosticError:r.diagnosticError||null,currentRuntimeMs:r.currentRuntimeMs??null,audit:r.audit||null}));
  const currentTotal=perImage.reduce((s,r)=>s+Number(r.audit?.current?.physicalUniqueQrCount||0),0);
  const currentRuntimeMs=perImage.reduce((s,r)=>s+Number(r.currentRuntimeMs||0),0);
  const currentAttemptCount=perImage.reduce((s,r)=>s+Number(r.audit?.current?.currentAttemptCount||0),0);
  return {schema:"icb-certificate-qr-stage-a21-1-diagnostic-audit-summary-v1",evaluationHead:evaluationHead||null,selectedImageCount:8,selectedImageIds:A211_FIXED_IDS.map(id=>id.slice(4,8)),diagnosticErrorImageCount:records.filter(r=>r.diagnosticError).length,formalReference:{finalSafeUnion:28,expectedQrCount:47,preserved:true,newFormalEvaluation:false},isolation:{groundTruthScoringOnly:true,groundTruthUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeControlChanged:false,recognitionLogicChanged:false},current:{physicalUniqueQrCount:currentTotal,runtimeMs:currentRuntimeMs,attemptCount:currentAttemptCount,runtimeSemanticsFixed:true},perImage,validity:{A:"UNDECODED OWNERSHIP HYPOTHESES NOW OBSERVABLE; RECOVERY EFFICACY STILL REQUIRES DIRECT CONSUMPTION",B:"ELIGIBILITY AND NORMALIZED GATE NOW OBSERVABLE; ACTUAL RECTIFY/DECODE COUNTERS STILL MISSING",C:"ELIGIBLE GEOMETRY NOW OBSERVABLE; ACTUAL VARIANT COUNTERS STILL MISSING",sameA21RerunRequired:false},protection:{frozen:"HOLD",production:"HOLD",candidateLock:"NOT EVALUATED / HOLD",physicalSlot:"HOLD",mainChanged:false,adoptedHead:null}};
}
