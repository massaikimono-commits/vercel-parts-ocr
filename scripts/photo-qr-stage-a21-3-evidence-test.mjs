import fs from "node:fs";
import assert from "node:assert/strict";
import {A213_FIXED_IDS,buildA213Summary,buildA213Detail,validateA213Record} from "../app/eval/certificate-qr-stage-a21-3-evidence/contract.mjs";

const append=fs.readFileSync("scripts/append-photo-qr-a213-evidence.mjs","utf8");
const page=fs.readFileSync("app/eval/certificate-qr-stage-a21-3-evidence/page.jsx","utf8");
for(const token of ["a213PrivacyFingerprint","SHA-256","payloadFingerprint","payloadShape","formalParserStep","structuralRejectReasonCategory","currentCanonicalMatch","physicalPositionRelation","malformedPartialClassification","attributionCategory","structuralPassAttribution","rawSuccessEvidence"]){assert.ok(append.includes(token),`missing ${token}`);}
assert.ok(!page.includes("iframe"));
assert.ok(!page.includes("input.files"));
assert.ok(!page.includes("button.click"));
assert.equal((page.match(/総合管理用短縮summaryをコピー/g)||[]).length,1);
assert.equal((page.match(/詳細診断JSONをコピー/g)||[]).length,2); // status + button

function fakeResult(i){
 const current=[4,5,0,4,0,5,5,5][i];
 const aCount=i===0?7:0;
 const a=Array.from({length:aCount},(_,j)=>({decoder:j%2?"ZXing":"jsQR",payloadFingerprint:`f${j}`.padEnd(24,"0"),payloadShape:{length:60},currentCanonicalMatch:j<5,disposition:j<5?"CURRENT_CANONICAL_MATCH":j===5?"CROSS_ENGINE_CONFLICT_NOT_ADOPTED":"STRUCTURAL_PASS_NO_CANONICAL",rawPayloadIncluded:false,canonicalPayloadIncluded:false}));
 const cCount=i===0?20:0;
 const c=Array.from({length:cCount},(_,j)=>({decoder:j<11?"jsQR":"ZXing",variantId:"native-nearest",candidateIndex:1,payloadFingerprint:`c${j}`.padEnd(24,"0"),payloadShape:{length:j%2?60:42,recognizedSchemaClass:j%3?"compact-printable":"unknown"},formalParserStep:{parserSchemaRecognized:j%4===0,parserSchemaClass:j%4===0?"known":"unrecognized",structuralPass:false},structuralRejectReasonCategory:j%2?"slash-schema-mismatch":"length-mismatch",currentCanonicalMatch:j<6,physicalPositionRelation:j<6?"current-canonical-rediscovery":"separate-or-unseen-physical-position",malformedPartialClassification:j%2?"schema-or-format-mismatch":"partial-or-length-mismatch",attributionCategory:j<6?"CURRENT_REDISCOVERY":j%2?"CERTIFICATE_QR_CANDIDATE":"PARTIAL_OR_MALFORMED",rawPayloadIncluded:false,canonicalPayloadIncluded:false}));
 return {current:{physicalUniqueQrCount:current,lostCurrentQrCount:0,countingIntegrityFail:false,runtimeMs:10},a:{structuralPassCount:aCount,structuralPassAttribution:a,structuralPassAttributionComplete:true,netNewCanonicalQrCount:0,lostCurrentQrCount:0,runtimeMs:20},b:{actualRawDecodeSuccessCount:0,netNewCanonicalQrCount:0,lostCurrentQrCount:0,runtimeMs:5},c:{jsqrRawSuccessCount:i===0?11:0,zxingRawSuccessCount:i===0?9:0,rawSuccessEvidence:c,rawSuccessEvidenceComplete:true,netNewCanonicalQrCount:0,lostCurrentQrCount:0,runtimeMs:30},gtUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeLogicChanged:false,diagnosticOnly:true};
}
const records=A213_FIXED_IDS.map((imageId,i)=>({imageId,diagnosticError:null,result:fakeResult(i)}));
records.forEach(validateA213Record);
const summary=buildA213Summary({evaluationHead:"a".repeat(40),records});
assert.equal(summary.formal.current,28);
assert.equal(summary.formal.preserved,true);
assert.equal(summary.A.structuralPass,7);
assert.equal(summary.A.allAttributed,true);
assert.equal(summary.C.rawSuccess,20);
assert.equal(summary.C.allRawAttributed,true);
assert.ok(JSON.stringify(summary).length<=6000);
const detail=buildA213Detail({evaluationHead:"a".repeat(40),records});
assert.equal(detail.rawPayloadIncluded,false);
assert.equal(detail.canonicalPayloadIncluded,false);
assert.ok(!JSON.stringify(detail).includes("raw payload text"));
assert.throws(()=>buildA213Summary({evaluationHead:null,records:records.slice(0,7)}),/A213_REQUIRES_EIGHT_RECORDS/);
const bad=structuredClone(records[0]);bad.result.c.rawSuccessEvidence.pop();assert.throws(()=>validateA213Record(bad),/A213_C_EVIDENCE_INCOMPLETE|A213_C_RAW_COUNT_MISMATCH/);
console.log(`Stage A21.3 evidence invariants: PASS (${JSON.stringify(summary).length}/6000)`);
