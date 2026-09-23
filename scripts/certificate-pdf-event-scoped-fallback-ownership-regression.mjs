import assert from "node:assert/strict";
import fs from "node:fs";
import {
  claimCertificatePdfV3Event,
  isCertificatePdfV3FallbackEvent,
  markCertificatePdfV3FallbackEvent,
} from "../app/certificate-pdf-fallback-event-ownership.js";

const source = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");
const before = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const producer = before("function passToExisting(input) {", "export default function CertificatePdfStructuredReaderV3()");
const entry = before("const onChange = async (event) => {", "const runStartedMetadata = safeCertificatePdfRunEntryMetadata(");
assert.ok(producer.startsWith("function passToExisting"));
assert.ok(entry.startsWith("const onChange = async"));

// Execute the real producer and the real V3 handler guards through beginRun.
// Stop before PDF.js, UI, or network work; the number of calls is the contract.
const passToExisting = new Function(
  "markCertificatePdfV3FallbackEvent", "observeCertificatePdfProgrammaticChange", "PASS_KEY",
  `${producer}; return passToExisting;`
)(markCertificatePdfV3FallbackEvent, () => {}, "pdfStructuredV3PassThrough");
class FakeInput extends EventTarget {
  type = "file";
  dataset = {};
  files = [{ name: "document.pdf", type: "application/pdf" }];
  dispatches = 0;
  dispatchEvent(event) {
    this.dispatches++;
    return super.dispatchEvent(event);
  }
}
globalThis.HTMLInputElement = FakeInput;
let beginRuns = 0;
const handlerFactory = new Function(
  "isCertificatePdfV3FallbackEvent", "claimCertificatePdfV3Event", "HTMLInputElement",
  "PASS_KEY", "completion", "safeCertificatePdfPreviousRun", "safeCertificatePdfRunEntryMetadata",
  "safeCertificatePdfCheckpoint", "safeCertificatePdfPassKeyState", "observeCertificatePdfPassConsumer",
  "activeRenderContext", "activeDiagnosticId", "observerIdentity", "checkpointCertificatePdfDiagnostic",
  `${entry} return runId; }; return onChange;`
);
const input = new FakeInput();
const makeHandler = (identity) => handlerFactory(
  isCertificatePdfV3FallbackEvent, claimCertificatePdfV3Event, FakeInput,
  "pdfStructuredV3PassThrough", { beginRun: () => ++beginRuns, isActive: () => false },
  () => ({}), () => ({}), () => {}, () => false, () => null,
  null, null, identity, () => {}
);
const first = makeHandler({ listenerInstanceId: "first" });
const second = makeHandler({ listenerInstanceId: "second" });
input.addEventListener("change", first);
input.addEventListener("change", second);

input.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(beginRuns, 1, "genuine user selection begins exactly one V3 run");
assert.equal(input.dispatches, 1);

passToExisting(input);
await Promise.resolve();
assert.equal(input.dispatches, 2, "fallback dispatches exactly one change Event");
assert.equal(beginRuns, 1, "all V3 listeners pass the same fallback Event");
assert.equal(input.dataset.pdfStructuredV3PassThrough, undefined, "existing PASS consume contract remains");

input.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(beginRuns, 2, "next genuine Event begins one new run");
input.dataset.pdfNativeV2PassThrough = "1";
input.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(beginRuns, 2, "V2 pass-through still bypasses V3");
delete input.dataset.pdfNativeV2PassThrough;
input.dataset.pdfNativePassThrough = "1";
input.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(beginRuns, 2, "legacy pass-through still bypasses V3");
delete input.dataset.pdfNativePassThrough;
input.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(beginRuns, 3, "unmarked programmatic Bridge Event retains V3 handling");

const marked = markCertificatePdfV3FallbackEvent(new Event("change"));
assert.equal(isCertificatePdfV3FallbackEvent(marked), true);
assert.equal(isCertificatePdfV3FallbackEvent(new Event("change")), false);
assert.equal(claimCertificatePdfV3Event(new Event("change")), true);
assert.equal(claimCertificatePdfV3Event(marked), true);
assert.equal(claimCertificatePdfV3Event(marked), false);
assert.equal(input.dispatches, 6, "no additional programmatic dispatch");

for (const operation of ["dispatchEvent", "AUTH_EVENT", "PDF_PRIORITY", "QR_PRIORITY", "dataset", "completion", "stopPropagation"]) {
  const owner = fs.readFileSync(new URL("../app/certificate-pdf-fallback-event-ownership.js", import.meta.url), "utf8");
  assert.equal(owner.includes(operation), false, `Event ownership module has no business side effect: ${operation}`);
}
assert.equal((source.match(/input\.dispatchEvent\(changeEvent\)/g) || []).length, 1);
assert.equal((source.match(/completion\.beginRun\(\)/g) || []).length, 1);
assert.equal((source.match(/input\.dataset\[PASS_KEY\] = "1"/g) || []).length, 1);
assert.equal((source.match(/delete input\.dataset\[PASS_KEY\]/g) || []).length, 1);
console.log("certificate PDF event-scoped fallback ownership regression: PASS");
