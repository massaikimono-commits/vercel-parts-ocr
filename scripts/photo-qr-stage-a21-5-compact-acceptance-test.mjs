import assert from "node:assert/strict";
import fs from "node:fs";
import {evaluateA215,A215_RULE,A215_STORAGE_SOURCE} from "../app/eval/certificate-qr-stage-a21-5-compact-acceptance/contract.mjs";

assert.equal(A215_RULE.diagnosticOnly,true);
assert.equal(A215_RULE.formalParserChanged,false);
assert.equal(A215_RULE.formalDecoderChanged,false);
assert.equal(A215_STORAGE_SOURCE,"icb.certificateQr.a214.evidence.v1");

const shape={length:60,printableRatio:1,asciiVisibleRatio:1,alnumKnownSymbolRatio:1,separatorPattern:"none",recognizedSchemaClass:"compact-printable"};
const ev=(fp,image,candidate,decoder,variant)=>({candidateIndex:candidate,decoder,variantId:variant,payloadFingerprint:fp,payloadShape:shape,formalParserStep:{parserSchemaRecognized:false,parserSchemaClass:"unrecognized",structuralPass:false},structuralRejectReasonCategory:"slash-schema-mismatch",currentCanonicalMatch:false,physicalPositionRelation:"separate-or-unseen-physical-position",malformedPartialClassification:"schema-or-format-mismatch",attributionCategory:"SEPARATE_PHYSICAL_CERTIFICATE_QR_CANDIDATE"});
const records=[
 {imageId:"IMG_0940.jpeg",C:[ev("fp40","IMG_0940.jpeg",1,"jsQR","v1"),ev("fp40","IMG_0940.jpeg",1,"ZXing","v2"),ev("fp40","IMG_0940.jpeg",1,"jsQR","v3"),ev("fp40","IMG_0940.jpeg",1,"ZXing","v4"),ev("fp40","IMG_0940.jpeg",1,"jsQR","v5"),ev("fp40","IMG_0940.jpeg",1,"ZXing","v6")],A:[]},
 {imageId:"IMG_0941.jpeg",C:[ev("fp41","IMG_0941.jpeg",2,"jsQR","v1"),ev("fp41","IMG_0941.jpeg",2,"ZXing","v2"),ev("fp41","IMG_0941.jpeg",2,"jsQR","v3"),ev("fp41","IMG_0941.jpeg",2,"ZXing","v4"),ev("fp41","IMG_0941.jpeg",2,"jsQR","v5"),ev("fp41","IMG_0941.jpeg",2,"ZXing","v6"),ev("fp41","IMG_0941.jpeg",2,"jsQR","v7")],A:[]},
 {imageId:"IMG_0943.jpeg",C:[ev("fp43","IMG_0943.jpeg",3,"jsQR","v1"),ev("fp43","IMG_0943.jpeg",3,"ZXing","v2"),ev("fp43","IMG_0943.jpeg",3,"jsQR","v3"),ev("fp43","IMG_0943.jpeg",3,"ZXing","v4"),ev("fp43","IMG_0943.jpeg",3,"jsQR","v5"),ev("fp43","IMG_0943.jpeg",3,"ZXing","v6"),ev("fp43","IMG_0943.jpeg",3,"jsQR","v7")],A:[]}
];
const detail={evaluationHead:"a".repeat(40),records};
const out=evaluateA215(detail);
assert.equal(out.sourceRawSuccessCount,20);
assert.equal(out.sourceUniqueFingerprintCount,3);
assert.equal(out.sourceStrongGroupCount,3);
assert.equal(out.acceptedUniqueFingerprintCount,3);
assert.equal(out.acceptedUniquePhysicalGroupCount,3);
assert.deepEqual(out.acceptedImages,["IMG_0940.jpeg","IMG_0941.jpeg","IMG_0943.jpeg"]);
assert.equal(out.projected.formalAcceptanceChanged,false);
assert.equal(out.projected.formal28of47Preserved,true);
assert.equal(out.isolation.rerunRequired,false);
assert.ok(JSON.stringify(out).length<=6000);

const page=fs.readFileSync("app/eval/certificate-qr-stage-a21-5-compact-acceptance/page.jsx","utf8");
for(const token of ["localStorage.getItem(A215_STORAGE_SOURCE)","再runはしないでください","rerun required","総合管理用A21.5 summaryをコピー"]){assert.ok(page.includes(token),`missing ${token}`);}
assert.equal(page.includes("runPhotoQr"),false);
assert.equal(page.includes('type="file"'),false);
console.log(`Stage A21.5 compact acceptance invariants: PASS; 20 raw -> 3 strong compact physical groups; summary ${JSON.stringify(out).length}/6000`);
