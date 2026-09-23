import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getCertificatePdfPassConsumer,
  getCertificatePdfProgrammaticChangeOrigin,
  observeCertificatePdfPassConsumer,
  observeCertificatePdfProgrammaticChange,
} from "../app/certificate-pdf-programmatic-change-origin.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = read("app/certificate-pdf-structured-reader-v3.jsx");
const observer = read("app/certificate-pdf-programmatic-change-origin.js");

const event = new Event("change");
observeCertificatePdfProgrammaticChange(event, "V3_PASS_TO_EXISTING");
const a = { componentInstanceId: "a", listenerInstanceId: "listener-a", mountGeneration: 1 };
const b = { componentInstanceId: "b", listenerInstanceId: "listener-b", mountGeneration: 2 };
assert.equal(getCertificatePdfPassConsumer(event), null);
assert.deepEqual(observeCertificatePdfPassConsumer(event, a), {
  passConsumerCount: 1,
  passConsumerComponentInstanceId: "a",
  passConsumerListenerInstanceId: "listener-a",
  passConsumerMountGeneration: 1,
});
assert.deepEqual(getCertificatePdfPassConsumer(event), {
  passConsumerCount: 1,
  passConsumerComponentInstanceId: "a",
  passConsumerListenerInstanceId: "listener-a",
  passConsumerMountGeneration: 1,
});
observeCertificatePdfPassConsumer(event, b);
assert.equal(getCertificatePdfPassConsumer(event).passConsumerCount, 2);
assert.equal(getCertificatePdfPassConsumer(event).passConsumerListenerInstanceId, "listener-b");
assert.equal(getCertificatePdfPassConsumer(new Event("change")), null, "different Event must not inherit a consumer");
assert.equal(getCertificatePdfProgrammaticChangeOrigin(event).programmaticChangeOrigin, "V3_PASS_TO_EXISTING");
assert.equal(observeCertificatePdfPassConsumer(null, a), null, "observer failure must not propagate");
assert.equal(getCertificatePdfPassConsumer(null), null);
assert.equal(observeCertificatePdfPassConsumer(event, null), null);

const entry = base.slice(base.indexOf("const onChange = async (event) =>"), base.indexOf("const runId = completion.beginRun();"));
assert.match(entry, /if \(input\.dataset\[PASS_KEY\] === "1"\) \{[\s\S]*V3_PASS_OBSERVED[\s\S]*delete input\.dataset\[PASS_KEY\];[\s\S]*observeCertificatePdfPassConsumer\(event, observerIdentity\)[\s\S]*V3_PASS_CONSUMED[\s\S]*return;/);
assert.match(base, /passConsumerCount: passConsumer\?\.passConsumerCount \?\? 0/);
assert.match(base, /passConsumerComponentInstanceId: passConsumer\?\.passConsumerComponentInstanceId \?\? null/);
assert.match(base, /passConsumerListenerInstanceId: passConsumer\?\.passConsumerListenerInstanceId \?\? null/);
assert.match(base, /passConsumerMountGeneration: passConsumer\?\.passConsumerMountGeneration \?\? null/);
assert.match(base, /passKeyStateBeforeConsume: true/);
assert.match(base, /passKeyStateAfterConsume: safeCertificatePdfPassKeyState\(input\)/);
assert.match(base, /`PASS consumer: count=\$\{provenance\.passConsumerCount\}/);
for (const pattern of [
  /completion\.beginRun\(/g, /window\.addEventListener\("change", onChange, true\)/g,
  /window\.removeEventListener\("change", onChange, true\)/g, /input\.dispatchEvent\(changeEvent\)/g,
  /event\.preventDefault\(\)/g, /event\.stopPropagation\(\)/g,
  /event\.stopImmediatePropagation\?\.\(\)/g, /delete input\.dataset\[PASS_KEY\]/g,
  /input\.dataset\[PASS_KEY\] = "1"/g,
]) {
  assert.equal((base.match(pattern) || []).length, 1, `single existing runtime operation: ${pattern}`);
}
for (const forbidden of ["dispatchEvent", "AUTH_EVENT", "PDF_PRIORITY", "QR_PRIORITY", "stopPropagation", "preventDefault", "completion.", "ownership.", "dataset", "setTimeout", "Promise.race"]) {
  assert.equal(observer.includes(forbidden), false, `observer has no runtime authority: ${forbidden}`);
}
assert.match(base, /certificatePdfCfAc"\) === "1"/);
assert.match(base, /RUN_REENTRY_WHILE_RENDER_PENDING/);
console.log("certificate PDF PASS consumer trace regression: PASS");
