import fs from "node:fs";
import assert from "node:assert/strict";
import {A212_FIXED_IDS,A212_COMPACT_MAX_CHARS,buildA212Summary,buildA212CompactSummary,validateA212ImageRecord} from "../app/eval/certificate-qr-stage-a21-2-direct-validity/contract.mjs";

const append=fs.readFileSync("scripts/append-photo-qr-a212-runner.mjs","utf8");
const page=fs.readFileSync("app/eval/certificate-qr-stage-a21-2-direct-validity/page.jsx","utf8");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));

for(const token of ["runPhotoQrA212Counterfactual","inputHypothesisCount","recoveryAttemptCount","decodeAttemptCount","rawDecodeSuccessCount","structuralPassCount","positionConflictRejectedCount","actualRectifyAttemptCount","actualRectifyGeneratedCount","actualDecodeAttemptCount","actualRawDecodeSuccessCount","actualStructuralPassCount","actualDecodeFailCount","actualVariantAttemptCount","rectifyGeneratedCount","jsqrAttemptCount","zxingAttemptCount","jsqrRawSuccessCount","zxingRawSuccessCount","parserEligibleCount","structuralRejectCount","perHypothesis","perTriplet","perVariant"]){assert.ok(append.includes(token),`missing A21.2 token ${token}`);}
assert.ok(append.includes('diagnosticOnly:true'));
assert.ok(append.includes('gtUsedDuringDecode:false'));
assert.ok(append.includes('expectedQrCountUsedDuringDecode:false'));
assert.ok(append.includes('formalDecodeLogicChanged:false'));
assert.ok(!page.includes("iframe"));
assert.ok(!page.includes("button.click"));
assert.ok(!page.includes("input.files"));
assert.ok(page.includes("総合管理用短縮summaryをコピー"));
assert.ok(page.includes("詳細診断JSONをコピー"));
assert.ok(page.includes("A212_COMPACT_MAX_CHARS"));
assert.ok(pkg.scripts.build.includes("photo-qr-stage-a21-2-validity-test.mjs")||pkg.scripts["test:photo-qr-a21-2"],"package script must include A21.2 test");

function result(currentCount=3){return {schema:"icb-certificate-qr-stage-a21-2-direct-counterfactual-v1",gtUsedDuringDecode:false,expectedQrCountUsedDuringDecode:false,formalDecodeLogicChanged:false,diagnosticOnly:true,current:{physicalUniqueQrCount:currentCount,runtimeMs:12,attemptCount:7,lostCurrentQrCount:0,countingIntegrityFail:false},a:{physicalUniqueQrCount:currentCount,netNewCanonicalQrCount:0,runtimeMs:2,attemptCount:1,lostCurrentQrCount:0,countingIntegrityFail:false,inputHypothesisCount:2,recoveryAttemptCount:2,decodeAttemptCount:1,rawDecodeSuccessCount:0,structuralPassCount:0,duplicateRejectedCount:0,positionConflictRejectedCount:0},b:{physicalUniqueQrCount:currentCount,netNewCanonicalQrCount:0,runtimeMs:3,attemptCount:1,lostCurrentQrCount:0,countingIntegrityFail:false,inspectedTripletCount:3,eligibleTripletCount:2,normalizedGatePassCount:1,normalizedGateRejectCount:1,actualRectifyAttemptCount:1,actualRectifyGeneratedCount:1,actualDecodeAttemptCount:1,actualRawDecodeSuccessCount:0,actualStructuralPassCount:0,actualStructuralRejectCount:0,actualDecodeFailCount:1,duplicateRejectedCount:0},c:{physicalUniqueQrCount:currentCount,netNewCanonicalQrCount:0,runtimeMs:4,attemptCount:8,lostCurrentQrCount:0,countingIntegrityFail:false,eligibleGeometryCount:1,configuredVariantCount:4,actualVariantAttemptCount:4,rectifyGeneratedCount:4,jsqrAttemptCount:4,zxingAttemptCount:4,jsqrRawSuccessCount:0,zxingRawSuccessCount:0,parserEligibleCount:0,structuralRejectCount:0,duplicateRejectedCount:0}};}
const formalCounts=[4,5,0,4,0,5,5,5];
const records=A212_FIXED_IDS.map((imageId,i)=>({imageId,diagnosticError:null,result:result(formalCounts[i])}));
records.forEach(validateA212ImageRecord);
const summary=buildA212Summary({evaluationHead:"a".repeat(40),records});
const compact=buildA212CompactSummary({evaluationHead:"a".repeat(40),records});
assert.equal(summary.selectedImageCount,8);
assert.equal(summary.current.physicalUniqueQrCount,28);
assert.equal(summary.formalReference.preserved,true);
assert.equal(summary.guards.positive0947Current5of5,true);
assert.equal(summary.guards.currentLossZero,true);
assert.equal(summary.guards.countingIntegrityFail,false);
assert.equal(summary.isolation.groundTruthUsedDuringDecode,false);
assert.equal(summary.isolation.expectedQrCountUsedDuringDecode,false);
assert.equal(summary.current.runtimeAndAttemptSeparated,true);
assert.equal(compact.fixed8,true);
assert.equal(compact.CURRENT.qr,28);
assert.equal(compact.formal28of47Preserved,true);
assert.equal(compact.gtRuntime,false);
assert.equal(compact.countingIntegrityFail,false);
assert.equal(compact.perImage.length,8);
assert.ok(compact.perImage.every(x=>x.CURRENT&&x.A&&x.B&&x.C));
assert.ok(JSON.stringify(compact).length<=A212_COMPACT_MAX_CHARS,`compact summary exceeded ${A212_COMPACT_MAX_CHARS}`);
assert.throws(()=>buildA212Summary({evaluationHead:null,records:records.slice(0,7)}),/A212_REQUIRES_EIGHT_RECORDS/);
assert.throws(()=>buildA212CompactSummary({evaluationHead:null,records:records.slice(0,7)}),/A212_REQUIRES_EIGHT_RECORDS/);
const badB=structuredClone(records[0]);badB.result.b.normalizedGatePassCount=2;assert.throws(()=>validateA212ImageRecord(badB),/A212_B_GATE_COUNTER_MISMATCH/);
const badC=structuredClone(records[0]);badC.result.c.jsqrAttemptCount=3;assert.throws(()=>validateA212ImageRecord(badC),/A212_C_DECODER_COUNTER_MISMATCH/);
const huge=structuredClone(records);huge.forEach((r,i)=>{r.result.a.perHypothesis=Array.from({length:100},()=>({trace:"x".repeat(1000)}));r.result.b.perTriplet=Array.from({length:100},()=>({trace:"y".repeat(1000)}));r.result.c.perVariant=Array.from({length:100},()=>({trace:"z".repeat(1000)}));if(i===0)r.diagnosticError={name:"Error",message:"q".repeat(5000)};});
const bounded=buildA212CompactSummary({evaluationHead:"b".repeat(40),records:huge});
assert.ok(JSON.stringify(bounded).length<=A212_COMPACT_MAX_CHARS,"compact must ignore/detail-truncate huge traces");
console.log(`Stage A21.2 validity + compact summary: PASS (${JSON.stringify(compact).length}/${A212_COMPACT_MAX_CHARS})`);
