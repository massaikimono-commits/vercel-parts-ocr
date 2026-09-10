import assert from "node:assert/strict";
import {evaluateA217Counterfactual} from "./photo-qr-stage-a21-7-structure-counterfactual.mjs";

const evidence=(mask,nonAsciiPositions,extra={})=>({
 schema:"icb-certificate-qr-character-class-v1",
 codePointCount:60,
 utf16CodeUnitLength:60,
 classCounts:{digit:20,latin:20,asciiPunctuation:8,japanese:12,otherNonAscii:0,control:0,replacement:0},
 nonAsciiPositions,
 separatorPositions:[4,9,14,19,24,29,34,39],
 asciiNonAsciiPattern:mask.replace(/[DLP]/g,"A").replace(/[JN]/g,"N"),
 positionClassMask:mask,
 rawPayloadIncluded:false,payloadFragmentIncluded:false,unicodeCodePointsIncluded:false,
 ...extra,
});
const mk=(image,candidate,fp,decoder,variant,cc,extra={})=>({candidateIndex:candidate,decoder,variantId:variant,payloadFingerprint:fp,characterClassEvidence:cc,currentCanonicalMatch:false,physicalPositionRelation:"separate-or-unseen-physical-position",structuralRejectReasonCategory:"slash-schema-mismatch",...extra});
const mask="D".repeat(20)+"L".repeat(20)+"P".repeat(8)+"J".repeat(12);
const pos=Array.from({length:12},(_,i)=>48+i);
const records=["0940","0941","0943"].map((id,i)=>({imageId:`IMG_${id}.jpeg`,A:[],C:[mk(id,i+1,`fp${id}`,"jsQR","v1",evidence(mask,pos)),mk(id,i+1,`fp${id}`,"ZXing","v2",evidence(mask,pos)),mk(id,i+1,`fp${id}`,"jsQR","v3",evidence(mask,pos))]}));
const pass=evaluateA217Counterfactual({records});
assert.equal(pass.eligibleGroupCount,3);
assert.equal(pass.eligibleUniqueFingerprintCount,3);
assert.equal(pass.sharedSchemaAcrossEligibleGroups,true);
assert.equal(pass.projected31of47Candidate,true);
assert.equal(pass.adoptable,false);
assert.equal(pass.formal28of47Preserved,true);
assert.equal(pass.rawPayloadIncluded,false);

// false accept: CURRENT canonical collision
const collision=structuredClone(records);collision[0].C[0].currentCanonicalMatch=true;
let out=evaluateA217Counterfactual({records:collision});
assert.equal(out.eligibleGroupCount,2);
assert.equal(out.projected31of47Candidate,false);
// false accept: physical collision
const phys=structuredClone(records);phys[0].C.forEach(x=>x.physicalPositionRelation="same-current-physical-position-different-payload");
out=evaluateA217Counterfactual({records:phys});
assert.equal(out.eligibleGroupCount,2);
// false accept: decoder disagreement in class mask
const disagree=structuredClone(records);disagree[1].C[1].characterClassEvidence.positionClassMask="D"+mask.slice(1);
out=evaluateA217Counterfactual({records:disagree});
assert.equal(out.eligibleGroupCount,2);
// false accept: control/replacement contamination
const control=structuredClone(records);control[2].C.forEach(x=>x.characterClassEvidence.classCounts.control=1);
out=evaluateA217Counterfactual({records:control});
assert.equal(out.eligibleGroupCount,2);
// false accept: privacy contract violated
const privacy=structuredClone(records);privacy[0].C.forEach(x=>x.characterClassEvidence.payloadFragmentIncluded=true);
out=evaluateA217Counterfactual({records:privacy});
assert.equal(out.eligibleGroupCount,2);
// no common schema across all 3
const schemaMismatch=structuredClone(records);schemaMismatch[2].C.forEach(x=>x.characterClassEvidence.positionClassMask="J"+mask.slice(1));
out=evaluateA217Counterfactual({records:schemaMismatch});
assert.equal(out.sharedSchemaAcrossEligibleGroups,false);
assert.equal(out.projected31of47Candidate,false);

console.log("Stage A21.7 parser counterfactual + false-accept invariants: PASS");
