export const A212_FIXED_IDS=Object.freeze(Array.from({length:8},(_,i)=>`IMG_${String(940+i).padStart(4,"0")}.jpeg`));
export const A212_EXPECTED_SCORING_ONLY=Object.freeze({"IMG_0940.jpeg":6,"IMG_0941.jpeg":6,"IMG_0942.jpeg":6,"IMG_0943.jpeg":6,"IMG_0944.jpeg":6,"IMG_0945.jpeg":6,"IMG_0946.jpeg":6,"IMG_0947.jpeg":5});

function methodRecord(result,key){
  const value=result?.[key];
  if(!value||typeof value!=="object") throw new Error(`A212_MISSING_${key.toUpperCase()}`);
  return value;
}
function sum(records,path){return records.reduce((n,r)=>n+Number(path(r)||0),0);}
export function validateA212ImageRecord(record){
  if(!record?.imageId)throw new Error("A212_IMAGE_ID_REQUIRED");
  if(record.diagnosticError)return true;
  const result=record.result;
  if(!result)throw new Error("A212_RESULT_REQUIRED");
  for(const k of ["current","a","b","c"]) methodRecord(result,k);
  if(result.current.runtimeMs<0||result.current.attemptCount<0)throw new Error("A212_CURRENT_RUNTIME_ATTEMPT_INVALID");
  if(result.a.inputHypothesisCount<0||result.a.recoveryAttemptCount<0||result.a.decodeAttemptCount<0)throw new Error("A212_A_COUNTER_INVALID");
  if(result.a.recoveryAttemptCount<result.a.decodeAttemptCount)throw new Error("A212_A_DECODE_GT_RECOVERY");
  if(result.b.normalizedGatePassCount+result.b.normalizedGateRejectCount!==result.b.eligibleTripletCount)throw new Error("A212_B_GATE_COUNTER_MISMATCH");
  if(result.b.actualRectifyGeneratedCount>result.b.actualRectifyAttemptCount)throw new Error("A212_B_RECTIFY_COUNTER_MISMATCH");
  if(result.b.actualDecodeAttemptCount>result.b.actualRectifyGeneratedCount)throw new Error("A212_B_DECODE_COUNTER_MISMATCH");
  if(result.c.actualVariantAttemptCount!==result.c.eligibleGeometryCount*result.c.configuredVariantCount)throw new Error("A212_C_VARIANT_COUNTER_MISMATCH");
  if(result.c.jsqrAttemptCount!==result.c.rectifyGeneratedCount||result.c.zxingAttemptCount!==result.c.rectifyGeneratedCount)throw new Error("A212_C_DECODER_COUNTER_MISMATCH");
  for(const k of ["current","a","b","c"]){if(result[k].lostCurrentQrCount!==0)throw new Error(`A212_${k.toUpperCase()}_CURRENT_LOSS`);if(result[k].countingIntegrityFail)throw new Error(`A212_${k.toUpperCase()}_COUNTING_INTEGRITY_FAIL`);}
  if(result.gtUsedDuringDecode||result.expectedQrCountUsedDuringDecode||result.formalDecodeLogicChanged||!result.diagnosticOnly)throw new Error("A212_ISOLATION_FAIL");
  return true;
}

export function buildA212Summary({evaluationHead,records}){
  if(!Array.isArray(records)||records.length!==8)throw new Error("A212_REQUIRES_EIGHT_RECORDS");
  if(!records.every((r,i)=>r?.imageId===A212_FIXED_IDS[i]))throw new Error("A212_FIXED_ID_ORDER_FAIL");
  records.forEach(validateA212ImageRecord);
  const healthy=records.filter(r=>!r.diagnosticError&&r.result);
  const currentTotal=sum(healthy,r=>r.result.current.physicalUniqueQrCount);
  const aNet=sum(healthy,r=>r.result.a.netNewCanonicalQrCount),bNet=sum(healthy,r=>r.result.b.netNewCanonicalQrCount),cNet=sum(healthy,r=>r.result.c.netNewCanonicalQrCount);
  const currentRuntimeMs=sum(healthy,r=>r.result.current.runtimeMs),currentAttemptCount=sum(healthy,r=>r.result.current.attemptCount);
  const perImage=records.map(r=>({imageId:r.imageId,expectedQrCount:A212_EXPECTED_SCORING_ONLY[r.imageId],diagnosticError:r.diagnosticError||null,current:r.result?.current||null,A:r.result?.a||null,B:r.result?.b||null,C:r.result?.c||null}));
  const positive=perImage.find(r=>r.imageId==="IMG_0947.jpeg");
  return {schema:"icb-certificate-qr-stage-a21-2-direct-validity-summary-v1",evaluationHead:evaluationHead||null,selectedImageCount:8,selectedImageIds:A212_FIXED_IDS.map(id=>id.slice(4,8)),diagnosticErrorImageCount:records.filter(r=>r.diagnosticError).length,formalReference:{finalSafeUnion:28,expectedQrCount:47,preserved:currentTotal===28,newFormalEvaluation:false},isolation:{groundTruthScoringOnly:true,groundTruthUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeControlChanged:false,diagnosticOnly:true},current:{physicalUniqueQrCount:currentTotal,runtimeMs:currentRuntimeMs,attemptCount:currentAttemptCount,runtimeAndAttemptSeparated:true},counterfactual:{A:{netNewCanonicalCount:aNet,inputHypothesisCount:sum(healthy,r=>r.result.a.inputHypothesisCount),recoveryAttemptCount:sum(healthy,r=>r.result.a.recoveryAttemptCount),decodeAttemptCount:sum(healthy,r=>r.result.a.decodeAttemptCount),rawDecodeSuccessCount:sum(healthy,r=>r.result.a.rawDecodeSuccessCount),structuralPassCount:sum(healthy,r=>r.result.a.structuralPassCount),duplicateRejectedCount:sum(healthy,r=>r.result.a.duplicateRejectedCount),positionConflictRejectedCount:sum(healthy,r=>r.result.a.positionConflictRejectedCount)},B:{netNewCanonicalCount:bNet,inspectedTripletCount:sum(healthy,r=>r.result.b.inspectedTripletCount),eligibleTripletCount:sum(healthy,r=>r.result.b.eligibleTripletCount),normalizedGatePassCount:sum(healthy,r=>r.result.b.normalizedGatePassCount),normalizedGateRejectCount:sum(healthy,r=>r.result.b.normalizedGateRejectCount),actualRectifyAttemptCount:sum(healthy,r=>r.result.b.actualRectifyAttemptCount),actualRectifyGeneratedCount:sum(healthy,r=>r.result.b.actualRectifyGeneratedCount),actualDecodeAttemptCount:sum(healthy,r=>r.result.b.actualDecodeAttemptCount),actualRawDecodeSuccessCount:sum(healthy,r=>r.result.b.actualRawDecodeSuccessCount),actualStructuralPassCount:sum(healthy,r=>r.result.b.actualStructuralPassCount),actualDecodeFailCount:sum(healthy,r=>r.result.b.actualDecodeFailCount)},C:{netNewCanonicalCount:cNet,eligibleGeometryCount:sum(healthy,r=>r.result.c.eligibleGeometryCount),configuredVariantCount:4,actualVariantAttemptCount:sum(healthy,r=>r.result.c.actualVariantAttemptCount),rectifyGeneratedCount:sum(healthy,r=>r.result.c.rectifyGeneratedCount),jsqrAttemptCount:sum(healthy,r=>r.result.c.jsqrAttemptCount),zxingAttemptCount:sum(healthy,r=>r.result.c.zxingAttemptCount),jsqrRawSuccessCount:sum(healthy,r=>r.result.c.jsqrRawSuccessCount),zxingRawSuccessCount:sum(healthy,r=>r.result.c.zxingRawSuccessCount),parserEligibleCount:sum(healthy,r=>r.result.c.parserEligibleCount),structuralRejectCount:sum(healthy,r=>r.result.c.structuralRejectCount),duplicateRejectedCount:sum(healthy,r=>r.result.c.duplicateRejectedCount)}},guards:{currentLossZero:healthy.every(r=>[r.result.current,r.result.a,r.result.b,r.result.c].every(x=>x.lostCurrentQrCount===0)),countingIntegrityFail:false,positive0947Current5of5:Boolean(positive?.current?.physicalUniqueQrCount===5),sevenImageSummaryRejected:true,iframeDomBridgeUsed:false},perImage,protection:{frozen:"HOLD",production:"HOLD",candidateLock:"NOT EVALUATED / HOLD",physicalSlot:"HOLD",mainChanged:false,supabaseChanged:false,netlifyChanged:false,vercelProductionChanged:false,adoptedHead:null}};
}
