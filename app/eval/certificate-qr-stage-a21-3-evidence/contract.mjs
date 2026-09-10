export const A213_FIXED_IDS=Object.freeze(Array.from({length:8},(_,i)=>`IMG_${String(940+i).padStart(4,"0")}.jpeg`));
export const A213_EXPECTED=Object.freeze({"IMG_0940.jpeg":6,"IMG_0941.jpeg":6,"IMG_0942.jpeg":6,"IMG_0943.jpeg":6,"IMG_0944.jpeg":6,"IMG_0945.jpeg":6,"IMG_0946.jpeg":6,"IMG_0947.jpeg":5});
const sum=(rows,fn)=>rows.reduce((n,r)=>n+Number(fn(r)||0),0);
const countBy=(items,key)=>{const out={};for(const x of items||[]){const k=String(x?.[key]||"unknown");out[k]=(out[k]||0)+1;}return out;};
export function validateA213Record(record){
 if(!record?.imageId||!record?.result)throw new Error("A213_RECORD_REQUIRED");
 const r=record.result;
 if(r.gtUsedDuringDecode||r.expectedQrCountUsedDuringDecode||r.formalDecodeLogicChanged||!r.diagnosticOnly)throw new Error("A213_ISOLATION_FAIL");
 if(!Array.isArray(r.a?.structuralPassAttribution)||!r.a?.structuralPassAttributionComplete)throw new Error("A213_A_ATTRIBUTION_INCOMPLETE");
 if(r.a.structuralPassAttribution.length!==Number(r.a.structuralPassCount||0))throw new Error("A213_A_PASS_COUNT_MISMATCH");
 if(!Array.isArray(r.c?.rawSuccessEvidence)||!r.c?.rawSuccessEvidenceComplete)throw new Error("A213_C_EVIDENCE_INCOMPLETE");
 if(r.c.rawSuccessEvidence.length!==Number(r.c.jsqrRawSuccessCount||0)+Number(r.c.zxingRawSuccessCount||0))throw new Error("A213_C_RAW_COUNT_MISMATCH");
 const serialized=JSON.stringify({a:r.a.structuralPassAttribution,c:r.c.rawSuccessEvidence});
 if(/canonicalPayload|rawPayload/i.test(serialized)&&/"(?:canonicalPayloadIncluded|rawPayloadIncluded)":true/.test(serialized))throw new Error("A213_PAYLOAD_EXPOSURE");
 return true;
}
export function buildA213Summary({evaluationHead,records}){
 if(!Array.isArray(records)||records.length!==8)throw new Error("A213_REQUIRES_EIGHT_RECORDS");
 if(!records.every((r,i)=>r.imageId===A213_FIXED_IDS[i]))throw new Error("A213_FIXED_ORDER_FAIL");
 records.forEach(validateA213Record);
 const healthy=records.filter(r=>!r.diagnosticError);
 const current=sum(healthy,r=>r.result.current.physicalUniqueQrCount);
 const aEvidence=healthy.flatMap(r=>r.result.a.structuralPassAttribution||[]);
 const cEvidence=healthy.flatMap(r=>r.result.c.rawSuccessEvidence||[]);
 const summary={
  schema:"icb-certificate-qr-stage-a21-3-evidence-summary-v1",
  evaluationHead:evaluationHead||null,
  fixed8Completed:records.length===8,
  selectedImageCount:8,
  diagnosticErrorImageCount:records.filter(r=>r.diagnosticError).length,
  formal:{current,expected:47,preserved:current===28,loss:sum(healthy,r=>r.result.current.lostCurrentQrCount),countingIntegrityFail:healthy.some(r=>r.result.current.countingIntegrityFail)},
  A:{structuralPass:aEvidence.length,attributionByDisposition:countBy(aEvidence,"disposition"),allAttributed:aEvidence.length===sum(healthy,r=>r.result.a.structuralPassCount),netNew:sum(healthy,r=>r.result.a.netNewCanonicalQrCount),lost:sum(healthy,r=>r.result.a.lostCurrentQrCount)},
  B:{rawSuccess:sum(healthy,r=>r.result.b.actualRawDecodeSuccessCount),netNew:sum(healthy,r=>r.result.b.netNewCanonicalQrCount),lost:sum(healthy,r=>r.result.b.lostCurrentQrCount)},
  C:{rawSuccess:cEvidence.length,byAttribution:countBy(cEvidence,"attributionCategory"),byRejectReason:countBy(cEvidence,"structuralRejectReasonCategory"),byMalformedClass:countBy(cEvidence,"malformedPartialClassification"),byPhysicalRelation:countBy(cEvidence,"physicalPositionRelation"),currentCanonicalMatch:cEvidence.filter(x=>x.currentCanonicalMatch).length,netNew:sum(healthy,r=>r.result.c.netNewCanonicalQrCount),lost:sum(healthy,r=>r.result.c.lostCurrentQrCount),allRawAttributed:cEvidence.length===sum(healthy,r=>Number(r.result.c.jsqrRawSuccessCount||0)+Number(r.result.c.zxingRawSuccessCount||0))},
  runtime:{currentMs:sum(healthy,r=>r.result.current.runtimeMs),aMs:sum(healthy,r=>r.result.a.runtimeMs),bMs:sum(healthy,r=>r.result.b.runtimeMs),cMs:sum(healthy,r=>r.result.c.runtimeMs)},
  perImage:records.map(r=>({id:r.imageId.slice(4,8),err:Boolean(r.diagnosticError),current:r.result?.current?.physicalUniqueQrCount??0,Apass:r.result?.a?.structuralPassCount??0,Aattr:r.result?.a?.structuralPassAttribution?.length??0,Craw:Number(r.result?.c?.jsqrRawSuccessCount||0)+Number(r.result?.c?.zxingRawSuccessCount||0),Cattr:r.result?.c?.rawSuccessEvidence?.length??0})),
  isolation:{gtRuntime:false,expectedCountRuntime:false,formalParserChanged:false,formalDecoderChanged:false,diagnosticOnly:true},
  protection:{frozen:"HOLD",production:"HOLD",candidateLock:"HOLD",physicalSlot:"HOLD",adoptedHead:null}
 };
 const text=JSON.stringify(summary);
 if(text.length>6000)throw new Error(`A213_SUMMARY_TOO_LONG_${text.length}`);
 return summary;
}
export function buildA213Detail({evaluationHead,records}){
 records.forEach(validateA213Record);
 return {schema:"icb-certificate-qr-stage-a21-3-evidence-detail-v1",evaluationHead:evaluationHead||null,rawPayloadIncluded:false,canonicalPayloadIncluded:false,records:records.map(r=>({imageId:r.imageId,diagnosticError:r.diagnosticError||null,A:r.result.a.structuralPassAttribution,C:r.result.c.rawSuccessEvidence}))};
}
