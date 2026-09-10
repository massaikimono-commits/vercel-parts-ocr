import assert from 'node:assert/strict';
import { analyzeCharacterClassShape, analyzeA216PersistedEvidence, A216_RULE } from './photo-qr-stage-a21-6-character-class-audit.mjs';

assert.equal(A216_RULE.diagnosticOnly, true);
assert.equal(A216_RULE.formalParserChanged, false);
assert.equal(A216_RULE.formalDecoderChanged, false);
assert.equal(A216_RULE.gateRelaxationAllowed, false);
assert.equal(A216_RULE.qrRerunAllowed, false);

const shape={length:60,printableRatio:1,asciiVisibleRatio:.8,alnumKnownSymbolRatio:.8,separatorPattern:'none',recognizedSchemaClass:'compact-printable'};
const a=analyzeCharacterClassShape(shape);
assert.equal(a.asciiVisibleCount,48);
assert.equal(a.nonAsciiCount,12);
assert.equal(a.alnumKnownSymbolCombinedCount,48);
assert.equal(a.asciiOtherCount,0);
assert.equal(a.alnumCount,null);
assert.equal(a.knownSymbolCount,null);
assert.equal(a.perPositionCharacterClass,null);

const mk=(fp,img,dec,cand)=>({imageId:img,C:[{payloadFingerprint:fp,decoder:dec,candidateIndex:cand,physicalPositionRelation:'separate-or-unseen-physical-position',payloadShape:shape}]});
const detail={evaluationHead:'fixture',records:[mk('f1','IMG_0940.jpeg','jsQR',1),mk('f1','IMG_0940.jpeg','ZXing',1),mk('f2','IMG_0941.jpeg','jsQR',2),mk('f2','IMG_0941.jpeg','ZXing',2),mk('f3','IMG_0943.jpeg','jsQR',3),mk('f3','IMG_0943.jpeg','ZXing',3)]};
const r=analyzeA216PersistedEvidence(detail);
assert.equal(r.uniqueFingerprintCount,3);
assert.equal(r.aggregateStructureIdenticalAcrossFingerprints,true);
assert.equal(r.limitations.alnumVsKnownSymbolSplitRecoverable,false);
assert.equal(r.limitations.perPositionCharacterClassRecoverable,false);
assert.equal(r.isolation.gateRelaxed,false);
console.log('A21.6 character-class audit invariants PASS');
