import assert from "node:assert/strict";
import {CURRENT_ACCEPT_RULE,C_FORMAT_COUNTERFACTUAL,analyzeA213Detail,currentRuleReasonFromShape} from "./photo-qr-stage-a21-4-format-audit.mjs";

assert.equal(CURRENT_ACCEPT_RULE.formalParserChanged,false);
assert.equal(C_FORMAT_COUNTERFACTUAL.diagnosticOnly,true);
assert.equal(C_FORMAT_COUNTERFACTUAL.formalParserChanged,false);
assert.equal(C_FORMAT_COUNTERFACTUAL.formalDecoderChanged,false);
assert.equal(CURRENT_ACCEPT_RULE.structural.slashCountMin,1);
assert.equal(CURRENT_ACCEPT_RULE.structural.slashFieldsMin,2);

const ev=(fingerprint,decoder,variantId,candidateIndex,length=60)=>({payloadFingerprint:fingerprint,decoder,variantId,candidateIndex,payloadShape:{length,printableRatio:1,asciiVisibleRatio:1,alnumKnownSymbolRatio:1,separatorPattern:"none",recognizedSchemaClass:"compact-printable"},formalParserStep:{parserSchemaRecognized:false,parserSchemaClass:"unrecognized",structuralPass:false},structuralRejectReasonCategory:"slash-schema-mismatch",currentCanonicalMatch:false,physicalPositionRelation:"separate-or-unseen-physical-position",malformedPartialClassification:"schema-or-format-mismatch",attributionCategory:"SEPARATE_PHYSICAL_CERTIFICATE_QR_CANDIDATE"});
const detail={records:[
 {imageId:"IMG_0940.jpeg",A:[{currentCanonicalMatch:true,disposition:"CURRENT_CANONICAL_MATCH"}],C:[ev("fp1","jsQR","native-1",1),ev("fp1","ZXing","native-1",1),ev("fp1","jsQR","native-2",1),ev("fp2","jsQR","native-1",2,72)]},
 {imageId:"IMG_0941.jpeg",A:[],C:[ev("fp3","jsQR","native-1",3),ev("fp3","jsQR","native-2",3)]},
]};
const out=analyzeA213Detail(detail);
assert.equal(out.rawSuccessCount,6);
assert.equal(out.uniqueFingerprintCount,3);
assert.equal(out.uniquePhysicalPositionGroupCount,3);
assert.equal(out.uniqueCandidateGroupCount,3);
assert.equal(out.variantDuplicateCount,3);
assert.equal(out.crossDecoderFingerprintAgreementCount,1);
assert.equal(out.counterfactual.strongGroupCount,1);
assert.equal(out.counterfactual.moderateGroupCount,1);
assert.equal(out.counterfactual.formalAcceptanceChanged,false);
assert.equal(out.A.currentCanonicalMatches,1);
assert.equal(currentRuleReasonFromShape({length:60,printableRatio:1,separatorPattern:"none"}),"slash-schema-mismatch");
assert.equal(currentRuleReasonFromShape({length:1,printableRatio:1,separatorPattern:"none"}),"too-short");

const bad={records:[{imageId:"IMG_0940.jpeg",A:[],C:[{...ev("bad","jsQR","v",1),currentCanonicalMatch:true}]}]};
assert.equal(analyzeA213Detail(bad).counterfactual.eligibleGroupCount,0);

console.log(`Stage A21.4 format audit invariants: PASS; current slash rule preserved; counterfactual diagnostic-only`);
