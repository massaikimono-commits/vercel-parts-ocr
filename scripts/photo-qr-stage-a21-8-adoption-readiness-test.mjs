import assert from "node:assert/strict";
import {evaluateA218AdoptionReadiness} from "./photo-qr-stage-a21-8-adoption-readiness.mjs";

const group=(fp)=>({fingerprint:fp,counterfactualEligibility:"SAFE_CANDIDATE_IF_SCHEMA_CONFIRMED",privacySafe:true,structurallyClean:true,decoderAgreement:true,samePhysicalReproduction:true,currentCollision:false});
const base={projected31of47Candidate:true,eligibleGroupCount:3,eligibleUniqueFingerprintCount:3,sharedSchemaAcrossEligibleGroups:true,rawPayloadIncluded:false,payloadFragmentIncluded:false,unicodeCodePointsIncluded:false,formalParserChanged:false,formalDecoderChanged:false,formal28of47Preserved:true,gtRuntime:false,expectedCountRuntime:false,groups:[group("a"),group("b"),group("c")]};
let out=evaluateA218AdoptionReadiness(base,{realCharacterClassEvidence:false,additionalRealRegressionStatus:"NOT_RUN"});
assert.equal(out.formalCandidateEligible,false);assert.equal(out.status,"BLOCKED_REAL_EVIDENCE_REQUIRED");assert.deepEqual(out.blockers,["REAL_CHARACTER_CLASS_EVIDENCE_REQUIRED","ADDITIONAL_REAL_REGRESSION_REQUIRED"]);assert.equal(out.formal28of47Preserved,true);assert.equal(out.adoptedHead,null);
out=evaluateA218AdoptionReadiness(base,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"NOT_RUN"});
assert.equal(out.formalCandidateEligible,false);assert.equal(out.status,"BLOCKED_ADDITIONAL_REAL_REQUIRED");assert.deepEqual(out.blockers,["ADDITIONAL_REAL_REGRESSION_REQUIRED"]);
out=evaluateA218AdoptionReadiness(base,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"PASS"});
assert.equal(out.formalCandidateEligible,true);assert.equal(out.status,"FORMAL_CANDIDATE_ELIGIBLE");assert.deepEqual(out.blockers,[]);
const collision=structuredClone(base);collision.groups[1].currentCollision=true;out=evaluateA218AdoptionReadiness(collision,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"PASS"});assert.equal(out.formalCandidateEligible,false);assert.equal(out.status,"BLOCKED_SAFETY_GATE");assert.ok(out.blockers.includes("A217_STRUCTURAL_GATE_NOT_MET"));
const privacy=structuredClone(base);privacy.payloadFragmentIncluded=true;out=evaluateA218AdoptionReadiness(privacy,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"PASS"});assert.equal(out.formalCandidateEligible,false);assert.equal(out.status,"BLOCKED_SAFETY_GATE");assert.ok(out.blockers.includes("PRIVACY_GATE_NOT_MET"));
const noShared=structuredClone(base);noShared.sharedSchemaAcrossEligibleGroups=false;noShared.projected31of47Candidate=false;out=evaluateA218AdoptionReadiness(noShared,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"PASS"});assert.equal(out.formalCandidateEligible,false);assert.equal(out.status,"BLOCKED_SAFETY_GATE");
out=evaluateA218AdoptionReadiness(base,{realCharacterClassEvidence:true,additionalRealRegressionStatus:"FAIL"});assert.equal(out.formalCandidateEligible,false);assert.equal(out.status,"BLOCKED_ADDITIONAL_REAL_REQUIRED");assert.ok(out.blockers.includes("ADDITIONAL_REAL_REGRESSION_REQUIRED"));
console.log("Stage A21.8 adoption-readiness invariants: PASS");
