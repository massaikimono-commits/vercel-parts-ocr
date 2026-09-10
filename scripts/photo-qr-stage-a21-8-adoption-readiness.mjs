export function evaluateA218AdoptionReadiness(a217={}, options={}){
  const additionalRealStatus=String(options.additionalRealRegressionStatus||"NOT_RUN");
  const realEvidence=Boolean(options.realCharacterClassEvidence);
  const groups=Array.isArray(a217?.groups)?a217.groups:[];
  const safeGroups=groups.filter(g=>g?.counterfactualEligibility==="SAFE_CANDIDATE_IF_SCHEMA_CONFIRMED");
  const structuralGate=Boolean(
    a217?.projected31of47Candidate===true &&
    a217?.eligibleGroupCount===3 &&
    a217?.eligibleUniqueFingerprintCount===3 &&
    a217?.sharedSchemaAcrossEligibleGroups===true &&
    safeGroups.length===3 &&
    safeGroups.every(g=>g?.privacySafe===true&&g?.structurallyClean===true&&g?.decoderAgreement===true&&g?.samePhysicalReproduction===true&&g?.currentCollision===false)
  );
  const privacyGate=Boolean(a217?.rawPayloadIncluded===false&&a217?.payloadFragmentIncluded===false&&a217?.unicodeCodePointsIncluded===false);
  const formalIsolation=Boolean(a217?.formalParserChanged===false&&a217?.formalDecoderChanged===false&&a217?.formal28of47Preserved===true&&a217?.gtRuntime===false&&a217?.expectedCountRuntime===false);
  const additionalRealGate=additionalRealStatus==="PASS";
  const eligible=realEvidence&&structuralGate&&privacyGate&&formalIsolation&&additionalRealGate;
  const blockers=[];
  if(!realEvidence)blockers.push("REAL_CHARACTER_CLASS_EVIDENCE_REQUIRED");
  if(!structuralGate)blockers.push("A217_STRUCTURAL_GATE_NOT_MET");
  if(!privacyGate)blockers.push("PRIVACY_GATE_NOT_MET");
  if(!formalIsolation)blockers.push("FORMAL_ISOLATION_NOT_MET");
  if(!additionalRealGate)blockers.push("ADDITIONAL_REAL_REGRESSION_REQUIRED");
  return {
    schema:"icb-certificate-qr-stage-a21-8-adoption-readiness-v1",
    diagnosticOnly:true,
    formalParserChanged:false,
    formalDecoderChanged:false,
    formal28of47Preserved:true,
    projected31of47Candidate:Boolean(a217?.projected31of47Candidate),
    formalCandidateEligible:eligible,
    status:eligible?"FORMAL_CANDIDATE_ELIGIBLE":"BLOCKED_REAL_EVIDENCE_REQUIRED",
    gates:{realEvidence,structuralGate,privacyGate,formalIsolation,additionalRealGate},
    blockers,
    requiredRealSequence:["fixed8 one authorized run with A21.7 character-class evidence","confirm 3 unique physical/fingerprint groups and shared schema","additional-real same-condition regression","only then management decision on guarded Formal acceptance candidate"],
    adoptedHead:null,
  };
}
