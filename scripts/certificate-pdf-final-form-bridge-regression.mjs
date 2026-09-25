import assert from "node:assert/strict";
import fs from "node:fs";

const bridgeSource = fs.readFileSync(new URL("../app/certificate-pdf-final-form-bridge.jsx", import.meta.url), "utf8");
const formSource = fs.readFileSync(new URL("../app/vehicle-workflow-fast/page.tsx", import.meta.url), "utf8");
const layoutSource = fs.readFileSync(new URL("../app/vehicle-workflow-v2/layout.tsx", import.meta.url), "utf8");

// Runtime call-path contract: FINAL owner -> AUTH event -> bridge -> sparse React form.
assert.match(layoutSource, /CertificatePdfFinalFormBridge/);
assert.match(formSource, /addEventListener\(AUTH_EVENT/);
assert.match(formSource, /typeof v==="string"&&v\.trim\(\)/);
assert.match(bridgeSource, /isCertificatePdfStructuredFinal/);
assert.match(bridgeSource, /slot\?\.explicitEmpty/);
assert.match(bridgeSource, /detail\[key\] = "-"/);

// The bridge must be scoped to structured-v3 and structural evidence only; photo/OCR
// sparse merges must retain their existing semantics.
assert.match(bridgeSource, /!isCertificatePdfStructuredFinal\(detail\)/);
assert.match(bridgeSource, /__genericStructuralEvidence/);

console.log("certificate PDF final form bridge regression: PASS");
