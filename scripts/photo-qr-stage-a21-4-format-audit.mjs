export const CURRENT_ACCEPT_RULE={
 name:"CURRENT_ACCEPT_RULE",
 structural:{lengthMin:3,lengthMax:1200,printableRatioMin:.96,replacementCountMax:0,controlCountMax:0,slashCountMin:1,slashCountMax:40,slashFieldsMin:2,slashFieldsMax:50},
 compactConsensus:{requiresBothEnginesSameCanonical:true,length:60,printableRatio:1,asciiVisibleRatio:1,alnumKnownSymbolRatioMin:.98,separatorPattern:"none",recognizedSchemaClass:"compact-printable",samePhysicalPosition:true,candidateAligned:true},
 formalParserChanged:false,
};

export const C_FORMAT_COUNTERFACTUAL={
 name:"C_FORMAT_COUNTERFACTUAL",
 diagnosticOnly:true,
 formalParserChanged:false,
 formalDecoderChanged:false,
 purpose:"reclassify slash-schema-mismatch evidence without changing formal acceptance",
 prerequisites:["same privacy-safe fingerprint repeated","stable payload shape","separate-or-unseen physical position","no CURRENT canonical match","no malformed character/length evidence"],
 confidenceTiers:{
  STRONG:["jsQR+ZXing same fingerprint at same physical group","stable shape across variants"],
  MODERATE:["same fingerprint repeated across variants/decoder with stable position+shape"],
  INSUFFICIENT:["single raw success only","position unavailable","shape inconsistent"]
 }
};

const keyShape=s=>JSON.stringify({length:s?.length||0,separatorPattern:s?.separatorPattern||"none",recognizedSchemaClass:s?.recognizedSchemaClass||"unknown",printableRatio:s?.printableRatio||0,asciiVisibleRatio:s?.asciiVisibleRatio||0,alnumKnownSymbolRatio:s?.alnumKnownSymbolRatio||0});
const posKey=e=>`${e.imageId||"?"}:${e.candidateIndex??"?"}:${e.physicalPositionRelation||"?"}`;

export function analyzeA213Detail(detail){
 const records=Array.isArray(detail?.records)?detail.records:[];
 const c=[];
 for(const r of records)for(const e of r?.C||[])c.push({...e,imageId:r.imageId});
 const a=[];
 for(const r of records)for(const e of r?.A||[])a.push({...e,imageId:r.imageId});
 const fingerprints=new Map(),physical=new Map(),candidateVariants=new Map();
 for(const e of c){
  if(e.payloadFingerprint){if(!fingerprints.has(e.payloadFingerprint))fingerprints.set(e.payloadFingerprint,[]);fingerprints.get(e.payloadFingerprint).push(e);}
  const pk=posKey(e);if(!physical.has(pk))physical.set(pk,[]);physical.get(pk).push(e);
  const ck=`${e.imageId}:${e.candidateIndex??"?"}`;if(!candidateVariants.has(ck))candidateVariants.set(ck,[]);candidateVariants.get(ck).push(e);
 }
 const groups=[...fingerprints.entries()].map(([fingerprint,items])=>{
  const decoders=[...new Set(items.map(x=>x.decoder))];
  const shapes=[...new Set(items.map(x=>keyShape(x.payloadShape)))];
  const positions=[...new Set(items.map(posKey))];
  const sameDecoderConsensus=decoders.includes("jsQR")&&decoders.includes("ZXing");
  const stableShape=shapes.length===1;
  const safeBase=items.every(x=>!x.currentCanonicalMatch&&x.physicalPositionRelation==="separate-or-unseen-physical-position"&&x.malformedPartialClassification==="schema-or-format-mismatch"&&x.structuralRejectReasonCategory==="slash-schema-mismatch");
  const tier=safeBase&&sameDecoderConsensus&&stableShape?"STRONG":safeBase&&items.length>=2&&stableShape?"MODERATE":"INSUFFICIENT";
  return {fingerprint,count:items.length,images:[...new Set(items.map(x=>x.imageId))],candidateIndices:[...new Set(items.map(x=>x.candidateIndex))],decoders,variants:[...new Set(items.map(x=>x.variantId))],positionGroupCount:positions.length,stableShape,tier,payloadShape:items[0]?.payloadShape||null};
 });
 const slashStructure={
  noSlashShape:c.filter(x=>x.payloadShape?.separatorPattern==="none").length,
  slashShape:c.filter(x=>x.payloadShape?.separatorPattern==="slash").length,
  otherShape:c.filter(x=>!["none","slash"].includes(x.payloadShape?.separatorPattern)).length,
 };
 return {
  rawSuccessCount:c.length,
  uniqueFingerprintCount:fingerprints.size,
  uniquePhysicalPositionGroupCount:physical.size,
  uniqueCandidateGroupCount:candidateVariants.size,
  variantDuplicateCount:Math.max(0,c.length-candidateVariants.size),
  jsqrCount:c.filter(x=>x.decoder==="jsQR").length,
  zxingCount:c.filter(x=>x.decoder==="ZXing").length,
  crossDecoderFingerprintAgreementCount:groups.filter(g=>g.decoders.includes("jsQR")&&g.decoders.includes("ZXing")).length,
  payloadLengthHistogram:Object.fromEntries([...new Set(c.map(x=>x.payloadShape?.length||0))].sort((a,b)=>a-b).map(n=>[n,c.filter(x=>(x.payloadShape?.length||0)===n).length])),
  slashStructure,
  rejectReasonHistogram:c.reduce((o,x)=>(o[x.structuralRejectReasonCategory||"unknown"]=(o[x.structuralRejectReasonCategory||"unknown"]||0)+1,o),{}),
  parserSchemaHistogram:c.reduce((o,x)=>{const k=x.formalParserStep?.parserSchemaClass||"unrecognized";o[k]=(o[k]||0)+1;return o;},{}),
  fingerprintGroups:groups,
  counterfactual:{eligibleGroupCount:groups.filter(g=>g.tier!=="INSUFFICIENT").length,strongGroupCount:groups.filter(g=>g.tier==="STRONG").length,moderateGroupCount:groups.filter(g=>g.tier==="MODERATE").length,formalAcceptanceChanged:false},
  A:{structuralPass:a.length,currentCanonicalMatches:a.filter(x=>x.currentCanonicalMatch).length,dispositionHistogram:a.reduce((o,x)=>(o[x.disposition||"unknown"]=(o[x.disposition||"unknown"]||0)+1,o),{})},
 };
}

export function currentRuleReasonFromShape(shape={}){
 const len=Number(shape.length||0);const sep=shape.separatorPattern||"none";
 if(len<3)return "too-short";if(len>1200)return "too-long";
 if(Number(shape.printableRatio||0)<.96)return "low-printable-ratio";
 if(sep!=="slash")return "slash-schema-mismatch";
 return "requires-exact-slash-count-fields-from-raw-structural-evidence";
}
