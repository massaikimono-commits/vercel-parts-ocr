import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const layout = read("app/vehicle-workflow-v2/layout.tsx");
const fast = read("app/vehicle-workflow-fast/page.tsx");
const v3 = read("app/certificate-pdf-structured-reader-v3.jsx");
const v2 = read("app/certificate-pdf-native-reader-v2.jsx");
const weightBlock = read("app/certificate-pdf-weight-block-recovery.jsx");
const rowCorrector = read("app/certificate-pdf-row-corrector.jsx");
const ownerSemantics = read("app/certificate-owner-semantics.jsx");
const finalBridge = read("app/certificate-pdf-final-form-bridge.jsx");

// Runtime topology is intentionally locked here because source-only unit tests did
// not model the mounted /vehicle-workflow-v2 ownership chain.
assert.match(layout, /<CertificatePdfStructuredReaderV3\s*\/>/);
assert.match(layout, /<CertificatePdfNativeReaderV2\s*\/>/);
assert.match(fast, /<CertificatePdfStructuredReaderV3\s*\/>/);
assert.match(fast, /<CertificatePdfNativeReaderV2\s*\/>/);

// Duplicate v3 mounts must still share event identity ownership and stop the
// original PDF change event before a v2 bubble consumer can run. The runtime
// intentionally uses optional chaining for stopImmediatePropagation so the
// regression must accept that exact browser-safe form rather than require a
// non-optional call that is not present in production source.
assert.match(v3, /claimCertificatePdfV3Event\(event\)/);
assert.match(v3, /event\.stopImmediatePropagation\?\.\(\)/);
assert.match(v2, /document\.addEventListener\("change", onChange\)/);

// FINAL form bridge may normalize explicit empty semantics, but must not create
// a second authoritative event or own React state.
assert.match(finalBridge, /isCertificatePdfStructuredFinal/);
assert.doesNotMatch(finalBridge, /dispatchEvent|setVehicle|mergePatch/);

// Root-cause closure: async compatibility recovery must not reopen the writer
// graph after structured-v3 FINAL. Guard both the incoming FINAL event and the
// post-await shared owner, because recovery can start before FINAL and resume later.
assert.match(weightBlock, /isCertificatePdfStructuredFinal\(detail\)/);
assert.match(weightBlock, /isCertificatePdfStructuredFinal\(window\[PDF_PRIORITY_KEY\]\)/);
const finalGuard = weightBlock.indexOf("isCertificatePdfStructuredFinal(detail)");
const awaitRecovery = weightBlock.indexOf("await pending");
const postAwaitGuard = weightBlock.indexOf("isCertificatePdfStructuredFinal(window[PDF_PRIORITY_KEY])");
const redispatch = weightBlock.indexOf("window.dispatchEvent(new CustomEvent(AUTH_EVENT");
assert.ok(finalGuard >= 0 && finalGuard < awaitRecovery, "FINAL event must be rejected before async recovery");
assert.ok(awaitRecovery >= 0 && postAwaitGuard > awaitRecovery, "shared owner must be rechecked after await");
assert.ok(redispatch > postAwaitGuard, "compatibility redispatch must remain behind the post-await FINAL guard");

// Downstream compatibility writers already honor FINAL. The weight-block guard
// prevents them from being re-opened by a downgraded non-final AUTH event.
assert.match(rowCorrector, /isCertificatePdfStructuredFinal\(event\?\.detail\)/);
assert.match(ownerSemantics, /isCertificatePdfStructuredFinal\(detail\)/);

console.log("certificate PDF final writer closure regression: PASS");
