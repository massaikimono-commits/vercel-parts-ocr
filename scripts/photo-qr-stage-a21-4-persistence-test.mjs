import assert from "node:assert/strict";
import fs from "node:fs";
import {sanitizeA214Detail,analyzeA214Evidence,A214_STORAGE_KEY} from "../app/eval/certificate-qr-stage-a21-4-evidence/contract.mjs";

assert.equal(A214_STORAGE_KEY,"icb.certificateQr.a214.evidence.v1");
const ev=(fp,decoder,variant,candidate)=>({candidateIndex:candidate,decoder,variantId:variant,payloadFingerprint:fp,payloadShape:{length:60,printableRatio:1,asciiVisibleRatio:1,alnumKnownSymbolRatio:1,separatorPattern:"none",recognizedSchemaClass:"compact-printable"},formalParserStep:{parserSchemaRecognized:false,parserSchemaClass:"unrecognized",structuralPass:false},structuralRejectReasonCategory:"slash-schema-mismatch",currentCanonicalMatch:false,physicalPositionRelation:"separate-or-unseen-physical-position",malformedPartialClassification:"schema-or-format-mismatch",attributionCategory:"SEPARATE_PHYSICAL_CERTIFICATE_QR_CANDIDATE",rawPayloadIncluded:false,canonicalPayloadIncluded:false,rawPayload:"MUST_NOT_PERSIST",canonicalPayload:"MUST_NOT_PERSIST"});
const input={evaluationHead:"1".repeat(40),rawPayloadIncluded:false,canonicalPayloadIncluded:false,records:[{imageId:"IMG_0940.jpeg",diagnosticError:null,A:[{candidateIndex:1,decoder:"jsQR",ownershipState:"single",payloadFingerprint:"a1",payloadShape:{length:20},currentCanonicalMatch:true,disposition:"CURRENT_CANONICAL_MATCH",rawPayload:"SECRET"}],C:[ev("fp1","jsQR","n1",1),ev("fp1","ZXing","n2",1)]}]};
const safe=sanitizeA214Detail(input);
const serialized=JSON.stringify(safe);
assert.equal(serialized.includes("MUST_NOT_PERSIST"),false);
assert.equal(serialized.includes("SECRET"),false);
assert.equal(serialized.includes('"rawPayload":'),false);
assert.equal(serialized.includes('"canonicalPayload":'),false);
assert.equal(safe.rawPayloadIncluded,false);
assert.equal(safe.canonicalPayloadIncluded,false);
assert.ok(safe.savedAt);
const out=analyzeA214Evidence(safe);
assert.equal(out.rawSuccessCount,2);
assert.equal(out.uniqueFingerprintCount,1);
assert.equal(out.uniquePhysicalPositionGroupCount,1);
assert.equal(out.uniqueCandidateGroupCount,1);
assert.equal(out.variantDuplicateCount,1);
assert.equal(out.crossDecoderFingerprintAgreementCount,1);
assert.equal(out.counterfactual.strongGroupCount,1);
assert.equal(out.counterfactual.formalAcceptanceChanged,false);
assert.equal(out.counterfactual.diagnosticOnly,true);
assert.ok(JSON.stringify(out).length<=6000);

const page=fs.readFileSync("app/eval/certificate-qr-stage-a21-4-evidence/page.jsx","utf8");
for(const token of ["localStorage.getItem(A214_STORAGE_KEY)","localStorage.setItem(A214_STORAGE_KEY","sanitizeA214Detail","analyzeA214Evidence","A21.4を1回だけ実行","raw payload/PII全文は保存せず"]){assert.ok(page.includes(token),`missing page invariant ${token}`);}
assert.equal(page.includes("localStorage.removeItem(A214_STORAGE_KEY)"),false);
assert.equal(page.includes("sessionStorage"),false);
assert.equal(page.includes("indexedDB"),false);
assert.equal(page.includes("button.click"),false);
assert.equal(page.includes("input.files"),false);

console.log(`Stage A21.4 persistence invariants: PASS; privacy-safe localStorage restore + successful-run-only replacement + compact ${JSON.stringify(out).length}/6000`);
