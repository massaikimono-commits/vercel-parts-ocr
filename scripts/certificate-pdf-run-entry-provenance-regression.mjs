import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");

function extractFunction(name) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, `${name} must exist`);
  const parametersStart = source.indexOf("(", start);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      bodyStart = source.indexOf("{", index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} must have a complete body`);
}

const fingerprintSource = extractFunction("safeCertificatePdfFileFingerprint");
const checkpointSource = extractFunction("safeCertificatePdfCheckpoint");
const beginSource = extractFunction("safeBeginCertificatePdfDiagnosticRun");
const pendingSource = extractFunction("isCertificatePdfRenderPending");
const eventProvenanceSource = extractFunction("safeCertificatePdfEventProvenance");

const fingerprint = new Function(`${fingerprintSource}; return safeCertificatePdfFileFingerprint;`)();
assert.equal(fingerprint({ name: "sensitive-name.pdf", size: 12, type: "application/pdf", lastModified: 34 }), "n18:s12:tapplication/pdf:m34");
assert.equal(fingerprint({ get name() { throw new Error("observer failure"); } }), "unavailable");
assert.equal(fingerprint({ name: "sensitive-name.pdf", size: 12, type: "application/pdf", lastModified: 34 }).includes("sensitive-name"), false);

const eventProvenance = new Function(`let nextCertificatePdfEventSequence = 0; let certificatePdfUserSelectionCount = 0; const certificatePdfEventProvenance = new WeakMap(); ${eventProvenanceSource}; return safeCertificatePdfEventProvenance;`)();
const firstUserEvent = { isTrusted: true };
assert.deepEqual(eventProvenance(firstUserEvent), { eventSequence: 1, userSelectionCount: 1 });
assert.deepEqual(eventProvenance(firstUserEvent), { eventSequence: 1, userSelectionCount: 1 }, "duplicate listeners must share one user-selection identity");
assert.deepEqual(eventProvenance({ isTrusted: false }), { eventSequence: 2, userSelectionCount: 1 }, "programmatic events must not increase the user-selection count");
assert.deepEqual(eventProvenance({ isTrusted: true }), { eventSequence: 3, userSelectionCount: 2 });

const safeCheckpoint = new Function("checkpointCertificatePdfDiagnostic", `${checkpointSource}; return safeCertificatePdfCheckpoint;`)(() => { throw new Error("diagnostic failure"); });
assert.doesNotThrow(() => safeCheckpoint(1, "V3_HANDLER_ENTER", {}));
assert.equal(safeCheckpoint(1, "V3_HANDLER_ENTER", {}), null);

const safeBegin = new Function("beginCertificatePdfDiagnosticRun", `${beginSource}; return safeBeginCertificatePdfDiagnosticRun;`)(() => { throw new Error("diagnostic failure"); });
assert.doesNotThrow(() => safeBegin(1, {}));
assert.equal(safeBegin(1, {}), null);

const isRenderPending = new Function(`${pendingSource}; return isCertificatePdfRenderPending;`)();
const pending = {
  previousTerminalState: "processing",
  snapshot: { checkpoints: [{ checkpoint: "RENDER_PROMISE_STARTED" }] },
};
assert.equal(isRenderPending(pending), true);
assert.equal(isRenderPending({ ...pending, snapshot: { checkpoints: [...pending.snapshot.checkpoints, { checkpoint: "RENDER_PROMISE_FULFILLED" }] } }), false);
assert.equal(isRenderPending({ ...pending, snapshot: { checkpoints: [...pending.snapshot.checkpoints, { checkpoint: "RENDER_PROMISE_REJECTED" }] } }), false);
assert.equal(isRenderPending({ ...pending, previousTerminalState: "completed" }), false);
assert.doesNotThrow(() => isRenderPending({ get previousTerminalState() { throw new Error("observer failure"); } }));

for (const field of [
  "eventIsTrusted", "eventType", "eventPhase", "eventSequence", "userSelectionCount", "componentInstanceId", "listenerInstanceId", "mountGeneration",
  "programmaticChangeOrigin", "originSequence",
  "fileFingerprint", "passKeyState", "pdfNativeV2PassThroughState", "pdfNativePassThroughState",
  "previousActiveRunId", "previousCheckpoint", "previousTerminalState",
]) {
  assert.match(source, new RegExp(`${field}:`), `V3_HANDLER_ENTER/RUN_STARTED metadata must include ${field}`);
}

assert.match(source, /const runId = completion\.beginRun\(\);\s*const runStartedMetadata = safeCertificatePdfRunEntryMetadata[\s\S]*safeBeginCertificatePdfDiagnosticRun\(runId, runStartedMetadata\)/);
assert.match(source, /safeCertificatePdfCheckpoint\(diagnosticId, "V3_HANDLER_ENTER", runStartedMetadata\)/);
assert.match(source, /const certificatePdfEventProvenance = new WeakMap\(\)/);
assert.match(source, /event\?\.isTrusted \? \+\+certificatePdfUserSelectionCount : certificatePdfUserSelectionCount/);
assert.match(source, /safeCertificatePdfCheckpoint\(diagnosticId, "RUN_REENTRY_WHILE_RENDER_PENDING", \{[\s\S]*previousRunId:[\s\S]*newRunId:[\s\S]*previousComponentInstanceId:[\s\S]*newComponentInstanceId:[\s\S]*eventIsTrusted:/);
assert.equal((source.match(/completion\.beginRun\(/g) || []).length, 1, "observer must not change beginRun call count");
assert.equal((source.match(/window\.addEventListener\("change", onChange, true\)/g) || []).length, 1, "listener registration must remain single");
assert.equal((source.match(/window\.removeEventListener\("change", onChange, true\)/g) || []).length, 1, "listener cleanup must remain single");
assert.equal((source.match(/event\.preventDefault\(\)/g) || []).length, 1, "observer must not add event suppression");
assert.equal((source.match(/event\.stopPropagation\(\)/g) || []).length, 1, "observer must not add propagation changes");
assert.equal((source.match(/event\.stopImmediatePropagation\?\.\(\)/g) || []).length, 1, "observer must not add immediate propagation changes");
assert.equal((source.match(/input\.dispatchEvent\(changeEvent\)/g) || []).length, 1, "observer must not add programmatic change events");
assert.match(source, /if \(input\.dataset\[PASS_KEY\] === "1"\) \{[\s\S]*delete input\.dataset\[PASS_KEY\];\s*return;/, "PASS_KEY semantics must remain intact");
assert.match(source, /new URLSearchParams\(locationLike\?\.search \|\| ""\)\.get\("certificatePdfCfAc"\) === "1"/, "CF-A/C must remain explicit and default OFF");

for (const checkpoint of [
  "RENDER_TASK_CREATED", "RENDER_PROMISE_STARTED", "RENDER_PROMISE_FULFILLED", "RENDER_PROMISE_REJECTED",
  "CF_PREFLIGHT_STARTED", "CF_PREFLIGHT_DESTROY_DONE", "CF_MAIN_DOCUMENT_STARTED",
]) {
  assert.match(source, new RegExp(`"${checkpoint}"`), `${checkpoint} must remain present`);
}

const observerFunctions = [fingerprintSource, checkpointSource, beginSource, pendingSource, eventProvenanceSource, extractFunction("safeCertificatePdfRunEntryMetadata")].join("\n");
for (const forbidden of ["AUTH_EVENT", "PDF_PRIORITY", "QR_PRIORITY", "dispatchEvent", "CustomEvent", "preventDefault", "stopPropagation", "stopImmediatePropagation", "completion.", "ownership."]) {
  assert.equal(observerFunctions.includes(forbidden), false, `observer helper must not gain authority: ${forbidden}`);
}

console.log("certificate PDF run entry provenance regression: PASS");
