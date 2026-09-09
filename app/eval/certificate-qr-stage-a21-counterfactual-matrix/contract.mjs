export const A21_FIXED_IDS=Object.freeze(Array.from({length:8},(_,i)=>`IMG_${String(940+i).padStart(4,"0")}.jpeg`));
export const A21_EXPECTED_SCORING_ONLY=Object.freeze({
  "IMG_0940.jpeg":6,"IMG_0941.jpeg":6,"IMG_0942.jpeg":6,"IMG_0943.jpeg":6,
  "IMG_0944.jpeg":6,"IMG_0945.jpeg":6,"IMG_0946.jpeg":6,"IMG_0947.jpeg":5,
});
export const A21_METHODS=Object.freeze(["CURRENT","A_PHYSICAL_SEPARATION","B_NORMALIZED_QUAD","C_RECTIFIED_RECOVERY"]);

export function validateA21Records(records){
  if(!Array.isArray(records)||records.length!==8) throw new Error("A21_REQUIRES_EIGHT_RECORDS");
  if(!records.every((r,i)=>r?.imageId===A21_FIXED_IDS[i])) throw new Error("A21_FIXED_ID_ORDER_FAIL");
  for(const record of records){
    if(record.diagnosticError) continue;
    for(const method of A21_METHODS){
      if(!record.methods?.[method]) throw new Error(`A21_METHOD_MISSING:${record.imageId}:${method}`);
    }
  }
  return true;
}

export function buildA21Summary({evaluationHead,records}){
  validateA21Records(records);
  const successful=records.filter(r=>!r.diagnosticError);
  const totals={};
  for(const method of A21_METHODS){
    totals[method]={physicalUniqueQrCount:0,netNewCanonicalQrCount:0,lostCurrentQrCount:0,duplicateInflationCount:0,countingIntegrityFail:false,runtimeMs:0};
    for(const record of successful){
      const row=record.methods[method];
      totals[method].physicalUniqueQrCount+=Number(row.physicalUniqueQrCount||0);
      totals[method].netNewCanonicalQrCount+=Number(row.netNewCanonicalQrCount||0);
      totals[method].lostCurrentQrCount+=Number(row.lostCurrentQrCount||0);
      totals[method].duplicateInflationCount+=Number(row.duplicateInflationCount||0);
      totals[method].runtimeMs+=Number(row.runtimeMs||0);
      const expected=A21_EXPECTED_SCORING_ONLY[record.imageId];
      if(Number(row.physicalUniqueQrCount||0)>expected) totals[method].countingIntegrityFail=true;
    }
  }
  const perImage=records.map(record=>{
    const expected=A21_EXPECTED_SCORING_ONLY[record.imageId];
    if(record.diagnosticError) return {imageId:record.imageId,expectedQrCount:expected,diagnosticError:record.diagnosticError};
    const methods={};
    for(const method of A21_METHODS){
      const row=record.methods[method];
      methods[method]={...row,countingIntegrityFail:Number(row.physicalUniqueQrCount||0)>expected};
    }
    return {imageId:record.imageId,expectedQrCount:expected,methods};
  });
  const current0947=perImage.find(r=>r.imageId==="IMG_0947.jpeg")?.methods?.CURRENT?.physicalUniqueQrCount??null;
  const regression0947=Object.fromEntries(A21_METHODS.slice(1).map(method=>[method,perImage.find(r=>r.imageId==="IMG_0947.jpeg")?.methods?.[method]?.physicalUniqueQrCount!==current0947]));
  return {
    schema:"icb-certificate-qr-stage-a21-counterfactual-summary-v1",
    evaluationHead:evaluationHead||null,
    selectedImageCount:8,
    selectedImageIds:A21_FIXED_IDS.map(id=>id.replace("IMG_","").replace(".jpeg","")),
    diagnosticErrorImageCount:records.filter(r=>r.diagnosticError).length,
    formalReference:{finalSafeUnion:28,expectedQrCount:47,preserved:true,newFormalEvaluation:false},
    isolation:{groundTruthScoringOnly:true,groundTruthUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeControlChanged:false,recognitionLogicChanged:false},
    totals,
    perImage,
    regressionGuard:{current0947,regression0947,currentSuccessfulQrLossZero:A21_METHODS.slice(1).every(m=>totals[m].lostCurrentQrCount===0),duplicateInflationZero:A21_METHODS.slice(1).every(m=>totals[m].duplicateInflationCount===0),countingIntegrityAllFalse:A21_METHODS.every(m=>!totals[m].countingIntegrityFail)},
    protection:{frozen:"HOLD",production:"HOLD",candidateLock:"NOT EVALUATED / HOLD",physicalSlot:"HOLD",mainChanged:false,adoptedHead:null},
  };
}
