import fs from "node:fs";

const corePath="app/eval/certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated.js";
if(!fs.existsSync(corePath)) throw new Error("generated Photo QR core missing");
let core=fs.readFileSync(corePath,"utf8");
if(core.includes("function a213PrivacyFingerprint")){
  console.log("Stage A21.3 evidence instrumentation already appended");
  process.exit(0);
}
if(!core.includes("export async function runPhotoQrA212Counterfactual")) throw new Error("A21.2 runner missing before A21.3 instrumentation");

const helper=String.raw`
async function a213PrivacyFingerprint(value){
  const text=String(value||"");
  if(!text)return null;
  const bytes=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("").slice(0,24);
}
function a213PayloadShape(structural={}){
  return {
    length:Number(structural?.payloadLength||0),
    printableRatio:Number(structural?.printableRatio||0),
    asciiVisibleRatio:Number(structural?.asciiVisibleRatio||0),
    alnumKnownSymbolRatio:Number(structural?.alnumKnownSymbolRatio||0),
    separatorPattern:structural?.separatorPattern||"none",
    recognizedSchemaClass:structural?.recognizedSchemaClass||"unknown",
  };
}
function a213MalformedClass(structural={}){
  const length=Number(structural?.payloadLength||0);
  const fail=String(structural?.structuralFailReason||"unknown");
  if(!length)return "empty-or-undecodable";
  if(/length|short|trunc|partial/i.test(fail))return "partial-or-length-mismatch";
  if(/schema|separator|slash|format/i.test(fail))return "schema-or-format-mismatch";
  if(Number(structural?.printableRatio||0)<.95||Number(structural?.asciiVisibleRatio||0)<.90)return "malformed-character-shape";
  if(structural?.parserSchemaRecognized)return "parser-recognized-structural-reject";
  return "structurally-unrecognized";
}
function a213CurrentPositionEvidence(base){
  const rows=[];
  const collect=(source,attemptKey)=>{
    for(const row of source||[])for(const attempt of row?.[attemptKey]||[]){
      for(const [decoder,canonical,position,pass] of [
        ["jsQR",attempt?.jsCanonical,attempt?.jsRawPosition,attempt?.jsStructuralPass],
        ["ZXing",attempt?.zxingCanonical,attempt?.zxingRawPosition,attempt?.zxingStructuralPass],
      ])if(canonical&&position&&pass)rows.push({decoder,canonical,position});
    }
  };
  collect(base?.current?.rows,"currentAttempts");
  collect(base?.geometry?.rows,"geometryAttempts");
  return rows;
}
function a213PhysicalRelation({canonical,position,currentEvidence,radius}){
  if(canonical&&currentEvidence.some(e=>e.canonical===canonical))return "current-canonical-rediscovery";
  if(position){
    const near=currentEvidence.filter(e=>e.position&&Math.hypot(Number(e.position.x)-Number(position.x),Number(e.position.y)-Number(position.y))<=radius);
    if(near.length)return "same-current-physical-position-different-payload";
  }
  return position?"separate-or-unseen-physical-position":"position-unavailable";
}
function a213RawCategory({canonical,currentMatch,physicalRelation,structural={}}){
  if(currentMatch)return "CURRENT_REDISCOVERY";
  const malformed=a213MalformedClass(structural);
  if(malformed==="partial-or-length-mismatch"||malformed==="malformed-character-shape")return "PARTIAL_OR_MALFORMED";
  if(structural?.parserSchemaRecognized&&!structural?.pass)return "PARSER_RECOGNIZED_STRUCTURAL_REJECT";
  if(physicalRelation==="separate-or-unseen-physical-position"&&String(structural?.recognizedSchemaClass||"")!=="unknown")return "SEPARATE_PHYSICAL_CERTIFICATE_QR_CANDIDATE";
  if(String(structural?.recognizedSchemaClass||"")!=="unknown")return "CERTIFICATE_QR_CANDIDATE";
  return canonical?"INVALID_OR_UNRECOGNIZED_DECODE":"INVALID_DECODE";
}
async function a213EvidenceRecord({decoder,variantId,candidateIndex,canonical,structural,position,currentFinal,currentEvidence,radius}){
  const currentCanonicalMatch=Boolean(canonical&&currentFinal?.has(canonical));
  const physicalPositionRelation=a213PhysicalRelation({canonical,position,currentEvidence,radius});
  return {
    decoder,variantId,candidateIndex,
    payloadFingerprint:await a213PrivacyFingerprint(canonical),
    payloadShape:a213PayloadShape(structural),
    formalParserStep:{
      parserSchemaRecognized:Boolean(structural?.parserSchemaRecognized),
      parserSchemaClass:structural?.parserSchemaClass||"unrecognized",
      structuralPass:Boolean(structural?.pass),
    },
    structuralRejectReasonCategory:structural?.structuralFailReason||"unknown",
    currentCanonicalMatch,
    physicalPositionRelation,
    malformedPartialClassification:a213MalformedClass(structural),
    attributionCategory:a213RawCategory({canonical,currentMatch:currentCanonicalMatch,physicalRelation:physicalPositionRelation,structural}),
    rawPayloadIncluded:false,
    canonicalPayloadIncluded:false,
  };
}
function a213StructuralPassDisposition({canonical,result,currentFinal,accepted,position,radius}){
  if(!canonical)return "STRUCTURAL_PASS_NO_CANONICAL";
  if(currentFinal.has(canonical))return "CURRENT_CANONICAL_MATCH";
  if(accepted.has(canonical))return "COUNTERFACTUAL_DUPLICATE";
  if(result?.crossEngineConflict&&result?.adoptedEngine==="none")return "CROSS_ENGINE_CONFLICT_NOT_ADOPTED";
  if(position&&[...accepted.values()].some(v=>v.position&&Math.hypot(Number(v.position.x)-Number(position.x),Number(v.position.y)-Number(position.y))<=radius&&v.canonical!==canonical))return "POSITION_CONFLICT";
  return "NET_NEW_ELIGIBLE";
}
`;
core=core.replace("export async function runPhotoQrA212Counterfactual(file){",helper+"\nexport async function runPhotoQrA212Counterfactual(file){");

core=core.replace("const aPer=[];\n    const currentRows", "const aPer=[];const aPassEvidence=[];\n    const currentRows");
core=core.replace(
"const result=await a212DecodeCanvas(base,canvas);\n            const raw=a212RawSuccessCount(result),struct=a212StructuralPassCount(result);",
`const result=await a212DecodeCanvas(base,canvas);
            const pos=h.source?.qrCenter||((h.x!=null&&h.y!=null)?{x:h.x,y:h.y}:null);
            for(const [decoder,success,pass,canonical,structural,rawPosition] of [
              ["jsQR",result.jsqrSuccess,result.jsStructuralPass,result.jsCanonical,result.jsStructural,result.jsRawPosition],
              ["ZXing",result.zxingSuccess,result.zxingStructuralPass,result.zxingCanonical,result.zxingStructural,result.zxingRawPosition],
            ])if(success&&pass){
              aPassEvidence.push({
                candidateIndex:h.candidateIndex,decoder,ownershipState:h.ownershipState,
                payloadFingerprint:await a213PrivacyFingerprint(canonical),
                payloadShape:a213PayloadShape(structural),
                currentCanonicalMatch:Boolean(canonical&&base.currentFinal.has(canonical)),
                disposition:a213StructuralPassDisposition({canonical,result,currentFinal:base.currentFinal,accepted:aAccepted,position:rawPosition||pos,radius}),
                adoptionReason:result.adoptionReason||"unknown",adoptedEngine:result.adoptedEngine||"none",
                rawPayloadIncluded:false,canonicalPayloadIncluded:false,
              });
            }
            const raw=a212RawSuccessCount(result),struct=a212StructuralPassCount(result);`);
core=core.replace("const pos=h.source?.qrCenter||((h.x!=null&&h.y!=null)?{x:h.x,y:h.y}:null);\n            a212AddNetNew", "a212AddNetNew");
core=core.replace("...aCounters,perHypothesis:aPer};", "...aCounters,perHypothesis:aPer,structuralPassAttribution:aPassEvidence,structuralPassAttributionComplete:aPassEvidence.length===aCounters.structuralPassCount};");

core=core.replace("const cDetails=[];const eByIndex", "const cDetails=[];const cRawEvidence=[];const currentPositionEvidence=a213CurrentPositionEvidence(base);const eByIndex");
core=core.replace(
"const result=await a212DecodeCanvas(base,canvas);if(result.jsqrSuccess)cCounters.jsqrRawSuccessCount++;if(result.zxingSuccess)cCounters.zxingRawSuccessCount++;const parserEligible=Number(Boolean(result.jsqrSuccess))+Number(Boolean(result.zxingSuccess));",
`const result=await a212DecodeCanvas(base,canvas);
          for(const [decoder,success,canonical,structural,rawPosition] of [
            ["jsQR",result.jsqrSuccess,result.jsCanonical,result.jsStructural,result.jsRawPosition],
            ["ZXing",result.zxingSuccess,result.zxingCanonical,result.zxingStructural,result.zxingRawPosition],
          ])if(success)cRawEvidence.push(await a213EvidenceRecord({decoder,variantId:config.id,candidateIndex:g.candidateIndex,canonical,structural,position:rawPosition||g.qrCenter||null,currentFinal:base.currentFinal,currentEvidence:currentPositionEvidence,radius}));
          if(result.jsqrSuccess)cCounters.jsqrRawSuccessCount++;if(result.zxingSuccess)cCounters.zxingRawSuccessCount++;const parserEligible=Number(Boolean(result.jsqrSuccess))+Number(Boolean(result.zxingSuccess));`);
core=core.replace("...cCounters,perVariant:cDetails};", "...cCounters,perVariant:cDetails,rawSuccessEvidence:cRawEvidence,rawSuccessEvidenceComplete:cRawEvidence.length===(cCounters.jsqrRawSuccessCount+cCounters.zxingRawSuccessCount)};");

for(const token of ["a213PrivacyFingerprint","structuralPassAttribution","rawSuccessEvidence","structuralRejectReasonCategory","currentCanonicalMatch","physicalPositionRelation","malformedPartialClassification","attributionCategory","rawPayloadIncluded:false"]){
  if(!core.includes(token))throw new Error(`A21.3 insertion failed: ${token}`);
}
fs.writeFileSync(corePath,core);
console.log("Stage A21.3 privacy-safe evidence instrumentation appended");
