export const A214_STORAGE_KEY="icb.certificateQr.a214.evidence.v1";

const safeShape=(s={})=>({
 length:Number(s.length||0),printableRatio:Number(s.printableRatio||0),asciiVisibleRatio:Number(s.asciiVisibleRatio||0),alnumKnownSymbolRatio:Number(s.alnumKnownSymbolRatio||0),separatorPattern:s.separatorPattern||"none",recognizedSchemaClass:s.recognizedSchemaClass||"unknown",
});
const safeParser=(p={})=>({parserSchemaRecognized:Boolean(p.parserSchemaRecognized),parserSchemaClass:p.parserSchemaClass||"unrecognized",structuralPass:Boolean(p.structuralPass)});
const safeCharacterClass=(c={})=>({
 schema:c.schema||"unknown",
 codePointCount:Number(c.codePointCount||0),
 utf16CodeUnitLength:Number(c.utf16CodeUnitLength||0),
 classCounts:{digit:Number(c?.classCounts?.digit||0),latin:Number(c?.classCounts?.latin||0),asciiPunctuation:Number(c?.classCounts?.asciiPunctuation||0),japanese:Number(c?.classCounts?.japanese||0),otherNonAscii:Number(c?.classCounts?.otherNonAscii||0),control:Number(c?.classCounts?.control||0),replacement:Number(c?.classCounts?.replacement||0)},
 nonAsciiPositions:Array.isArray(c.nonAsciiPositions)?c.nonAsciiPositions.map(Number).filter(Number.isInteger):[],
 separatorPositions:Array.isArray(c.separatorPositions)?c.separatorPositions.map(Number).filter(Number.isInteger):[],
 asciiNonAsciiPattern:/^[AN]*$/.test(String(c.asciiNonAsciiPattern||""))?String(c.asciiNonAsciiPattern||""):"",
 positionClassMask:/^[DLPJNCR]*$/.test(String(c.positionClassMask||""))?String(c.positionClassMask||""):"",
 rawPayloadIncluded:false,payloadFragmentIncluded:false,unicodeCodePointsIncluded:false,
});
const safeA=e=>({candidateIndex:e?.candidateIndex??null,decoder:e?.decoder||"unknown",ownershipState:e?.ownershipState||"unknown",payloadFingerprint:e?.payloadFingerprint||null,payloadShape:safeShape(e?.payloadShape),currentCanonicalMatch:Boolean(e?.currentCanonicalMatch),disposition:e?.disposition||"unknown",adoptionReason:e?.adoptionReason||"unknown",adoptedEngine:e?.adoptedEngine||"none"});
const safeC=e=>({candidateIndex:e?.candidateIndex??null,decoder:e?.decoder||"unknown",variantId:e?.variantId||"unknown",payloadFingerprint:e?.payloadFingerprint||null,payloadShape:safeShape(e?.payloadShape),characterClassEvidence:e?.characterClassEvidence?safeCharacterClass(e.characterClassEvidence):null,formalParserStep:safeParser(e?.formalParserStep),structuralRejectReasonCategory:e?.structuralRejectReasonCategory||"unknown",currentCanonicalMatch:Boolean(e?.currentCanonicalMatch),physicalPositionRelation:e?.physicalPositionRelation||"position-unavailable",malformedPartialClassification:e?.malformedPartialClassification||"unknown",attributionCategory:e?.attributionCategory||"unknown"});
export function sanitizeA214Detail(detail){
 const out={schema:"icb-certificate-qr-stage-a21-4-persisted-evidence-v1",evaluationHead:detail?.evaluationHead||null,savedAt:new Date().toISOString(),rawPayloadIncluded:false,canonicalPayloadIncluded:false,payloadFragmentIncluded:false,unicodeCodePointsIncluded:false,records:(detail?.records||[]).map(r=>({imageId:r?.imageId||"unknown",diagnosticError:r?.diagnosticError||null,A:(r?.A||[]).map(safeA),C:(r?.C||[]).map(safeC)}))};
 const text=JSON.stringify(out);
 if(/"(?:rawPayload|canonicalPayload|payloadFragment|unicodeCodePoints)"\s*:/.test(text))throw new Error("A214_RECONSTRUCTABLE_PAYLOAD_KEY_FORBIDDEN");
 return out;
}
const shapeKey=s=>JSON.stringify(safeShape(s));
const physicalKey=(imageId,e)=>`${imageId}:${e?.candidateIndex??"?"}:${e?.physicalPositionRelation||"?"}`;
export function analyzeA214Evidence(detail){
 const records=Array.isArray(detail?.records)?detail.records:[];const c=[];for(const r of records)for(const e of r.C||[])c.push({...e,imageId:r.imageId});const a=[];for(const r of records)for(const e of r.A||[])a.push({...e,imageId:r.imageId});
 const fps=new Map(),phys=new Map(),cands=new Map();for(const e of c){if(e.payloadFingerprint){if(!fps.has(e.payloadFingerprint))fps.set(e.payloadFingerprint,[]);fps.get(e.payloadFingerprint).push(e);}const pk=physicalKey(e.imageId,e);if(!phys.has(pk))phys.set(pk,[]);phys.get(pk).push(e);const ck=`${e.imageId}:${e.candidateIndex??"?"}`;if(!cands.has(ck))cands.set(ck,[]);cands.get(ck).push(e);}
 const groups=[...fps.entries()].map(([fingerprint,items])=>{const decoders=[...new Set(items.map(x=>x.decoder))];const variants=[...new Set(items.map(x=>x.variantId))];const positions=[...new Set(items.map(x=>physicalKey(x.imageId,x)))];const shapes=[...new Set(items.map(x=>shapeKey(x.payloadShape)))];const safeBase=items.every(x=>!x.currentCanonicalMatch&&x.physicalPositionRelation==="separate-or-unseen-physical-position"&&x.malformedPartialClassification==="schema-or-format-mismatch"&&x.structuralRejectReasonCategory==="slash-schema-mismatch");const both=decoders.includes("jsQR")&&decoders.includes("ZXing");const stableShape=shapes.length===1;const tier=safeBase&&both&&stableShape?"STRONG":safeBase&&items.length>=2&&stableShape?"MODERATE":"INSUFFICIENT";return {fingerprint,count:items.length,images:[...new Set(items.map(x=>x.imageId))],candidateIndices:[...new Set(items.map(x=>x.candidateIndex))],decoders,variants,positionGroupCount:positions.length,payloadShape:items[0]?.payloadShape||null,stableShape,tier};});
 const hist=(items,keyFn)=>items.reduce((o,x)=>{const k=String(keyFn(x)||"unknown");o[k]=(o[k]||0)+1;return o;},{});
 const result={schema:"icb-certificate-qr-stage-a21-4-real-attribution-summary-v1",evaluationHead:detail?.evaluationHead||null,rawSuccessCount:c.length,uniqueFingerprintCount:fps.size,uniquePhysicalPositionGroupCount:phys.size,uniqueCandidateGroupCount:cands.size,variantDuplicateCount:Math.max(0,c.length-cands.size),jsqrCount:c.filter(x=>x.decoder==="jsQR").length,zxingCount:c.filter(x=>x.decoder==="ZXing").length,crossDecoderFingerprintAgreementCount:groups.filter(g=>g.decoders.includes("jsQR")&&g.decoders.includes("ZXing")).length,payloadLengthHistogram:hist(c,x=>x.payloadShape?.length),payloadShapeHistogram:hist(c,x=>shapeKey(x.payloadShape)),separatorHistogram:hist(c,x=>x.payloadShape?.separatorPattern),parserSchemaHistogram:hist(c,x=>x.formalParserStep?.parserSchemaClass),rejectReasonHistogram:hist(c,x=>x.structuralRejectReasonCategory),fingerprintGroups:groups,counterfactual:{eligibleGroupCount:groups.filter(g=>g.tier!=="INSUFFICIENT").length,strongGroupCount:groups.filter(g=>g.tier==="STRONG").length,moderateGroupCount:groups.filter(g=>g.tier==="MODERATE").length,formalAcceptanceChanged:false,diagnosticOnly:true},A:{structuralPass:a.length,currentCanonicalMatches:a.filter(x=>x.currentCanonicalMatch).length,dispositionHistogram:hist(a,x=>x.disposition)},isolation:{formalParserChanged:false,formalDecoderChanged:false,gtRuntime:false,expectedCountRuntime:false,diagnosticOnly:true}};
 const compact=JSON.stringify(result);if(compact.length>6000)throw new Error(`A214_SUMMARY_TOO_LONG_${compact.length}`);return result;
}
