import fs from "node:fs";

const runner=fs.readFileSync("scripts/append-photo-qr-a212-runner.mjs","utf8");
const observed={current:{count:28,loss:0,countingIntegrityFail:false},A:{hypotheses:52,recovery:69,decode:69,raw:14,structuralPass:7,duplicate:5,netNew:0},B:{eligible:27,gatePass:9,rectify:9,decode:9,raw:0,netNew:0},C:{eligible:30,variantAttempts:120,rectify:120,jsqrRaw:11,zxingRaw:9,parserEligible:20,structuralReject:20,netNew:0}};

const requiredRunnerTokens=["perHypothesis","canonicalResult","perVariant","rawSuccess","structuralResult","jsqrRawSuccessCount","zxingRawSuccessCount","parserEligibleCount","structuralRejectCount"];
for(const t of requiredRunnerTokens)if(!runner.includes(t))throw new Error(`runner token missing: ${t}`);

const cRaw=observed.C.jsqrRaw+observed.C.zxingRaw;
const cBoundaryComplete=cRaw===observed.C.parserEligible&&observed.C.parserEligible===observed.C.structuralReject&&observed.C.netNew===0;
const aUnattributed=Math.max(0,observed.A.structuralPass-observed.A.duplicate-observed.A.netNew);

const report={
 schema:"icb-certificate-qr-stage-a21-3-attribution-audit-v1",
 source:"A21.2 compact real-device totals + A21.2 runner semantics",
 fixed8RerunUsed:false,
 formal:{current:28,expected:47,preserved:true,loss:0,countingIntegrityFail:false},
 A:{
  observed:observed.A,
  conclusion:"ACTIVITY_CONFIRMED_EFFICACY_ZERO",
  attributable:{duplicateRejected:observed.A.duplicate,netNew:observed.A.netNew},
  structuralPassNotExactlyAttributableFromCompact:aUnattributed,
  exactAttributionRequiresPerHypothesisEvidence:true,
  reason:"compact summary does not retain per-hypothesis canonical/result detail; browser diagnostic state is not persisted server-side"
 },
 B:{observed:observed.B,conclusion:"NO_RAW_RECOVERY_HOLD_LOW"},
 C:{
  observed:observed.C,
  rawTotal:cRaw,
  allRawSuccessesReachedStructuralRejectBoundary:cBoundaryComplete,
  conclusion:"DECODER_RAW_SUCCESS_CONFIRMED_STRUCTURAL_BOUNDARY_BLOCKS_ALL_20",
  exactRejectCategoryEvaluableFromExistingCompact:false,
  categoriesRequested:["correct-certificate-qr-candidate","current-qr-rediscovery","separate-physical-qr","partial-or-malformed-payload","parser-acceptable-structural-gate-reject","invalid-decode"],
  missingEvidence:["raw decoded payload or privacy-safe payload fingerprint/shape","structural reject reason code","CURRENT canonical comparison per raw success","physical-position relation per raw success"],
  reason:"A21.2 per-variant detail records raw success and PASS/REJECT but does not persist raw payload or structural-reject reason; compact summary drops per-variant detail entirely"
 },
 rerunDecision:{requiredForExactCClassification:true,notRequestedYet:true,why:"the 20 raw-success payload/reject-reason records were never persisted; exact category separation cannot be reconstructed from aggregate counters or runner source"},
 protection:{formalParserChanged:false,formalDecoderChanged:false,gtRuntimeUse:false,expectedCountRuntimeUse:false,frozen:"HOLD",production:"HOLD",candidateLock:"HOLD",physicalSlot:"HOLD",adoptedHead:null}
};

process.stdout.write(JSON.stringify(report,null,2)+"\n");
