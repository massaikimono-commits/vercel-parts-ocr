export const A217_CLASS_CODES=Object.freeze({D:"digit",L:"latin",P:"ascii-punctuation",J:"japanese",N:"other-non-ascii",C:"control",R:"replacement"});

function runs(indices=[]){
 const sorted=[...new Set(indices.map(Number).filter(Number.isInteger))].sort((a,b)=>a-b);
 const out=[];let start=null,prev=null;
 for(const i of sorted){if(start===null){start=prev=i;continue;}if(i===prev+1){prev=i;continue;}out.push({start,end:prev,length:prev-start+1});start=prev=i;}
 if(start!==null)out.push({start,end:prev,length:prev-start+1});
 return out;
}
const same=(values)=>new Set(values.map(v=>JSON.stringify(v))).size===1;
const groupKey=(imageId,e)=>`${imageId}:${e?.candidateIndex??"?"}`;

export function summarizeA217Group(imageId,items){
 const masks=items.map(x=>x.characterClassEvidence?.positionClassMask||null);
 const nonAscii=items.map(x=>x.characterClassEvidence?.nonAsciiPositions||[]);
 const separators=items.map(x=>x.characterClassEvidence?.separatorPositions||[]);
 const counts=items.map(x=>x.characterClassEvidence?.classCounts||{});
 const decoders=[...new Set(items.map(x=>x.decoder))];
 const variants=[...new Set(items.map(x=>x.variantId))];
 const ev=items[0]?.characterClassEvidence||{};
 const currentCollision=items.some(x=>x.currentCanonicalMatch||x.physicalPositionRelation!=="separate-or-unseen-physical-position");
 const decoderAgreement=decoders.includes("jsQR")&&decoders.includes("ZXing")&&same(masks.filter(Boolean));
 const samePhysicalReproduction=items.length>=2&&same(masks.filter(Boolean))&&same(nonAscii)&&same(separators)&&same(counts);
 const privacySafe=items.every(x=>x.characterClassEvidence?.rawPayloadIncluded===false&&x.characterClassEvidence?.payloadFragmentIncluded===false&&x.characterClassEvidence?.unicodeCodePointsIncluded===false);
 const structurallyClean=Number(ev.codePointCount||0)===60&&Number(ev.classCounts?.control||0)===0&&Number(ev.classCounts?.replacement||0)===0;
 return {imageId,candidateIndex:items[0]?.candidateIndex??null,fingerprint:items[0]?.payloadFingerprint||null,decoders,variants,decoderAgreement,samePhysicalReproduction,currentCollision,privacySafe,structurallyClean,classCounts:ev.classCounts||null,nonAsciiPositions:ev.nonAsciiPositions||[],nonAsciiRuns:runs(ev.nonAsciiPositions||[]),separatorPositions:ev.separatorPositions||[],asciiNonAsciiPattern:ev.asciiNonAsciiPattern||null,positionClassMask:ev.positionClassMask||null,parserReject:items[0]?.structuralRejectReasonCategory||"unknown",counterfactualEligibility:privacySafe&&structurallyClean&&decoderAgreement&&samePhysicalReproduction&&!currentCollision?"SAFE_CANDIDATE_IF_SCHEMA_CONFIRMED":"REJECT"};
}

export function evaluateA217Counterfactual(detail){
 const records=Array.isArray(detail?.records)?detail.records:[];
 const groups=[];
 for(const r of records){
  const by=new Map();
  for(const e of r?.C||[]){const k=groupKey(r.imageId,e);if(!by.has(k))by.set(k,[]);by.get(k).push(e);}
  for(const items of by.values())if(items.some(x=>x.characterClassEvidence))groups.push(summarizeA217Group(r.imageId,items));
 }
 const strong=groups.filter(g=>g.counterfactualEligibility==="SAFE_CANDIDATE_IF_SCHEMA_CONFIRMED");
 const schemaMasks=[...new Set(strong.map(g=>g.positionClassMask).filter(Boolean))];
 const nonAsciiPatterns=[...new Set(strong.map(g=>g.asciiNonAsciiPattern).filter(Boolean))];
 const commonSchema=strong.length>=2&&schemaMasks.length===1&&nonAsciiPatterns.length===1;
 const uniqueFingerprints=new Set(strong.map(g=>g.fingerprint).filter(Boolean)).size;
 return {schema:"icb-certificate-qr-stage-a21-7-structure-counterfactual-v1",diagnosticOnly:true,formalParserChanged:false,formalDecoderChanged:false,formal28of47Preserved:true,gtRuntime:false,expectedCountRuntime:false,rawPayloadIncluded:false,payloadFragmentIncluded:false,unicodeCodePointsIncluded:false,groups,eligibleGroupCount:strong.length,eligibleUniqueFingerprintCount:uniqueFingerprints,sharedSchemaAcrossEligibleGroups:commonSchema,sharedSchemaMaskCount:schemaMasks.length,projected31of47Candidate:strong.length===3&&uniqueFingerprints===3&&commonSchema,adoptable:false,requiredBeforeAcceptance:["3 unique physical/fingerprint groups remain decoder-agreed","class mask and non-ASCII positions reproduce within each physical group","no control/replacement classes","no CURRENT canonical/physical collision","all 3 groups share one privacy-safe class schema OR an independently validated compact schema","additional-real regression gate remains required"]};
}
