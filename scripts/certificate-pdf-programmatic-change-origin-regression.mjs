import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const observer = read("app/certificate-pdf-programmatic-change-origin.js");
const v3 = read("app/certificate-pdf-structured-reader-v3.jsx");
const v2 = read("app/certificate-pdf-native-reader-v2.jsx");
const legacy = read("app/certificate-pdf-native-reader.jsx");
const bridge = read("app/certificate-pdf-bridge.jsx");
const originObserver = await import(new URL("../app/certificate-pdf-programmatic-change-origin.js", import.meta.url));

const firstEvent = new Event("change");
assert.equal(originObserver.observeCertificatePdfProgrammaticChange(firstEvent, "PDF_BRIDGE_REDISPATCH"), firstEvent);
assert.deepEqual(originObserver.getCertificatePdfProgrammaticChangeOrigin(firstEvent), {
  programmaticChangeOrigin: "PDF_BRIDGE_REDISPATCH",
  originSequence: 1,
});
const secondEvent = new Event("change");
originObserver.observeCertificatePdfProgrammaticChange(secondEvent, "V3_PASS_TO_EXISTING");
assert.deepEqual(originObserver.getCertificatePdfProgrammaticChangeOrigin(secondEvent), {
  programmaticChangeOrigin: "V3_PASS_TO_EXISTING",
  originSequence: 2,
});
assert.deepEqual(originObserver.getCertificatePdfProgrammaticChangeOrigin(new Event("change")), {
  programmaticChangeOrigin: null,
  originSequence: null,
});
assert.doesNotThrow(() => originObserver.observeCertificatePdfProgrammaticChange(null, "BROKEN"));
assert.deepEqual(originObserver.getCertificatePdfProgrammaticChangeOrigin(null), {
  programmaticChangeOrigin: null,
  originSequence: null,
});

for (const [source, origin] of [
  [v3, "V3_PASS_TO_EXISTING"],
  [v2, "NATIVE_V2_PASS_TO_EXISTING"],
  [legacy, "LEGACY_NATIVE_PASS_TO_EXISTING"],
  [bridge, "PDF_BRIDGE_REDISPATCH"],
]) {
  assert.match(source, new RegExp(`observeCertificatePdfProgrammaticChange\\(changeEvent, "${origin}"\\)`), `${origin} must identify its producer`);
  assert.equal((source.match(/dispatchEvent\(changeEvent\)/g) || []).length, 1, `${origin} must keep exactly one change dispatch`);
}

assert.match(v3, /programmaticChangeOrigin: programmaticOrigin\.programmaticChangeOrigin/);
assert.match(v3, /originSequence: programmaticOrigin\.originSequence/);
assert.match(v3, /safeCertificatePdfCheckpoint\(diagnosticId, "V3_HANDLER_ENTER", runStartedMetadata\)/);
assert.match(v3, /const runId = completion\.beginRun\(\);/);
assert.equal((v3.match(/completion\.beginRun\(/g) || []).length, 1, "beginRun count must stay unchanged");

assert.match(observer, /const eventOrigins = new WeakMap\(\)/);
assert.match(observer, /catch \{[\s\S]*Diagnostics must never affect the event producer/);
for (const forbidden of ["AUTH_EVENT", "PDF_PRIORITY", "QR_PRIORITY", "dispatchEvent", "preventDefault", "stopPropagation", "completion.", "ownership.", "dataset"] ) {
  assert.equal(observer.includes(forbidden), false, `origin observer must not gain authority: ${forbidden}`);
}

assert.match(v3, /input\.dataset\[PASS_KEY\] = "1";[\s\S]*V3_PASS_TO_EXISTING/);
assert.match(v2, /input\.dataset\[OWN_PASS\] = "1"; input\.dataset\[V1_PASS\] = "1";[\s\S]*NATIVE_V2_PASS_TO_EXISTING/);
assert.match(legacy, /input\.dataset\[PASS_THROUGH\] = "1";[\s\S]*LEGACY_NATIVE_PASS_TO_EXISTING/);
assert.doesNotMatch(bridge, /PASS_KEY|pdfStructuredV3PassThrough|pdfNativeV2PassThrough|pdfNativePassThrough/);

for (const source of [observer, v3, v2, legacy, bridge]) {
  assert.doesNotMatch(source, /certificatePdfCfAc[^\n]*=== "0"/, "CF-A/C semantics must not be changed");
}

console.log("certificate PDF programmatic change origin regression: PASS");
