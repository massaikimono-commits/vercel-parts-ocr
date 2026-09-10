import assert from "node:assert/strict";
import fs from "node:fs";

const path="app/eval/certificate-qr-stage-a21-8-real-evidence/page.jsx";
const page=fs.readFileSync(path,"utf8");
for(const token of ["A213_FIXED_IDS","runPhotoQrA212Counterfactual","sanitizeA214Detail","evaluateA217Counterfactual","evaluateA218AdoptionReadiness","realCharacterClassEvidence:true","additionalRealRegressionStatus:\"NOT_RUN\"","総合管理用短縮summaryをコピー","positionClassMask","nonAsciiPositions","separatorPositions"]){assert.ok(page.includes(token),`missing ${token}`);}
assert.ok(page.includes('multiple disabled={running||started.current}'));
assert.ok(page.includes("started.current=true"));
assert.equal(page.includes("A21.4を1回だけ実行"),false);
assert.equal(page.includes("詳細JSONをコピー"),false);
assert.equal(page.includes("localStorage.setItem"),false);
assert.equal(page.includes("rawPayload:"),false);
assert.equal(page.includes("payloadFragment:"),false);
assert.equal(page.includes("unicodeCodePoints:"),false);
assert.ok(page.includes("rawPayloadIncluded:false"));
assert.ok(page.includes("payloadFragmentIncluded:false"));
assert.ok(page.includes("unicodeCodePointsIncluded:false"));
assert.ok(page.includes("canonicalPayloadIncluded:false"));
assert.ok(page.includes("A218_SUMMARY_TOO_LONG"));
assert.ok(page.includes("6000"));
console.log("Stage A21.8 one-shot real evidence UI invariants: PASS");
