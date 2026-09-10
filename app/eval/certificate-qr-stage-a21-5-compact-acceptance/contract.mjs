import {A214_STORAGE_KEY,analyzeA214Evidence} from "../certificate-qr-stage-a21-4-evidence/contract.mjs";

export const A215_STORAGE_SOURCE=A214_STORAGE_KEY;
export const A215_RULE={
 name:"C_COMPACT_FORMAT_ACCEPTANCE_COUNTERFACTUAL",
 diagnosticOnly:true,
 formalParserChanged:false,
 formalDecoderChanged:false,
 requirements:{
  tier:"STRONG",
  length:60,
  separatorPattern:"none",
  recognizedSchemaClass:"compact-printable",
  printableRatioMin:0.99,
  asciiVisibleRatioMin:0.99,
  alnumKnownSymbolRatioMin:0.98,
  requiresJsqrAndZxingAgreement:true,
  requiresStableShape:true,
  requiresSeparatePhysicalPosition:true,
  requiresNoCurrentCanonicalMatch:true,
  currentRejectReason:"slash-schema-mismatch"
 }
};

const shapeOk=s=>Number(s?.length||0)===60&&s?.separatorPattern==="none"&&s?.recognizedSchemaClass==="compact-printable"&&Number(s?.printableRatio||0)>=.99&&Number(s?.asciiVisibleRatio||0)>=.99&&Number(s?.alnumKnownSymbolRatio||0)>=.98;

export function evaluateA215(detail){
 const base=analyzeA214Evidence(detail);
 const groups=(base.fingerprintGroups||[]).map(g=>{
  const both=g.decoders?.includes("jsQR")&&g.decoders?.includes("ZXing");
  const accepted=g.tier==="STRONG"&&g.stableShape===true&&both&&shapeOk(g.payloadShape);
  return {
   fingerprint:g.fingerprint,
   images:g.images,
   count:g.count,
   candidateIndices:g.candidateIndices,
   decoders:g.decoders,
   variants:g.variants,
   positionGroupCount:g.positionGroupCount,
   payloadShape:g.payloadShape,
   sourceTier:g.tier,
   counterfactualAccepted:accepted,
   counterfactualReason:accepted?"compact-consensus-accepted":"compact-consensus-not-eligible"
  };
 });
 const accepted=groups.filter(g=>g.counterfactualAccepted);
 const result={
  schema:"icb-certificate-qr-stage-a21-5-compact-acceptance-summary-v1",
  sourceEvaluationHead:base.evaluationHead,
  sourceStorageKey:A215_STORAGE_SOURCE,
  sourceRawSuccessCount:base.rawSuccessCount,
  sourceUniqueFingerprintCount:base.uniqueFingerprintCount,
  sourceStrongGroupCount:base.counterfactual?.strongGroupCount||0,
  acceptedUniqueFingerprintCount:accepted.length,
  acceptedUniquePhysicalGroupCount:accepted.reduce((n,g)=>n+Number(g.positionGroupCount||0),0),
  acceptedImages:[...new Set(accepted.flatMap(g=>g.images||[]))],
  acceptedGroups:accepted,
  currentRejectReasonHistogram:base.rejectReasonHistogram,
  parserSchemaHistogram:base.parserSchemaHistogram,
  projected:{
   netNewPhysicalQrUpperBound:accepted.reduce((n,g)=>n+Number(g.positionGroupCount||0),0),
   formalAcceptanceChanged:false,
   formal28of47Preserved:true,
   requiresFormalChange:false,
   diagnosticOnly:true
  },
  isolation:{formalParserChanged:false,formalDecoderChanged:false,gtRuntime:false,expectedCountRuntime:false,rerunRequired:false}
 };
 const text=JSON.stringify(result);
 if(text.length>6000)throw new Error(`A215_SUMMARY_TOO_LONG_${text.length}`);
 return result;
}
